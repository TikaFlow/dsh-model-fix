/** 模型可用性验证：每勾选模型发一次不带 `reasoningEffort` 的最小请求，仅以适配器是否开始产出内容块（`block-start`）判可用；
 * 全程只读（不碰 settings、不占事件流守卫、不落「已验证」账本），口径见 docs/decisions-diagnose.md「验证」 */

import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { PLUGIN_NAME } from '@/shared/constants'
import type { VerifySummary } from '@/shared/verify-progress'
import type { GroupRunner, GroupSequenceHooks, ProbeRunOptions } from '@/probe-engine'
import { finishRun, runGroupSequence, runProbeGroups } from '@/probe-engine'
import { VERIFY_LIMITS, planProbeGroups } from '@/probe-plan'

/** 验证请求不合法时的报错文案（入参来自浏览器半，一律按不可信输入校验） */
const VERIFY_REJECT_MESSAGE = `${PLUGIN_NAME}: 验证请求不合法（模型条目取值越界）`

const VERIFY_HOOKS: GroupSequenceHooks = {
    resolveOutcome: (_probe, verdict) => verdict.outcome,
    modelTailSkip: () => 0,
}

/** 顺序跑完一组验证请求（组内零并发）：每模型一条请求（不带档位参数） */
const runGroup: GroupRunner = (llm, group, signal, emitProbe) =>
    runGroupSequence(llm, group, signal, emitProbe, VERIFY_HOOKS)

/** 验证的可选控制项；不传即静默跑完 */
type VerifyOptions = ProbeRunOptions

/** 执行一次验证：按勾选展开清单 → 按提供方分组 → 逐组跑 → 逐组汇报并求和；入参非法即抛出（调用方转 RPC 失败结果） */
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
