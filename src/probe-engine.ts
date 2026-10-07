/**
 * 「模型 × 推理级别」最小请求的执行引擎：验证与探测式填充共用。
 *
 * 两个功能要发的是同一形态的请求（同一把提示词、同一个受理判据、同一种失败分类、同样的
 * provider 间并发 / provider 内串行 / 中止早停 / 进度帧），把它们各写一份必然随演进漂移，
 * 故共用的那一半分层落：失败分类与两级短路判据收在 `src/probe-verdict.ts`，入参校验与计划展开、
 * 按 provider 分组收在 `src/probe-plan.ts`，本文件留单次请求与受理判据、并发编排与进度帧、汇报与汇总。
 * 真正不同的只有「一组里怎么逐条跑」——验证按 `needTest` 先发一次不带档位的基线探测，
 * 探测式填充逐档各发一次——故该部分由调用方以 `runGroup` 注入，而「这次失败是否只否定这一档」
 * 由各功能用自己的对照给出：验证用基线探测，探测式填充用同模型已跑通的更低档。
 *
 * 受理判据与失败分类、短路的唯一判据见 `src/probe-verdict.ts` 的文件头，计划与配额见 `src/probe-plan.ts`。
 * 本文件剩下的口径（与本文件同生共死，两功能一致）：
 * - 收到首个 `block-start` 即判该「模型 × 档位」可用，随即中断、不再消耗生成额度；
 *   `usage` 不含受理信息，只判「非 finish 块」会把额度耗尽的 key 误判成可用。
 * - 每 provider 单并发（分组即结构保证）、跨 provider 至多 `PROBE_PROVIDER_CONCURRENCY` 路、无退避重试。
 * - 中止同时断在途请求并让执行循环早停；**中止不发 `done` 帧**，消费方见「流自然结束却没等到 done」
 *   即知这轮没跑完，据此保留进度而不是报成功。
 *
 * 汇报与汇总（reportProvider / summarizeProviders）零 ctx、不触网，执行器只依赖注入的 `llm.stream`，
 * 故带桩即可把短路与中止一并单测。
 */

import type { LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
// LlmFailure 定义在 types 子路径（包根只 import 未再导出）；仅取类型，擦除后不落运行期依赖
import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import type { UnsupportedEffort, UsableEffort, VerifyFailureFacts, VerifyProbe, VerifyProbeResult, VerifyProgressFrame, VerifyProviderReport, VerifySummary } from '@/shared/verify-progress'
import type { ProviderProbeGroup } from '@/probe-plan'
import { classifyFailure, type ProbeVerdict } from '@/probe-verdict'

/** 探测提示词：只要一句应答，最省 token */
const PROBE_PROMPT = 'Just say OK'
/** 单次探测的等待上限（毫秒）：超时视为本次没跑成，防个别端点把整批拖死 */
const PROBE_TIMEOUT_MS = 30_000
/** 同时在跑的**提供方**数（不是单提供方并发数——后者恒为 1，由分组串行保证） */
const PROBE_PROVIDER_CONCURRENCY = 5

/** 取失败事实的可序列化子集（供调用方自行细分，不参与本插件的判定） */
function failureFacts(failure: LlmFailure): VerifyFailureFacts {
    return { code: failure.code, status: failure.status, message: failure.message }
}

/**
 * 发一次探测并判定：收到首个 `block-start` 即判「受支持」；否则读到终止块、据其失败事实分类。
 * 我方超时引发的 `aborted` 不算「端点不可达」——那会把慢端点误判成断线，进而错误短路整组。
 */
export async function probeOnce(
    llm: Pick<LlmRuntime, 'stream'>,
    probe: Pick<VerifyProbe, 'provider' | 'model' | 'effort'>,
    signal: AbortSignal,
): Promise<ProbeVerdict> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, PROBE_TIMEOUT_MS)
    try {
        for await (const chunk of llm.stream({
            provider: probe.provider,
            model: probe.model,
            // 档位 id 取自宿主自己的 reasoningEfforts 配置键（即模型页送出的同一个值），断言只为满足品牌类型，
            // 免为此引入 @deepseek-ai/dsh-llm 的运行期值导入
            ...(probe.effort === undefined ? {} : { reasoningEffort: probe.effort as ReasoningEffortId }),
            messages: [{ role: 'user', content: [{ type: 'text', text: PROBE_PROMPT }] }],
            // 我方超时与外部中止合成一路，两者都该停在探测边界上。
            // 不能改用 AbortSignal.timeout：那会抹掉下面判断「超时的是我」的 timedOut 标志，慢端点又被误判成断线
            signal: AbortSignal.any([signal, controller.signal]),
        })) {
            // 只认 block-start——它证明适配器已真正开始产出内容块（宿主 isVisibleChunk 同样把 usage / finish 排除在「内容」之外）。
            // 不能沿用「首个非 finish 块即成功」：额度耗尽的 key 也会先来一条 usage，那不是受理信号。
            // 命中即返回，随后的 finally 中断请求、不再消耗生成额度
            if (chunk.type === 'block-start') return { outcome: 'usable', failure: undefined }
            if (chunk.type === 'finish') {
                const reason = chunk.reason
                // stop / tool-calls / max-tokens：正常终止却没有内容块，宿主归为退化完成，同样没跑成
                if (reason.kind !== 'error' && reason.kind !== 'aborted') return { outcome: 'other', failure: undefined }
                // 我方超时不算端点不可达，也不算不可用——但原始失败事实照留，供调用方自行判断
                return {
                    outcome: timedOut ? 'timeout' : classifyFailure(reason.failure),
                    failure: failureFacts(reason.failure),
                }
            }
        }
        return { outcome: 'other', failure: undefined }
    } catch {
        // 适配器未注册等抛出的异常一律归入「其它失败」，不参与短路——宁可少短路，不可误短路
        return { outcome: 'other', failure: undefined }
    } finally {
        clearTimeout(timer)
        controller.abort()
    }
}

/**
 * 单组结论 -> 汇报：可用模型按「提供方 / 模型」去重；档位不可用单独计数，不与其它失败混计。
 * 可达 / 凭据取自**全程**结果（被验请求与基线探测一并计入）而非首个。
 *
 * **只认能否定整个提供方的失败**：端点不通翻 `reachable`，凭据无效翻 `keyValid`。
 * 额度耗尽两者都不翻——它多半是**按模型**设的额度（有的厂商给某个模型单独限额），
 * 拿一个模型的额度去否定整把 key 正是「层级错配」，它已由模型级短路压到该模型尾，
 * 要看出了什么事得看该模型自己的明细条目（那里记着 `quota`）。
 */
export function reportProvider(result: ProviderProbeOutcome): VerifyProviderReport {
    const usable = new Set<string>()
    let efforts = 0
    let unsupported = 0
    let unreachable = false
    let keyRejected = false
    for (const item of result.results) {
        if (item.outcome === 'usable') {
            // 可用**档位**数只计带档位的请求；不带档位的那条要么是对照（基线探测，不计），
            // 要么本身就是被验对象（模型无档位可验），后者计模型数、不计档位数
            if (item.effort !== undefined) efforts++
            usable.add(JSON.stringify([item.provider, item.model]))
        } else if (item.outcome === 'unsupported-effort') {
            unsupported++
        } else if (item.outcome === 'unreachable') {
            unreachable = true
        } else if (item.outcome === 'credential') {
            keyRejected = true
        }
    }
    // 基线探测同样能证伪端点与凭据（它也是真发出去的一次请求），故一并纳入；只是它不产明细、不计任何计数
    for (const item of result.tests) {
        if (item.outcome === 'unreachable') unreachable = true
        else if (item.outcome === 'credential') keyRejected = true
    }
    return {
        provider: result.provider,
        reachable: !unreachable,
        // 从未拿到 HTTP 响应时无从判断凭据，如实不报「有效」
        keyValid: !unreachable && !keyRejected,
        skipped: result.blockedBy !== undefined,
        blockedBy: result.blockedBy,
        tested: result.tested,
        models: usable.size,
        efforts,
        unsupported,
        planned: result.planned,
        plannedEfforts: result.plannedEfforts,
        probed: result.results.length,
    }
}

/** 全局汇总：各组汇报相加；明细按「组序 → 组内探测序」平铺，顺序稳定可重复消费 */
export function summarizeProviders(
    reports: readonly VerifyProviderReport[],
    results: readonly VerifyProbeResult[],
): VerifySummary {
    let models = 0
    let efforts = 0
    let unsupported = 0
    let planned = 0
    let plannedEfforts = 0
    let probed = 0
    let tested = 0
    for (const report of reports) {
        models += report.models
        efforts += report.efforts
        unsupported += report.unsupported
        planned += report.planned
        plannedEfforts += report.plannedEfforts
        probed += report.probed
        tested += report.tested
    }
    // 两种明确状态的档位明细（可用 / 不支持）：只认带档位的条目（不带档位的请求走不到这两个结论），
    // 且与上面的聚合同源，不另算一套口径，免得两处分叉。带档位的逐条明细才是要写回配置的那份——
    // 浏览器半不自己从 results 里重筛一遍。
    const usableEfforts: UsableEffort[] = []
    const unsupportedEfforts: UnsupportedEffort[] = []
    for (const item of results) {
        if (item.effort === undefined) continue
        if (item.outcome === 'usable') usableEfforts.push({ provider: item.provider, model: item.model, effort: item.effort })
        else if (item.outcome === 'unsupported-effort') unsupportedEfforts.push({ provider: item.provider, model: item.model, effort: item.effort })
    }
    return {
        providers: reports,
        results,
        unsupportedEfforts,
        usableEfforts,
        tested,
        models,
        efforts,
        unsupported,
        planned,
        plannedEfforts,
        probed,
    }
}

/** 「永不中止」的占位信号（AbortSignal 没有 null 态，未给 signal 时用它） */
const NEVER_ABORTED = new AbortController().signal

/** 一个 `runGroup` 的产出出口：一条请求的结论 + 因短路而未发出的条数（0 时传 undefined） */
export type ProbeEmitter = (
    probe: Pick<VerifyProbe, 'provider' | 'model' | 'effort'>,
    verdict: ProbeVerdict,
    skipped: number | undefined,
) => void

/** 一组怎么逐条跑：两个功能的全部差异都在这个回调里（验证带基线探测，探测式填充逐档平推） */
export type GroupRunner = (
    llm: Pick<LlmRuntime, 'stream'>,
    group: ProviderProbeGroup,
    signal: AbortSignal,
    emitProbe: ProbeEmitter,
) => Promise<ProviderProbeOutcome>

/** 一轮请求的可选控制项；不传即静默跑完 */
export interface ProbeRunOptions {
    /** 外部中止：客户端断开或用户点停止 / 关窗。已中止即不再发新请求 */
    signal?: AbortSignal
    /** 进度出口。`done` 帧只在整轮真正跑完时发出，中止时不发 */
    onProgress?: (frame: VerifyProgressFrame) => void
}

/**
 * 跑完一组清单（组内零并发、组间最多五路）并汇总；**不发 `done` 帧**——终帧由调用方在收尾时发。
 *
 * 中止的处理在这里已经定型：已中止即不再开新组，从未开跑的组保持 undefined 并被排除在汇报之外
 * （把它们报成「全可用」或「全不可用」都是撒谎）。
 */
export async function runProbeGroups(
    llm: Pick<LlmRuntime, 'stream'>,
    groups: readonly ProviderProbeGroup[],
    runGroup: GroupRunner,
    options: ProbeRunOptions = {},
): Promise<VerifySummary> {
    const signal = options.signal ?? NEVER_ABORTED
    const total = groups.reduce((sum, group) => sum + group.probes.length, 0)
    // 稀疏数组：中止时从未开跑的组保持 undefined，汇报时据实排除
    const outcomes = new Array<ProviderProbeOutcome>(groups.length)
    let completed = 0
    const emitProbe: ProbeEmitter = (probe, verdict, skipped): void => {
        // 跨 worker 的累计位置：本函数只在 await 之后同步调用，单线程下不会交错，自增即可
        completed++
        options.onProgress?.({
            type: 'probed',
            provider: probe.provider,
            model: probe.model,
            effort: probe.effort,
            outcome: verdict.outcome,
            ...(skipped === undefined ? {} : { skipped }),
            done: completed,
            total,
        })
    }
    options.onProgress?.({ type: 'opened', total })
    // 第 w 个 worker 只跑下标 ≡ w (mod workers) 的组：一个普通 for 即可切分，无需共享游标，
    // 各 worker 拿到的组数相差至多一个；组内逐条 await 即「同一 provider 零并发」
    const workers = Math.min(PROBE_PROVIDER_CONCURRENCY, groups.length)
    await Promise.all(Array.from({ length: workers }, (_, worker) => (async () => {
        for (let at = worker; at < groups.length; at += workers) {
            if (signal.aborted) break
            outcomes[at] = await runGroup(llm, groups[at], signal, emitProbe)
        }
    })()))
    const reports: VerifyProviderReport[] = []
    const details: VerifyProbeResult[] = []
    for (let at = 0; at < groups.length; at++) {
        const outcome = outcomes[at]
        if (outcome === undefined) continue
        reports.push(reportProvider(outcome))
        details.push(...outcome.results)
    }
    return summarizeProviders(reports, details)
}

/**
 * 收尾发终帧：**中止不发 `done`**——消费方见「流自然结束却没等到 done」即知这轮没跑完，
 * 据此保留进度而不是报成功。由调用方在全部收尾动作（探测式填充的收敛写回）之后调用，
 * 故终帧里的汇总已是最终形态。
 */
export function finishRun(summary: VerifySummary, options: ProbeRunOptions = {}): void {
    if (options.signal?.aborted) return
    options.onProgress?.({ type: 'done', summary })
}
