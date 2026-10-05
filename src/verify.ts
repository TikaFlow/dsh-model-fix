/**
 * 模型可用性验证：对「模型 × 推理级别」笛卡尔积各发一次最小请求，仅以适配器是否真正开始产出内容块（`block-start`）判定可用，
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
 * 纯计划与汇报（planProbes / groupProbesByProvider / classifyFailure / reportProvider / summarizeProviders）
 * 零 ctx、不触网；执行器 `verifyModels` 只依赖注入的 `llm.stream`，故带桩即可把短路等行为一并单测。
 */

import type { LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
// LlmFailure 定义在 types 子路径（包根只 import 未再导出）；仅取类型，擦除后不落运行期依赖
import type { LlmFailure } from '@deepseek-ai/dsh-llm/types'
import { LEVELS } from '@/constants'
import { PLUGIN_NAME } from '@/shared/constants'
import { isPlainObject } from '@/shared/types'

/** 探测提示词：只要一句应答，最省 token */
const VERIFY_PROMPT = 'Just say OK'
/** 单次探测的等待上限（毫秒）：超时视为不可用，防个别端点把整批拖死 */
const VERIFY_TIMEOUT_MS = 30_000
/** 同时在跑的**提供方**数（不是单提供方并发数——后者恒为 1，由分组串行保证） */
const VERIFY_PROVIDER_CONCURRENCY = 5
/** 单次验证的探测总数上限：笛卡尔积会放大条目，超出即拒绝而非静默截断（前端也据此禁用确认键） */
const MAX_VERIFY_PROBES = 200

/** 单次探测：一次请求 = 一个「模型 × 推理级别」组合（effort 缺省即不带档位探测） */
export interface VerifyProbe {
    provider: string
    model: string
    effort?: string
}

/** 一个提供方的探测组：组内顺序执行即「每 provider 单并发」的结构保证 */
export interface ProviderProbeGroup {
    provider: string
    /** 各探测在原数组中的下标（结果按此回填，汇总与顺序无关） */
    indexes: number[]
    probes: VerifyProbe[]
}

/**
 * 单次探测的判定结果。分类只依据宿主 `LlmFailure` 的 `code` 与 `status`——宿主明令
 * 「route on `code`, never by parsing `message`」，故本文件不做任何文案比对。
 */
export type ProbeOutcome =
    /** 收到 `block-start`：该「模型 × 档位」确实受支持 */
    | 'usable'
    /** 宿主在派发前本地判定该档位不被支持（`UNSUPPORTED_REASONING_EFFORT`，请求根本没发出去） */
    | 'unsupported-effort'
    /** 传输层失败且无 HTTP status：端点不可达（DNS / 拒绝连接） */
    | 'unreachable'
    /** 额度或余额耗尽 */
    | 'quota'
    /** 凭据缺失或无效 */
    | 'credential'
    /** 其它厂商侧拒绝；多与**具体模型**有关（如同名模型不存在），故不参与短路 */
    | 'other'

/** provider 级失败：命中即整组短路——同一提供方共用同一 url 与同一把 key，一次过不了后面同样过不了 */
export type ProviderBlockReason = 'unreachable' | 'quota' | 'credential'

/** 宿主规范码：额度 / 余额耗尽 */
const QUOTA_CODES: ReadonlySet<string> = new Set(['QUOTA', 'ACCOUNT_QUOTA_EXCEEDED'])
/** 宿主规范码：凭据缺失或无效 */
const CREDENTIAL_CODES: ReadonlySet<string> = new Set(['INVALID_CREDENTIAL', 'MISSING_CREDENTIAL'])
/** 宿主规范码：模型未声明请求的这一推理级别 */
const UNSUPPORTED_EFFORT_CODE = 'UNSUPPORTED_REASONING_EFFORT'

/**
 * 由终止块的失败事实判定探测结果。
 *
 * 传输层失败没有 HTTP status——宿主 `normalizeLlmFailure` 的兜底对象只带 `message` 与 `code`，
 * 而 HTTP 层拒绝会带上 `status`，故 status 缺失即判「端点不可达」。这比比对报错文案可靠得多。
 */
export function classifyFailure(failure: LlmFailure): Exclude<ProbeOutcome, 'usable'> {
    if (failure.code === UNSUPPORTED_EFFORT_CODE) return 'unsupported-effort'
    if (QUOTA_CODES.has(failure.code)) return 'quota'
    if (CREDENTIAL_CODES.has(failure.code)) return 'credential'
    if (failure.status === undefined) return 'unreachable'
    return 'other'
}

/** 该结果是否构成 provider 级失败（命中即整组短路） */
export function isProviderBlocking(outcome: ProbeOutcome): outcome is ProviderBlockReason {
    return outcome === 'unreachable' || outcome === 'quota' || outcome === 'credential'
}

/** 一个提供方的探测结论：逐探测结果 + 短路情况（由执行器产出，供汇报函数消费） */
export interface ProviderProbeOutcome {
    provider: string
    /** 与该组 `probes` 前缀对齐：短路时长度小于 probes.length */
    outcomes: ProbeOutcome[]
    blockedBy: ProviderBlockReason | undefined
    planned: number
}

/** 单个提供方的验证结论（RPC 回传，逐提供方可见） */
export interface VerifyProviderReport {
    provider: string
    /** 端点可达：全程未出现传输层失败 */
    reachable: boolean
    /** 凭据有效且有额度：可达且全程未出现额度 / 凭据类失败（从未可达时不作断言） */
    keyValid: boolean
    /** 整组是否因 provider 级失败被短路 */
    skipped: boolean
    blockedBy: ProviderBlockReason | undefined
    /** 该组内可用模型数（按「提供方 / 模型」去重） */
    models: number
    /** 该组内可用档位数 */
    efforts: number
    /** 判定为「档位不支持」的探测数：逐模型逐档位，故与其它失败分开计数 */
    unsupported: number
    /** 计划探测数 */
    planned: number
    /** 实际发出数（短路时小于 planned） */
    probed: number
}

/** 验证结果汇总：逐提供方汇报 + 全局计数（RPC 回传卡片内联状态行） */
export interface VerifySummary {
    providers: readonly VerifyProviderReport[]
    models: number
    efforts: number
    unsupported: number
    planned: number
    probed: number
}

/**
 * 校验并展开 RPC 入参为探测清单（笛卡尔积：模型序 × 入参给定的档位序）。
 * 无档位的模型产出一次不带 reasoningEffort 的探测；任何非法条目或超出 MAX_VERIFY_PROBES 一律拒绝（返回 undefined）。
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
        for (const effort of efforts) {
            // 档位须落在 harness 支持的取值内：入参来自浏览器，而浏览器亦只从配置里取键，仍按不可信输入校验
            if (typeof effort !== 'string' || !LEVELS.has(effort)) return
            probes.push({ provider, model, effort })
        }
        if (efforts.length === 0) probes.push({ provider, model })
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
export function reportProvider(group: ProviderProbeGroup, result: ProviderProbeOutcome): VerifyProviderReport {
    const usable = new Set<string>()
    let efforts = 0
    let unsupported = 0
    let unreachable = false
    let keyRejected = false
    for (let index = 0; index < result.outcomes.length; index++) {
        const outcome = result.outcomes[index]
        if (outcome === 'usable') {
            efforts++
            usable.add(JSON.stringify([group.probes[index].provider, group.probes[index].model]))
        } else if (outcome === 'unsupported-effort') {
            unsupported++
        } else if (outcome === 'unreachable') {
            unreachable = true
        } else if (outcome === 'quota' || outcome === 'credential') {
            keyRejected = true
        }
    }
    return {
        provider: group.provider,
        reachable: !unreachable,
        // 从未拿到 HTTP 响应时无从判断凭据，如实不报「有效」
        keyValid: !unreachable && !keyRejected,
        skipped: result.blockedBy !== undefined,
        blockedBy: result.blockedBy,
        models: usable.size,
        efforts,
        unsupported,
        planned: result.planned,
        probed: result.outcomes.length,
    }
}

/** 全局汇总：各组汇报相加（可用模型在组内已去重，跨组本就分属不同提供方，无跨组撞键） */
export function summarizeProviders(reports: readonly VerifyProviderReport[]): VerifySummary {
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
    return { providers: reports, models, efforts, unsupported, planned, probed }
}

/**
 * 发一次探测并判定：收到首个 `block-start` 即判「受支持」；否则读到终止块、据其失败事实分类。
 * 我方超时引发的 `aborted` 不算「端点不可达」——那会把慢端点误判成断线，进而错误短路整组。
 */
async function probeOnce(llm: Pick<LlmRuntime, 'stream'>, probe: VerifyProbe): Promise<ProbeOutcome> {
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
            signal: controller.signal,
        })) {
            // 只认 block-start——它证明适配器已真正开始产出内容块（宿主 isVisibleChunk 同样把 usage / finish 排除在「内容」之外）。
            // 不能沿用「首个非 finish 块即成功」：额度耗尽的 key 也会先来一条 usage，那不是受理信号。
            // 命中即返回，随后的 finally 中断请求、不再消耗生成额度
            if (chunk.type === 'block-start') return 'usable'
            if (chunk.type === 'finish') {
                const reason = chunk.reason
                // stop / tool-calls / max-tokens：正常终止却没有内容块，宿主归为退化完成，同样不可用
                if (reason.kind !== 'error' && reason.kind !== 'aborted') return 'other'
                if (timedOut) return 'other'
                return classifyFailure(reason.failure)
            }
        }
        return 'other'
    } catch {
        // 适配器未注册等抛出的异常一律归入「其它失败」，不参与短路——宁可少短路，不可误短路
        return 'other'
    } finally {
        clearTimeout(timer)
        controller.abort()
    }
}

/**
 * 顺序跑完一组的探测（组内零并发）。命中 provider 级失败即短路该组剩余探测——
 * 同一提供方共用同一 url 与同一把 key，这次过不了后面同样过不了，没必要再花额度。
 */
async function runGroup(llm: Pick<LlmRuntime, 'stream'>, group: ProviderProbeGroup): Promise<ProviderProbeOutcome> {
    const outcomes: ProbeOutcome[] = []
    let blockedBy: ProviderBlockReason | undefined
    for (const probe of group.probes) {
        const outcome = await probeOnce(llm, probe)
        outcomes.push(outcome)
        if (isProviderBlocking(outcome)) {
            blockedBy = outcome
            break
        }
    }
    return { provider: group.provider, outcomes, blockedBy, planned: group.probes.length }
}

/**
 * 执行一次验证：入参校验 → 按提供方分组 → 逐组跑探测（组内零并发、组间最多五路）→ 逐组汇报并求和。
 * 返回逐提供方结论（可达 / 凭据 / 可用数 / 是否短路）与全局计数；入参非法即抛出，由调用方转 RPC 失败结果。
 */
export async function verifyModels(llm: Pick<LlmRuntime, 'stream'>, payload: unknown): Promise<VerifySummary> {
    const probes = planProbes(payload)
    if (probes === undefined) throw new Error(`${PLUGIN_NAME}: 验证请求不合法（模型条目或推理级别取值越界）`)
    const groups = groupProbesByProvider(probes)
    const results = new Array<ProviderProbeOutcome>(groups.length)
    // 第 w 个 worker 只跑下标 ≡ w (mod workers) 的组：一个普通 for 即可切分，无需共享游标，
    // 各 worker 拿到的组数相差至多一个；组内逐条 await 即「同一 provider 零并发」
    const workers = Math.min(VERIFY_PROVIDER_CONCURRENCY, groups.length)
    await Promise.all(Array.from({ length: workers }, (_, worker) => (async () => {
        for (let at = worker; at < groups.length; at += workers) {
            results[at] = await runGroup(llm, groups[at])
        }
    })()))
    return summarizeProviders(groups.map((group, at) => reportProvider(group, results[at])))
}