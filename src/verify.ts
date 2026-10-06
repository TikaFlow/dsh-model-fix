/**
 * 模型可用性验证：对每个勾选模型声明的每个推理级别各发一次最小请求（各模型档位数量不同，是累加而非相乘），仅以适配器是否真正开始产出内容块（`block-start`）判定可用，
 * 不看返回内容——不少提供方并不按提示词原样作答，只判内容会把可用的模型误判为不可用。
 *
 * 请求复用宿主 `ctx.llm`（LlmRuntime）而不是自建 HTTP：凭据只在宿主的凭据缝内可读（插件读不到 API Key），
 * 适配器路由与协议差异（openai-completions / openai-responses / anthropic-messages）也一律由宿主承担。
 * 全程只读——不碰 settings、不占事件流守卫，也不落任何「已验证」账本（结果即用即弃；会过期的账本比没有更危险）。
 *
 * 并发模型：**同一提供方恒为 1 并发**（一个 provider 一条串行链，前一次返回后才发下一次，规避 429），
 * 跨提供方最多 VERIFY_PROVIDER_CONCURRENCY 路；单次失败即计不可用，不重试不退避（避免在已判定不可用的端点上继续消耗额度与时间）。
 *
 * 判定口径：流中出现首个 `block-start` 即判该「模型 × 档位」可用（随即中断、不再消耗生成额度）；
 * `usage` 不含受理信息——额度耗尽的 key 也会先来一条，只判「非 finish」会把它误判为可用。
 * 其余情况读到终止块，按 `LlmFailure` 的 `code` / `status` 分类（宿主明令 route on `code`，不比对文案）：
 * 档位不被支持 / 额度耗尽 / 凭据无效 / 端点不可达（无 HTTP status）/ 其它。
 *
 * 短路：同一提供方共用同一 url 与同一把 key，**端点不可达 / 额度耗尽 / 凭据无效**这三类一旦出现，
 * 该组剩余探测必然同样失败，故立即短路——省下的额度就是省下的钱。档位不被支持属逐模型逐档位的个体结论，
 * 只记录不短路。我方超时不算「端点不可达」，慢端点不该被当成断线。
 *
 * 中止与进度：`verifyModels` 接受外部 `signal`（客户端断开或用户点停止）与 `onProgress` 出口。
 * 中止同时断掉在途请求**并**让执行循环早停——只断请求而继续循环，后续探测会带着已中止的信号跑出一串假失败。
 * 验证是即用即弃的诊断，用户已经不在之后继续跑等于白烧他的额度，故一律干净停在探测边界上。
 * 进度按 `opened` → 每条 `probed` → 收于 `done` 发出；**中止时不发 `done`**，
 * 消费方见「流自然结束却没等到 done」即知这轮没跑完，据此保留进度而不是报成功。
 *
 * 纯计划与汇报（planProbes / groupProbesByProvider / classifyFailure / reportProvider / summarizeProviders）
 * 零 ctx、不触网；执行器 `verifyModels` 只依赖注入的 `llm.stream`，故带桩即可把短路与中止一并单测。
 */

import type { LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
// LlmFailure 定义在 types 子路径（包根只 import 未再导出）；仅取类型，擦除后不落运行期依赖
import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import { LEVELS } from '@/constants'
import { PLUGIN_NAME } from '@/shared/constants'
import { isPlainObject } from '@/shared/types'
import { isProviderBlocking } from '@/shared/verify-progress'
import type { ProbeOutcome, ProviderBlockReason, ProviderProbeOutcome, UnsupportedEffort, VerifyFailureFacts, VerifyProbe, VerifyProbeResult, VerifyProgressFrame, VerifyProviderReport, VerifySummary } from '@/shared/verify-progress'

/** 探测提示词：只要一句应答，最省 token */
const VERIFY_PROMPT = 'Just say OK'
/** 单次探测的等待上限（毫秒）：超时视为不可用，防个别端点把整批拖死 */
const VERIFY_TIMEOUT_MS = 30_000
/** 同时在跑的**提供方**数（不是单提供方并发数——后者恒为 1，由分组串行保证） */
const VERIFY_PROVIDER_CONCURRENCY = 5
/** 单次验证的探测总数上限：逐模型逐档位展开会累积条目，超出即拒绝而非静默截断（前端也据此禁用确认键） */
const MAX_VERIFY_PROBES = 200

/** 一个提供方的探测组：组内顺序执行即「每 provider 单并发」的结构保证 */
export interface ProviderProbeGroup {
    provider: string
    /** 各探测在原数组中的下标（结果按此回填，汇总与顺序无关） */
    indexes: number[]
    probes: VerifyProbe[]
}

/** 宿主规范码：额度 / 余额耗尽 */
const QUOTA_CODES: ReadonlySet<string> = new Set(['QUOTA', 'ACCOUNT_QUOTA_EXCEEDED'])
/** 宿主规范码：凭据缺失或无效 */
const CREDENTIAL_CODES: ReadonlySet<string> = new Set(['INVALID_CREDENTIAL', 'MISSING_CREDENTIAL'])
/** 宿主规范码：模型未声明请求的这一推理级别（宿主在派发前本地拒绝，请求根本没发出去） */
const UNSUPPORTED_EFFORT_CODE = 'UNSUPPORTED_REASONING_EFFORT'
/**
 * 宿主给出的传输层失败码：连接中断、流被截断。真「连不上」只有这一类信号。
 *
 * **不能拿「`status` 缺失」当不可达**：pi-ai 侧的错误一律不带 status——`llm-pi-ai` 抛错只给
 * `new LlmError(message, code)`，终止错误也只给 `{ message, code }`，任何上游状态码（400、5xx）
 * 在到达我们之前就被压成了文案。故 status 缺失只说明「不是 HTTP 层拒绝」，不说明「连不上」；
 * 按它判会把一次 400 或一次 5xx 误报成断线，进而错误短路整个 provider 剩下的全部模型。
 */
const UNREACHABLE_CODES: ReadonlySet<string> = new Set(['TRANSPORT', 'STREAM_CLOSED'])

/**
 * 由终止块的失败事实判定探测结果。一律按宿主的 `code` 判：不看 `status`（对 pi-ai 侧恒缺），
 * 也不比对文案。未识别的码一律归「其它厂商侧拒绝」，多与具体模型有关，故不参与 provider 级短路。
 */
export function classifyFailure(failure: LlmFailure): Exclude<ProbeOutcome, 'usable'> {
    if (failure.code === UNSUPPORTED_EFFORT_CODE) return 'unsupported-effort'
    if (QUOTA_CODES.has(failure.code)) return 'quota'
    if (CREDENTIAL_CODES.has(failure.code)) return 'credential'
    if (UNREACHABLE_CODES.has(failure.code)) return 'unreachable'
    return 'other'
}

/**
 * 校验并展开 RPC 入参为探测清单：按模型序遍历，每个模型带上它自己声明的那些档位——各模型档位数量不同，是累加而非相乘。
 *
 * 每个模型都以一次**不带 reasoningEffort** 的探测开头作基线，后续才逐档位：连不带档位都跑不通的模型，
 * 换任何档位也是同样结果，没必要把每个档位各烧一次；跑得通的模型再逐档位验，此时某档位失败即可归因到
 * 该档位本身——上游对「这一档不被支持」的报错格式千差万别，只能靠这个对照，不能靠 code 或文案。
 * 无档位的模型只有基线那一次。
 * 任何非法条目或超出 MAX_VERIFY_PROBES 一律拒绝（返回 undefined）。
 */
export function planProbes(payload: unknown): VerifyProbe[] | undefined {
    if (!isPlainObject(payload)) return
    const models = payload.models
    if (!Array.isArray(models) || models.length === 0) return
    const probes: VerifyProbe[] = []
    for (const entry of models) {
        if (!isPlainObject(entry)) return
        const { provider, model, efforts } = entry
        if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') return
        if (!Array.isArray(efforts)) return
        probes.push({ provider, model })
        for (const effort of efforts) {
            // 档位须落在 harness 支持的取值内：入参来自浏览器，而浏览器亦只从配置里取键，仍按不可信输入校验
            if (typeof effort !== 'string' || !LEVELS.has(effort)) return
            probes.push({ provider, model, effort })
        }
    }
    return probes.length > MAX_VERIFY_PROBES ? undefined : probes
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

/**
 * 单组结论 -> 汇报：可用模型按「提供方 / 模型」去重；档位不可用单独计数，不与其它失败混计。
 * 可达 / 凭据取自**全程**结果而非首个：探测跑到一半才撞上额度耗尽同样该如实记为凭据不可用。
 */
export function reportProvider(result: ProviderProbeOutcome): VerifyProviderReport {
    const usable = new Set<string>()
    let efforts = 0
    let unsupported = 0
    let unreachable = false
    let keyRejected = false
    for (const item of result.results) {
        if (item.outcome === 'usable') {
            // 可用模型数含基线（不带档位也跑得通就算这个模型可用）；可用**档位**数只计带档位的探测，
            // 基线是判据不是被验对象，不进「X / Y 个推理级别」的分子分母
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
    return {
        provider: result.provider,
        reachable: !unreachable,
        // 从未拿到 HTTP 响应时无从判断凭据，如实不报「有效」
        keyValid: !unreachable && !keyRejected,
        skipped: result.blockedBy !== undefined,
        blockedBy: result.blockedBy,
        models: usable.size,
        efforts,
        unsupported,
        planned: result.planned,
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
    let probed = 0
    for (const report of reports) {
        models += report.models
        efforts += report.efforts
        unsupported += report.unsupported
        planned += report.planned
        probed += report.probed
    }
    // 不支持档位明细：只认明确判为不支持、且确实带档位的条目（不带档位的探测走不到那个结论）。
    // 与上面的聚合同源，不另算一套口径，免得两处分叉。
    // 同一趟顺带数「验了多少个模型」：不能用 report.models——那是可用模型数，全档位失败的模型不计入，
    // 拿它当验证数会在开档位模式下小于用户勾选数
    const unsupportedEfforts: UnsupportedEffort[] = []
    const testedModels = new Set<string>()
    for (const item of results) {
        testedModels.add(JSON.stringify([item.provider, item.model]))
        if (item.outcome === 'unsupported-effort' && item.effort !== undefined) {
            unsupportedEfforts.push({ provider: item.provider, model: item.model, effort: item.effort })
        }
    }
    return {
        providers: reports,
        results,
        unsupportedEfforts,
        tested: testedModels.size,
        models,
        efforts,
        unsupported,
        planned,
        probed,
    }
}

/** 取失败事实的可序列化子集（供调用方自行细分，不参与本插件的判定） */
function failureFacts(failure: LlmFailure): VerifyFailureFacts {
    return { code: failure.code, status: failure.status, message: failure.message }
}

/** 一次探测的判定：结论 + 失败时的原始事实（收到 block-start 时无事实） */
interface ProbeVerdict {
    outcome: ProbeOutcome
    failure: VerifyFailureFacts | undefined
}

/**
 * 发一次探测并判定：收到首个 `block-start` 即判「受支持」；否则读到终止块、据其失败事实分类。
 * 我方超时引发的 `aborted` 不算「端点不可达」——那会把慢端点误判成断线，进而错误短路整组。
 */
async function probeOnce(llm: Pick<LlmRuntime, 'stream'>, probe: VerifyProbe, signal: AbortSignal): Promise<ProbeVerdict> {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, VERIFY_TIMEOUT_MS)
    try {
        for await (const chunk of llm.stream({
            provider: probe.provider,
            model: probe.model,
            // 档位 id 取自宿主自己的 reasoningEfforts 配置键（即模型页送出的同一个值），断言只为满足品牌类型，
            // 免为此引入 @deepseek-ai/dsh-llm 的运行期值导入
            ...(probe.effort === undefined ? {} : { reasoningEffort: probe.effort as ReasoningEffortId }),
            messages: [{ role: 'user', content: [{ type: 'text', text: VERIFY_PROMPT }] }],
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
                // stop / tool-calls / max-tokens：正常终止却没有内容块，宿主归为退化完成，同样不可用
                if (reason.kind !== 'error' && reason.kind !== 'aborted') return { outcome: 'other', failure: undefined }
                // 我方超时不算端点不可达，但原始失败事实照留，供调用方自行判断
                return {
                    outcome: timedOut ? 'other' : classifyFailure(reason.failure),
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
 * 从 `from` 之后起与它同模型的探测条数。探测按模型分组生成，故这些就是该模型剩下的档位。
 */
function sameModelTail(probes: readonly VerifyProbe[], from: number): number {
    let count = 0
    for (let index = from + 1; index < probes.length && probes[index]?.model === probes[from]?.model; index++) count++
    return count
}

/**
 * 该失败是否指明「就是这个推理级别不被支持」。三个条件缺一不可：
 *
 * - **4xx**：不支持必然落在客户端错误里；5xx、限流、超时、传输失败都是别的问题，不能算到档位头上。
 * - **报错原文里带上了带引号的该档位值**：上游拒绝一个值时通常原样回显，如
 *   `Invalid value for 'reasoning_effort': 'xmax'. Supported values are: 'low', 'high'`。
 *   只认**单引号**包裹的整档位 id：裸词会撞上散文里的同名字样（`请把 max 调到 4096 以内`），
 *   而双引号也不收——有些网关在 4xx 里回显请求体，JSON 用的正是双引号，收下它就会把
 *   「上下文超限 / 模型名错」这类失败误判成「这一档被拒」，进而送进剔除清单。宁可漏判不可误删。
 * - 基线已通过（模型本身确实能用），该条件由调用方保证，见 `runGroup`。
 *
 * 这是全插件**唯一**比对报错文案的地方，因为按 `code` 无法区分「档位不支持」与「参数写错」——
 * 上游一律回 4xx 里的 invalid_request，而 `LlmFailure.message` 正是两者唯一的差别。
 * 宿主自己映射 pi-ai 错误时同样只能比对文案（`llm-pi-ai` 的 `classifyPiAiError`）。
 */
function isEffortRejection(failure: VerifyFailureFacts | undefined, effort: string): boolean {
    if (failure?.status === undefined || failure.status < 400 || failure.status >= 500) return false
    return failure.message.includes(`'${effort}'`)
}

/**
 * 顺序跑完一组的探测（组内零并发）。两级短路：
 * - **provider 级**：同一提供方共用同一 url 与同一把 key，这次过不了后面同样过不了，没必要再花额度。
 * - **模型级**：某档位**报错**且不是「档位不支持」时，同模型的后续档位换过去也是同样结果，同样不必再花额度。
 *   「档位不支持」恰是唯一值得继续验的结论——换个档位可能就通了，那正是逐档位验的意义。
 *   只对有失败事实的探测生效：正常终止却没有内容块属退化完成，不是报错，换档位仍可能出内容。
 * 外部中止同样在此早停：只断在途请求而不停循环，后续探测会带着已中止的信号跑出一串假失败。
 */
async function runGroup(
    llm: Pick<LlmRuntime, 'stream'>,
    group: ProviderProbeGroup,
    signal: AbortSignal,
    emitProbe: (probe: VerifyProbe, verdict: ProbeVerdict, skipped: number | undefined) => void,
): Promise<ProviderProbeOutcome> {
    const results: VerifyProbeResult[] = []
    let blockedBy: ProviderBlockReason | undefined
    // 本组内基线已通过的模型：它们的档位探测失败即判该档位不支持
    const baselineOk = new Set<string>()
    for (let index = 0; index < group.probes.length; index++) {
        if (signal.aborted) break
        const probe = group.probes[index]
        const tail = sameModelTail(group.probes, index)
        // 基线 = 不带档位、且同模型后面还有探测（即开档位模式给每个模型补的那一次；无档位模型只有它自己）
        const isBaseline = probe.effort === undefined && tail > 0
        const verdict = await probeOnce(llm, probe, signal)
        // 基线已通过、且该档位的失败指明了「就是它」时，才判该档位不支持。判据见 isEffortRejection
        const outcome = probe.effort !== undefined && baselineOk.has(probe.model) && isEffortRejection(verdict.failure, probe.effort)
            ? 'unsupported-effort'
            : verdict.outcome
        if (isBaseline && outcome === 'usable') baselineOk.add(probe.model)
        results.push({
            provider: probe.provider,
            model: probe.model,
            effort: probe.effort,
            outcome,
            failure: verdict.failure,
        })
        // 两级短路的「剩余未发出的条数」在此一并算出：provider 级断到组尾，模型级只断到该模型自己的档位尾。
        // 消费方据此交代「还剩几条没验」，被跳过的探测不进 results，故 probed 少于 planned
        let skipped: number
        if (isProviderBlocking(outcome)) {
            blockedBy = outcome
            skipped = group.probes.length - index - 1
        } else if (isBaseline && outcome !== 'usable') {
            // 基线都跑不通，换任何档位也是同样结果，不必再逐档位烧额度
            skipped = tail
        } else if (verdict.failure !== undefined && outcome !== 'unsupported-effort') {
            skipped = tail
        } else {
            skipped = 0
        }
        if (skipped > 0) index += skipped
        emitProbe(probe, { outcome, failure: verdict.failure }, skipped === 0 ? undefined : skipped)
        if (blockedBy !== undefined) break
    }
    // 计划数只计带档位的探测：基线是判据不是被验对象，不进「X / Y 个推理级别」的分母
    return {
        provider: group.provider,
        results,
        blockedBy,
        planned: group.probes.filter((probe) => probe.effort !== undefined).length,
    }
}

/** 一次验证的可选控制项；不传即静默跑完，行为与引入进度帧之前完全一致 */
export interface VerifyOptions {
    /** 外部中止：客户端断开或用户点停止。已中止即不再发新探测 */
    signal?: AbortSignal
    /** 进度出口。`done` 帧只在整轮真正跑完时发出，中止时不发 */
    onProgress?: (frame: VerifyProgressFrame) => void
}

/** 「永不中止」的占位信号（AbortSignal 没有 null 态，未给 signal 时用它） */
const NEVER_ABORTED = new AbortController().signal

/**
 * 执行一次验证：入参校验 → 按提供方分组 → 逐组跑探测（组内零并发、组间最多五路）→ 逐组汇报并求和。
 * 返回逐提供方结论（可达 / 凭据 / 可用数 / 是否短路）与全局计数；入参非法即抛出，由调用方转 RPC 失败结果。
 */
export async function verifyModels(
    llm: Pick<LlmRuntime, 'stream'>,
    payload: unknown,
    options: VerifyOptions = {},
): Promise<VerifySummary> {
    const probes = planProbes(payload)
    if (probes === undefined) throw new Error(`${PLUGIN_NAME}: 验证请求不合法（模型条目或推理级别取值越界）`)
    const signal = options.signal ?? NEVER_ABORTED
    const groups = groupProbesByProvider(probes)
    // 稀疏数组：中止时从未开跑的组保持 undefined，汇报时据实排除——把它们报成「全可用」或「全不可用」都是撒谎
    const outcomes = new Array<ProviderProbeOutcome>(groups.length)
    let completed = 0
    const emitProbe = (probe: VerifyProbe, verdict: ProbeVerdict, skipped: number | undefined): void => {
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
            total: probes.length,
        })
    }
    options.onProgress?.({ type: 'opened', total: probes.length })
    // 第 w 个 worker 只跑下标 ≡ w (mod workers) 的组：一个普通 for 即可切分，无需共享游标，
    // 各 worker 拿到的组数相差至多一个；组内逐条 await 即「同一 provider 零并发」
    const workers = Math.min(VERIFY_PROVIDER_CONCURRENCY, groups.length)
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
    const summary = summarizeProviders(reports, details)
    // 中止不发 done：消费方见「流自然结束却没等到 done」即知这轮没跑完，据此保留进度而不是报成功
    if (!signal.aborted) options.onProgress?.({ type: 'done', summary })
    return summary
}