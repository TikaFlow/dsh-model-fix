/**
 * 「模型 × 推理级别」最小请求的执行引擎：验证与探测式填充共用。
 *
 * 两个功能要发的是同一形态的请求（同一把提示词、同一个受理判据、同一种失败分类、同样的
 * provider 间并发 / provider 内串行 / 中止早停 / 进度帧），把它们各写一份必然随演进漂移，
 * 故本模块只留**共用的那一半**：入参校验与计划、分组、单次请求与判定、汇总与汇报、并发编排与进度帧。
 * 真正不同的只有「一组里怎么逐条跑」——验证按 `needTest` 先发一次不带档位的基线探测，
 * 探测式填充逐档各发一次——故该部分由调用方以 `runGroup` 注入。
 *
 * 判定口径（与本文件同生共死，两功能一致）：
 * - 收到首个 `block-start` 即判该「模型 × 档位」可用，随即中断、不再消耗生成额度；
 *   `usage` 不含受理信息，只判「非 finish 块」会把额度耗尽的 key 误判成可用。
 * - 失败只按宿主 `LlmFailure.code` 分类（宿主明令 route on `code`），不看 `status`（pi-ai 侧恒缺）、不比对文案。
 * - 限流与超时单列为瞬态：它们只否定这一次，既不算不可用、也不能用来短该模型的后续档位。
 * - 每 provider 单并发（分组即结构保证）、跨 provider 至多 `PROBE_PROVIDER_CONCURRENCY` 路、无退避重试。
 * - 中止同时断在途请求并让执行循环早停；**中止不发 `done` 帧**，消费方见「流自然结束却没等到 done」
 *   即知这轮没跑完，据此保留进度而不是报成功。
 *
 * 纯计划与汇报（planProbes / groupProbesByProvider / classifyFailure / reportProvider / summarizeProviders）
 * 零 ctx、不触网；执行器只依赖注入的 `llm.stream`，故带桩即可把短路与中止一并单测。
 */

import type { LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
// LlmFailure 定义在 types 子路径（包根只 import 未再导出）；仅取类型，擦除后不落运行期依赖
import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import { LEVELS } from '@/constants'
import type { ProbeOutcome, ProviderProbeOutcome, UnsupportedEffort, UsableEffort, VerifyFailureFacts, VerifyProbe, VerifyProbeResult, VerifyProgressFrame, VerifyProviderReport, VerifySummary } from '@/shared/verify-progress'
import { isPlainObject } from '@/shared/types'

/** 探测提示词：只要一句应答，最省 token */
const PROBE_PROMPT = 'Just say OK'
/** 单次探测的等待上限（毫秒）：超时视为本次没跑成，防个别端点把整批拖死 */
const PROBE_TIMEOUT_MS = 30_000
/** 同时在跑的**提供方**数（不是单提供方并发数——后者恒为 1，由分组串行保证） */
const PROBE_PROVIDER_CONCURRENCY = 5

/** 宿主规范码：额度 / 余额耗尽（`ACCOUNT_QUOTA` 是宿主给「账户余额不足」定的字面量，不是 `ACCOUNT_QUOTA_EXCEEDED`） */
const QUOTA_CODES: ReadonlySet<string> = new Set(['QUOTA', 'ACCOUNT_QUOTA'])
/** 宿主规范码：凭据缺失或无效 */
const CREDENTIAL_CODES: ReadonlySet<string> = new Set(['INVALID_CREDENTIAL', 'MISSING_CREDENTIAL'])
/** 宿主规范码：模型未声明请求的这一推理级别（宿主在派发前本地拒绝，请求根本没发出去） */
const UNSUPPORTED_EFFORT_CODE = 'UNSUPPORTED_REASONING_EFFORT'
/** 宿主规范码：上游限流（429）；本次没跑成，换个档位重试仍可能通过 */
const RATE_LIMIT_CODE = 'RATE_LIMIT'
/** 宿主规范码：上游超时；与本方 `PROBE_TIMEOUT_MS` 的超时同性质 */
const TIMEOUT_CODE = 'TIMEOUT'
/**
 * 宿主给出的传输层失败码：连接中断、流被截断。真「连不上」只有这一类信号。
 *
 * **不能拿「`status` 缺失」当不可达**：pi-ai 侧的错误一律不带 status——`llm-pi-ai` 抛错只给
 * `new LlmError(message, code)`，终止错误也只给 `{ message, code }`，任何上游状态码（400、5xx）
 * 在到达我们之前就被压成了文案。故 status 缺失只说明「不是 HTTP 层拒绝」，不说明「连不上」；
 * 按它判会把一次 400 或一次 5xx 误报成断线，进而错误短路整个 provider 剩下的全部模型。
 */
const UNREACHABLE_CODES: ReadonlySet<string> = new Set(['TRANSPORT', 'STREAM_CLOSED'])
/** 宿主规范码：请求参数不正确（`classifyPiAiError` 从文案认出的 4xx / invalid_request，含 413 请求体过大） */
const INVALID_REQUEST_CODE = 'INVALID_REQUEST'

/** 一个提供方的探测组：组内顺序执行即「每 provider 单并发」的结构保证 */
export interface ProviderProbeGroup {
    provider: string
    /** 各探测在原数组中的下标（结果按此回填，汇总与顺序无关） */
    indexes: number[]
    probes: VerifyProbe[]
}

/** 一次探测的判定：结论 + 失败时的原始事实（收到 block-start 时无事实） */
export interface ProbeVerdict {
    outcome: ProbeOutcome
    failure: VerifyFailureFacts | undefined
}

/**
 * 由终止块的失败事实判定探测结果。一律按宿主的 `code` 判：不看 `status`（对 pi-ai 侧恒缺），
 * 也不比对文案。限流与超时单列为瞬态——它们只说明「这一次没跑成」，不是模型或档位不可用的证据，
 * 故不参与 provider 级短路、也不短该模型的后续档位。其余未识别的码归「其它厂商侧拒绝」，
 * 多与具体模型有关。
 */
export function classifyFailure(failure: LlmFailure): Exclude<ProbeOutcome, 'usable'> {
    if (failure.code === UNSUPPORTED_EFFORT_CODE) return 'unsupported-effort'
    if (QUOTA_CODES.has(failure.code)) return 'quota'
    if (CREDENTIAL_CODES.has(failure.code)) return 'credential'
    if (UNREACHABLE_CODES.has(failure.code)) return 'unreachable'
    if (failure.code === RATE_LIMIT_CODE) return 'rate-limit'
    if (failure.code === TIMEOUT_CODE) return 'timeout'
    return 'other'
}

/**
 * 该失败是否指明「就是这个推理级别不被支持」的第一个条件：宿主判为「请求参数不正确」
 * （`INVALID_REQUEST`）。
 *
 * 不支持必然落在客户端错误里；5xx、限流、超时、传输中断都是别的问题，不能算到档位头上。该码是宿主
 * `classifyPiAiError` 用 `/\b400\b|invalid.?request/i` 从报错文案里认出来的，`status` 在 pi-ai 侧恒缺、
 * 我们看不到，故只能取宿主已经归一好的结论，**不再自己比对文案**——上游措辞千差万别（实测有只列可用档位的、
 * 也有原样回显的），还有些网关在 4xx 里回显请求体，按文案匹配只会多出误判面。
 *
 * 第二个条件是「除档位外别无变量」，两个功能各用自己的对照（验证用不带档位的基线探测，
 * 探测式填充用同模型已跑通的更低档位），由 `runGroup` 保证后才落「档位不支持」这个结论。
 */
export function isEffortRejection(failure: VerifyFailureFacts | undefined): boolean {
    return failure?.code === INVALID_REQUEST_CODE
}

/**
 * 一轮请求的两条硬闸：真正会发出的**请求数**与计划里的**模型数**。
 *
 * 上限约束的是烧掉的额度，故超出即拒绝而非静默截断——截断会让用户以为「全查过了」。
 * 验证按用户勾选展开（档位累加），探测式填充按模型展开（固定 7 档/模型），量级差一个数量级，
 * 故两者各给一份配额；入参校验本身共用一份实现（`planProbes`），只有上限不同。
 */
export interface ProbeLimits {
    /** 真正会发出的请求数上限（含不带档位的基线探测） */
    maxProbes: number
    /** 计划模型数上限（按「提供方 / 模型」去重） */
    maxModels: number
}

/** 验证的配额：勾选展开，请求数封顶 200（超出即拒绝，用户可减少勾选重来） */
export const VERIFY_LIMITS: ProbeLimits = { maxProbes: 200, maxModels: Number.POSITIVE_INFINITY }
/** 探测式填充的配额：全量展开为「模型数 × 7 档」，故模型数封顶 200（至多 1400 次最小请求） */
export const PROBE_LIMITS: ProbeLimits = { maxProbes: 1400, maxModels: 200 }

/**
 * 校验并展开请求载荷为清单：按模型序遍历，每个模型带上它自己要试的那些档位。
 *
 * 清单里只有**被验对象**：每个档位一条请求；模型没有档位可验时，那一条不带 `reasoningEffort` 的请求
 * 本身就是被验对象。`needTest` 为真的模型另需一次不带档位的**基线探测**作对照（判「某档位不被支持」全靠它，
 * 上游对这类报错的格式千差万别），但基线不进清单——它在执行阶段按需现发，不被统计、也不产出记录。
 * 任何非法条目或超出 `limits` 一律拒绝（返回 undefined）。
 */
export function planProbes(payload: unknown, limits: ProbeLimits = VERIFY_LIMITS): VerifyProbe[] | undefined {
    if (!isPlainObject(payload)) return
    const models = payload.models
    if (!Array.isArray(models) || models.length === 0) return
    const probes: VerifyProbe[] = []
    for (const entry of models) {
        if (!isPlainObject(entry)) return
        const { provider, model, efforts, needTest } = entry
        if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return
        if (!Array.isArray(efforts) || typeof needTest !== 'boolean') return
        if (efforts.length === 0) {
            // 没有档位要验：这次请求就是被验对象，不存在「对照」一说，故 needTest 必假
            if (needTest) return
            probes.push({ provider, model, needTest })
            continue
        }
        for (const effort of efforts) {
            // 档位须落在 harness 支持的取值内：入参来自浏览器，而浏览器亦只从配置里取键，仍按不可信输入校验
            if (typeof effort !== 'string' || !LEVELS.has(effort)) return
            probes.push({ provider, model, effort, needTest })
        }
    }
    // 请求数算的是真正会发出的那些（含基线）：它约束的是烧掉的额度，清单长度只是它的一部分。
    // 基线每模型至多一条，故按模型去重后再计数（同一模型的若干档位只多算一条）
    const plannedModels = new Set<string>()
    let requests = probes.length
    for (const probe of probes) {
        const key = JSON.stringify([probe.provider, probe.model])
        if (plannedModels.has(key)) continue
        plannedModels.add(key)
        if (probe.needTest) requests++
    }
    return requests > limits.maxProbes || plannedModels.size > limits.maxModels ? undefined : probes
}

/** 按 provider 分组，组内保持探测原序；组序为提供方首次出现序 */
export function groupProbesByProvider(probes: readonly VerifyProbe[]): ProviderProbeGroup[] {
    const byProvider = new Map<string, ProviderProbeGroup>()
    probes.forEach((probe, index) => {
        let group = byProvider.get(probe.provider)
        if (group === undefined) {
            group = { provider: probe.provider, indexes: [], probes: [] }
            byProvider.set(probe.provider, group)
        }
        group.indexes.push(index)
        group.probes.push(probe)
    })
    return [...byProvider.values()]
}

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
 * 从 `from` 之后起与它同模型的探测条数。请求按模型分组生成，故这些就是该模型剩下的档位。
 */
export function sameModelTail(probes: readonly VerifyProbe[], from: number): number {
    let count = 0
    for (let index = from + 1; index < probes.length && probes[index]?.model === probes[from]?.model; index++) count++
    return count
}

/**
 * 单组结论 -> 汇报：可用模型按「提供方 / 模型」去重；档位不可用单独计数，不与其它失败混计。
 * 可达 / 凭据取自**全程**结果（被验请求与基线探测一并计入）而非首个：跑到一半才撞上额度耗尽同样该如实记为凭据不可用。
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
        } else if (item.outcome === 'quota' || item.outcome === 'credential') {
            keyRejected = true
        }
    }
    // 基线探测同样能证伪端点与凭据（它也是真发出去的一次请求），故一并纳入；只是它不产明细、不计任何计数
    for (const item of result.tests) {
        if (item.outcome === 'unreachable') unreachable = true
        else if (item.outcome === 'quota' || item.outcome === 'credential') keyRejected = true
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
 * 校验并展开未信任载荷，按提供方分组返回待跑清单；入参非法即抛出。
 *
 * 与执行拆成两步是有原因的：`done` 帧必须等**整轮**结束才发，而探测式填充的「整轮」含收敛写回——
 * 写回结果要随终帧一起交回浏览器半，故计划得先交到调用方手里（它还要拿模型清单去写配置）。
 *
 * @param payload 未信任的请求载荷（浏览器半发的模型清单）
 * @param limits 本轮的两条硬闸（请求数 / 模型数），验证与探测式填充各用一份
 * @param rejectMessage 入参非法时的报错文案：两个功能说法不同，由调用方给出
 */
export function planProbeGroups(payload: unknown, limits: ProbeLimits, rejectMessage: string): ProviderProbeGroup[] {
    const probes = planProbes(payload, limits)
    if (probes === undefined) throw new Error(rejectMessage)
    return groupProbesByProvider(probes)
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
