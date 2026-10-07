/**
 * 模型可用性验证：对每个勾选模型声明的每个推理级别各发一次最小请求（各模型档位数量不同，是累加而非相乘），仅以适配器是否真正开始产出内容块（`block-start`）判定可用，
 * 不看返回内容——不少提供方并不按提示词原样作答，只判内容会把可用的模型误判为不可用。
 *
 * 请求复用宿主 `ctx.llm`（LlmRuntime）而不是自建 HTTP：凭据只在宿主的凭据缝内可读（插件读不到 API Key），
 * 适配器路由与协议差异（openai-completions / openai-responses / anthropic-messages）也一律由宿主承担。
 * 全程只读——不碰 settings、不占事件流守卫，也不落任何「已验证」账本（结果即用即弃；会过期的账本比没有更危险）。
 *
 * 并发模型：**同一提供方恒为 1 并发**（一个 provider 一条串行链，前一次返回后才发下一次，规避 429），
 * 跨提供方最多 `PROBE_PROVIDER_CONCURRENCY` 路；单次失败即计不可用，不重试不退避（避免在已判定不可用的端点上继续消耗额度与时间）。
 *
 * 判定口径、短路规则、进度帧与中止语义全在 `@/probe-engine`（与「探测式填充」共用，见那处的说明），
 * 本模块只留验证独有的一段：**每个模型至多一次不带档位的基线探测**，以及据此判「某档位不被支持」。
 *
 * 中止与进度：接受外部 `signal`（客户端断开或用户点停止 / 关窗）与 `onProgress` 出口。中止同时断掉在途请求
 * **并**让执行循环早停——只断请求而继续循环，后续探测会带着已中止的信号跑出一串假失败。
 * 验证是即用即弃的诊断，用户已经不在之后继续跑等于白烧他的额度，故一律干净停在探测边界上。
 * 进度按 `opened` → 每条 `probed` → 收于 `done` 发出；**中止时不发 `done`**，
 * 消费方见「流自然结束却没等到 done」即知这轮没跑完，据此保留进度而不是报成功。
 *
 * 纯计划与汇报（`planProbes` / `groupProbesByProvider` / `classifyFailure` / `reportProvider` / `summarizeProviders`）
 * 在 `@/probe-engine`，零 ctx、不触网；执行器 `verifyModels` 只依赖注入的 `llm.stream`，故带桩即可把短路与中止一并单测。
 */

import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { PLUGIN_NAME } from '@/shared/constants'
import type { ProviderBlockReason, ProviderProbeOutcome, VerifyProbeResult, VerifySummary } from '@/shared/verify-progress'
import type { GroupRunner, ProbeEmitter, ProbeRunOptions, ProviderProbeGroup } from '@/probe-engine'
import { VERIFY_LIMITS, finishRun, isEffortRejection, planProbeGroups, probeOnce, providerBlockReason, runProbeGroups, sameModelTail, shouldSkipModelTail, shouldSkipModelTailAfterBaseline } from '@/probe-engine'

/** 验证请求不合法时的报错文案（入参来自浏览器半，一律按不可信输入校验） */
const VERIFY_REJECT_MESSAGE = `${PLUGIN_NAME}: 验证请求不合法（模型条目或推理级别取值越界）`

/**
 * 顺序跑完一组的验证请求（组内零并发）。
 *
 * 每模型**至多一次基线探测**：带档位的模型在验它第一条之前，先发一次不带档位的请求作对照——
 * 判「某档位不被支持」只能靠它（理由见 `isEffortRejection`）。基线不是被验对象：它不进明细、
 * 不计任何统计、跑通时也不留记录（用户看到的每一条都该是被验的那一次）。
 * 唯一的例外是**基线失败并据此短路**：那一条档位请求根本没发出去，用户无从得知，只能靠这条记录交代。
 *   瞬态失败（限流 / 超时）不留这种短路——它们只否定了这一次，随后照常逐档位验（见下）。
 * 两种模型没有基线：关掉档位开关时全部请求本就不带参数，以及模型没有声明任何档位时——
 * 那一次不带档位的请求本身就是被验对象（`needTest` 为假），故基线与它无从分开。
 *
 * 两级短路，判据只有一条：**能断定后续请求必然失败**（判据本体在 `@/probe-engine`，与「探测式填充」共用）：
 * - **provider 级**（`providerBlockReason`）：同一提供方共用同一 url 与同一把 key，这次过不了后面同样过不了。
 *   端点不通 / 凭据无效，外加**本组首个请求超时**——url 不可达、端点服务中断或本地网络不通，成因都落在
 *   请求之外，后续只会是同样无意义的超时。基线探测也算「本组的请求」，故首个请求常常正是它。
 * - **模型级**：档位请求上只有**额度耗尽**够格（`shouldSkipModelTail`）——同一把 key 的额度用完，
 *   换多少档都是同样结果。**基线请求**不带档位，失败天生与档位无关，故多认「被厂商确定性拒绝」一种
 *   （`shouldSkipModelTailAfterBaseline`）：模型不存在、参数被拒、无权限，换档位发出去的还是同一个请求。
 *   限流与超时两者都不算（`isTransientOutcome`）：它们只否定了这一次，否不了下一次——冷启动与限流窗口
 *   都可能让下一次反而跑通。实测限流挡掉的那一档，隔一会儿就通了。
 * 外部中止同样在此早停：只断在途请求而不停循环，后续请求会带着已中止的信号跑出一串假失败。
 */
const runGroup: GroupRunner = async (
    llm: Pick<LlmRuntime, 'stream'>,
    group: ProviderProbeGroup,
    signal: AbortSignal,
    emitProbe: ProbeEmitter,
): Promise<ProviderProbeOutcome> => {
    const results: VerifyProbeResult[] = []
    // 基线结论单列：它真发出去过，能证伪端点与凭据；但它不是被验对象，不混进明细与计数
    const tests: VerifyProbeResult[] = []
    let blockedBy: ProviderBlockReason | undefined
    // 本组已发出的请求数（含基线）：provider 级短路要区分「首个请求就超时」与「链路已跑通、只是这一次慢」
    let sent = 0
    // 本组内已发过基线的模型（每模型至多一次）与基线已通过的模型（它们的档位请求失败即判该档位不支持）
    const probed = new Set<string>()
    const baselineOk = new Set<string>()
    for (let index = 0; index < group.probes.length; index++) {
        if (signal.aborted) break
        const probe = group.probes[index]
        const tail = sameModelTail(group.probes, index)
        // 基线：组内该模型的第一条带 needTest 的请求即它的基线位。跑通只记事实、不发记录；
        // 失败则据其短路，并发一条记录交代「这个模型为什么没验成」
        if (probe.needTest && !probed.has(probe.model)) {
            probed.add(probe.model)
            const testVerdict = await probeOnce(llm, { provider: probe.provider, model: probe.model }, signal)
            sent += 1
            tests.push({
                provider: probe.provider,
                model: probe.model,
                effort: undefined,
                outcome: testVerdict.outcome,
                failure: testVerdict.failure,
            })
            const blockReason = testVerdict.outcome === 'usable' ? undefined : providerBlockReason(testVerdict.outcome, sent === 1)
            if (testVerdict.outcome === 'usable') {
                baselineOk.add(probe.model)
            } else if (blockReason !== undefined) {
                // 端点不通 / 凭据无效（以及本组首个请求就超时）：同一提供方共用同一 url 与同一把 key，整组都过不去
                blockedBy = blockReason
                // 未发出的条数含当前这条：它同样因基线不通而没发出去
                emitProbe({ provider: probe.provider, model: probe.model }, testVerdict, group.probes.length - index)
                break
            } else if (shouldSkipModelTailAfterBaseline(testVerdict.outcome)) {
                // 基线请求**不带推理级别**，故它的失败与档位无关：同一模型换任何档位，发出去的还是同一个请求。
                // 额度用尽、或被厂商确定性拒绝（模型不存在、参数被拒、无权限）时，后续必然同样失败，短到该模型尾
                emitProbe({ provider: probe.provider, model: probe.model }, testVerdict, tail + 1)
                index += tail
                continue
            } else {
                // 限流与超时只否定了这一次：冷启动、限流窗口都可能让下一次反而跑通，断不得。
                // 留一条模型级记录（不带档位——没有哪一档被验过）交代基线为什么没过，随后照常逐档位验：
                // 用户要的正是「哪一档行」，宁可多烧几次额度也不能替他把答案省掉
                emitProbe({ provider: probe.provider, model: probe.model }, testVerdict, undefined)
            }
        }
        const verdict = await probeOnce(llm, probe, signal)
        sent += 1
        // 基线已通过、且该档位的失败指明了「就是它」时，才判该档位不支持。判据见 isEffortRejection
        const outcome = probe.effort !== undefined && baselineOk.has(probe.model) && isEffortRejection(verdict.failure)
            ? 'unsupported-effort'
            : verdict.outcome
        results.push({
            provider: probe.provider,
            model: probe.model,
            effort: probe.effort,
            outcome,
            failure: verdict.failure,
        })
        // 两级短路的「剩余未发出的条数」在此一并算出：provider 级断到组尾，模型级只断到该模型自己的档位尾。
        // 消费方据此交代「还剩几条没验」，被跳过的请求不进 results，故 probed 少于 planned
        let skipped: number
        const blockReason = providerBlockReason(outcome, sent === 1)
        if (blockReason !== undefined) {
            blockedBy = blockReason
            skipped = group.probes.length - index - 1
        } else if (shouldSkipModelTail(outcome, verdict.failure)) {
            skipped = tail
        } else {
            skipped = 0
        }
        if (skipped > 0) index += skipped
        emitProbe(probe, { outcome, failure: verdict.failure }, skipped === 0 ? undefined : skipped)
        if (blockedBy !== undefined) break
    }
    // 计划数 = 该组的验证请求数（基线不在清单里）：关档位时等于勾选模型数，开档位时等于档位数之和
    const models = new Set<string>()
    // 推理级别数只数带档位的条目：没声明档位的模型验的是模型本身，不占级别，故不进「X / Y 个推理级别」的分母
    let plannedEfforts = 0
    for (const probe of group.probes) {
        models.add(JSON.stringify([probe.provider, probe.model]))
        if (probe.effort !== undefined) plannedEfforts++
    }
    return {
        provider: group.provider,
        results,
        tests,
        blockedBy,
        planned: group.probes.length,
        plannedEfforts,
        tested: models.size,
    }
}

/** 验证的可选控制项；不传即静默跑完，行为与引入进度帧之前完全一致 */
export type VerifyOptions = ProbeRunOptions

/**
 * 执行一次验证：按用户勾选展开成清单、按提供方分组、逐组跑、逐组汇报并求和。
 * 返回逐提供方结论（可达 / 凭据 / 可用数 / 是否短路）与全局计数；入参非法即抛出，由调用方转 RPC 失败结果。
 */
export async function verifyModels(
    llm: Pick<LlmRuntime, 'stream'>,
    payload: unknown,
    options: VerifyOptions = {},
): Promise<VerifySummary> {
    const groups = planProbeGroups(payload, VERIFY_LIMITS, VERIFY_REJECT_MESSAGE)
    const summary = await runProbeGroups(llm, groups, runGroup, options)
    finishRun(summary, options)
    return summary
}
