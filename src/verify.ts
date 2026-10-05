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
 * 判定口径：流中出现首个 `block-start` 即成功（证明适配器已真正开始产出内容块，随即中断、不再消耗生成额度）。
 * `usage` 不含受理信息——额度耗尽的 key 也会先来一条，只判「非 finish」会把它误判为可用；
 * 全程无内容块、超时、异常与 error / aborted 终止一律判失败。
 *
 * 纯函数（planProbes / groupProbesByProvider / summarizeProbes）零 ctx、不触网，由 test/verify.test.ts 守护；
 * 脏执行只此一处。
 */

import type { LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
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

/** 验证结果汇总：可用模型数、可用档位数与探测总数（RPC 回传卡片内联状态行） */
export interface VerifySummary {
    models: number
    efforts: number
    total: number
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

/** 汇总探测结果：models 为可用模型去重数，efforts 为成功探测数（无档位模型那一次也计 1），total 为探测总数 */
export function summarizeProbes(probes: readonly VerifyProbe[], ok: readonly boolean[]): VerifySummary {
    const usable = new Set<string>()
    let efforts = 0
    for (let index = 0; index < probes.length; index++) {
        if (ok[index] !== true) continue
        efforts++
        usable.add(JSON.stringify([probes[index].provider, probes[index].model]))
    }
    return { models: usable.size, efforts, total: probes.length }
}

/** 发一次探测并判定可用性：收到首个 `block-start` 即受理成功，全程无内容块、超时或异常一律不可用 */
async function probeOnce(llm: Pick<LlmRuntime, 'stream'>, probe: VerifyProbe): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, VERIFY_TIMEOUT_MS)
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
            if (chunk.type === 'block-start') return true
        }
        return false
    } catch {
        // 适配器未注册、凭据不可用、额度耗尽、本地档位校验拒绝等一律判不可用（单次失败不中断整批）
        return false
    } finally {
        clearTimeout(timer)
        controller.abort()
    }
}

/**
 * 执行一次验证：入参校验 → 按提供方分组 → 顺序跑完每组的探测（组内零并发、组间最多四路）→ 汇总。
 * 返回可用模型数 / 可用档位数 / 探测总数；入参非法即抛出，由调用方转 RPC 失败结果。
 */
export async function verifyModels(llm: Pick<LlmRuntime, 'stream'>, payload: unknown): Promise<VerifySummary> {
    const probes = planProbes(payload)
    if (probes === undefined) throw new Error(`${PLUGIN_NAME}: 验证请求不合法（模型条目或推理级别取值越界）`)
    const groups = groupProbesByProvider(probes)
    const ok = new Array<boolean>(probes.length).fill(false)
    // 第 w 个 worker 只跑下标 ≡ w (mod workers) 的组：一个普通 for 即可切分，无需共享游标，
    // 各 worker 拿到的组数相差至多一个；组内逐条 await 即「同一 provider 零并发」
    const workers = Math.min(VERIFY_PROVIDER_CONCURRENCY, groups.length)
    await Promise.all(Array.from({ length: workers }, (_, worker) => (async () => {
        for (let at = worker; at < groups.length; at += workers) {
            const group = groups[at]
            for (let i = 0; i < group.probes.length; i++) {
                ok[group.indexes[i]] = await probeOnce(llm, group.probes[i])
            }
        }
    })()))
    return summarizeProbes(probes, ok)
}