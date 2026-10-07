/**
 * 「探测式填充」的 Node 半执行器：把候选档位**临时预声明**进模型配置 → 逐档各发一次最小请求 →
 * 按结论**收敛**成最终档位表并写回。全过程只由用户主动发起，且在途全程持有事件流守卫。
 *
 * 为什么必须先预声明：宿主在派发前按**模型配置里声明的档位**本地校验
 * （`@deepseek-ai/dsh-llm` 的 `resolveCallWithInfo`），未声明的档位不会出网、只会本地抛
 * `UNSUPPORTED_REASONING_EFFORT`。想验「这模型到底支持哪几档」，得先让宿主认为它们存在。
 * 预声明的档位在本轮结束时被同一轮代码收回，收敛时以**预声明之前**的档位表为基线，
 * 故临时声明不会出现在增删统计里。
 * 万一崩在中途（进程被杀、断电、宿主异常退出），预声明就留在用户配置里了：开跑前先把**整段**配置压一份到自有段，
 * 启动末尾据此回退（见 `@/probe-backup`）。
 *
 * 逐档判定：每个模型按 `EFFORT_LEVELS` 由低到高各发一次（7 档 × 模型数），收到首个 `block-start` 即该档可用。
 * 请求形态、受理判据、失败分类、两级短路判据、并发与中止语义全在 `@/probe-engine`（与「验证模型」共用），
 * 本模块只留两处验证没有的东西：**「只否定这一档」的对照怎么取**与**收敛口径**。
 *
 * 两级短路（判据在 `@/probe-engine` 的 `shouldSkipModelTail` 与 `providerBlockReason`，两功能逐字共用）：
 * - **provider 级**：端点不通 / 凭据无效即短整组——同一提供方共用同一 url 与同一把 key，后面同样过不去；
 *   外加**本组首个请求超时**：首条就等满 30 秒多半是端点压根连不上，再逐条等下去只是把同样的 30 秒
 *   乘上几十遍，一条结果都拿不到。首个之后的超时不算不可达，那时链路已经跑通过，只是这一次慢。
 * - **模型级**：某档的失败**与档位无关**时短该模型剩余档位，**额度耗尽是其中最要紧的一种**：
 *   同一把 key 的额度已经见底，换多少档、换哪个模型都是同样结果，继续逐档试纯属烧额度和时间，
 *   用户要的「这一档行不行」在第一次就没了答案。
 *   但**「参数不正确」不参与模型级短路**（除非它已被判成「这一档不支持」）：最低档 `off` 被拒不等于
 *   模型整体不可用——自定义提供方里把 `off` 当非法参数、只接受 low/medium/high 的并不罕见。一旦因此否掉
 *   整个模型，用户就永远补不上它真能用的那几档，代价远大于多花 6 次请求。故 7 档逐档试到底，
 *   哪一档通哪一档可用，全都如实进记录区。
 *   限流与超时同样不停：它们只否定了这一次，隔一会儿可能就通了。
 *   「是否只否定这一档」的对照两功能取法不同——验证拿不带档位的基线探测，本功能拿同模型已跑通的更低档
 *   （更低档跑通 ⇒ 端点、凭据、额度、网络、模型名都无碍，唯一的变量就是这一档，比基线更紧），代价为零。
 *   **故本功能不额外发那次基线探测**：它换来的只是「`off` 自己也能被判不支持」这一条，而 `off` 被拒不判
 *   不支持并不影响补全（其余六档照补、照记），却要让每个模型多烧一次请求——本功能是额度开销最大的那个。
 * 被短路的模型一律按「没跑完」处理：原样还原预声明之前的档位表（见下）。
 *
 * 收敛口径（每个「提供方 / 模型」各按一条）：
 * - 档位表 = `可用 ∪ 原有`，开「剔除不支持」时改为 `可用 ∪ (原有 − 明确判不支持)`。
 * - **档位表算空即整个 `reasoningEfforts` 键删掉**（空对象等同未声明），故「全档不可用」的结果是字段消失，
 *   模型回到未声明态，与剔除路径同一形态。
 * - 该模型没跑完（被 provider 级或模型级短路连带）即**原样还原**预声明之前的档位表：半截结论不足以动用户配置。
 * - 本轮被中止即**整轮**还原，一个模型都不补、不剔：必须完全跑完才谈补全。
 * - `ignoreExcludes` 同时作用于探测范围与两次写回（用户在本功能里显式要覆盖排除语义）；
 *   `dropUnsupported` 只影响收敛口径。两者都由浏览器半声明，Node 半不替它反推。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { EFFORT_LEVELS, PLUGIN_NAME } from '@/shared/constants'
import { isPlainObject } from '@/shared/types'
import type { ProviderBlockReason, ProviderProbeOutcome, VerifyProbeResult, VerifySummary } from '@/shared/verify-progress'
import type { GroupRunner, ProbeEmitter, ProbeRunOptions, ProviderProbeGroup } from '@/probe-engine'
import { PROBE_LIMITS, finishRun, isEffortRejection, planProbeGroups, probeOnce, providerBlockReason, runProbeGroups, sameModelTail, shouldSkipModelTail } from '@/probe-engine'
import type { EffortApply } from '@/fill'
import { convergeProbeEfforts, declareProbeEfforts } from '@/fill'
import { clearProbeBackup, saveProbeBackup } from '@/probe-backup'
import { endIgnoreAll, startIgnoreAll } from '@/guard'

/** 探测请求不合法时的报错文案（入参来自浏览器半，一律按不可信输入校验） */
const PROBE_REJECT_MESSAGE = `${PLUGIN_NAME}: 探测请求不合法（模型条目或推理级别取值越界）`

/** 「提供方 / 模型」二元组键（与 fill.ts、verifyKey 同口径） */
function targetKey(provider: string, model: string): string {
    return JSON.stringify([provider, model])
}

/** 顺序跑完一组的探测请求（组内零并发）：逐档各发一次，provider 级失败（含首个请求超时）短整组、其余按共用判据短到模型尾 */
const runProbeGroup: GroupRunner = async (
    llm: Pick<LlmRuntime, 'stream'>,
    group: ProviderProbeGroup,
    signal: AbortSignal,
    emitProbe: ProbeEmitter,
): Promise<ProviderProbeOutcome> => {
    const results: VerifyProbeResult[] = []
    // 已跑通至少一档的模型：判「某档不被支持」的第二条件用它替代验证那边的基线对照
    const usable = new Set<string>()
    let blockedBy: ProviderBlockReason | undefined
    // 本组已发出的请求数：provider 级短路要区分「首个请求就超时」与「链路已跑通、只是这一次慢」
    let sent = 0
    for (let index = 0; index < group.probes.length; index++) {
        // 外部中止在此早停：只断在途请求而不停循环，后续请求会带着已中止的信号跑出一串假失败
        if (signal.aborted) break
        const probe = group.probes[index]
        const verdict = await probeOnce(llm, probe, signal)
        sent += 1
        if (verdict.outcome === 'usable') usable.add(probe.model)
        // 判「这一档不被支持」要两个条件：宿主判为「参数不正确」，且该模型已有更低档跑通
        // （更低的档已跑通 ⇒ 端点、凭据、额度、网络与模型名都无碍，唯一剩下的变量就是这一档）。
        // 第二个条件正是本功能与验证的分野：验证有专门的不带档位基线，这里没有，只能拿已跑通的更低档顶替
        const outcome = probe.effort !== undefined && usable.has(probe.model) && isEffortRejection(verdict.failure)
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
        // 消费方据此交代「还剩几条没探」，被跳过的请求不进 results，故该模型的 probed 少于 planned
        let skipped = 0
        const blockReason = providerBlockReason(outcome, sent === 1)
        if (blockReason !== undefined) {
            blockedBy = blockReason
            skipped = group.probes.length - index - 1
        } else if (shouldSkipModelTail(outcome, verdict.failure, outcome === 'unsupported-effort' || isEffortRejection(verdict.failure))) {
            // 参数不正确但还没有对照（更低档还没探到）时**不**短：那一档仍可能是唯一能用的档位，
            // 逐档试到底正是本功能存在的意义。其余与档位无关的失败（额度耗尽等）照短，见模块注释
            skipped = sameModelTail(group.probes, index)
        }
        if (skipped > 0) index += skipped
        emitProbe(probe, { outcome, failure: verdict.failure }, skipped === 0 ? undefined : skipped)
        if (blockedBy !== undefined) break
    }
    const models = new Set<string>()
    let plannedEfforts = 0
    for (const probe of group.probes) {
        models.add(JSON.stringify([probe.provider, probe.model]))
        if (probe.effort !== undefined) plannedEfforts++
    }
    return {
        provider: group.provider,
        results,
        // 本功能没有基线探测，故无「非被验对象的那一次请求」
        tests: [],
        blockedBy,
        planned: group.probes.length,
        plannedEfforts,
        tested: models.size,
    }
}

/** 两个开关的取值：缺省为关；显式给了却不是布尔值按非法入参拒绝（Node 半不替浏览器半反推语义） */
function flagsOf(payload: unknown): { ignoreExcludes: boolean; dropUnsupported: boolean } {
    if (!isPlainObject(payload)) throw new Error(PROBE_REJECT_MESSAGE)
    const read = (key: string): boolean => {
        const value = payload[key]
        if (value === undefined) return false
        if (typeof value !== 'boolean') throw new Error(PROBE_REJECT_MESSAGE)
        return value
    }
    return { ignoreExcludes: read('ignoreExcludes'), dropUnsupported: read('dropUnsupported') }
}

/**
 * 收敛口径：逐模型算出最终档位表。
 *
 * 「跑完没跑完」有两道闸，任一不过即原样还原预声明之前的档位表——半截结论不足以动用户配置：
 * 1. 本轮被中止（`aborted`）：**整轮**还原，不按模型逐个判。用户按「停止」要的就是原样停下，
 *    不是「探到一半、填一半」；与「探到多少补多少」相比，全丢更可预期，也更不会把半截结论写成定论。
 * 2. 该模型自己的请求没拿满（被 provider 级或模型级短路连带）：只还原它，其余模型照常收敛。
 */
function convergeEntries(
    groups: readonly ProviderProbeGroup[],
    targets: readonly EffortApply[],
    preexisting: ReadonlyMap<string, readonly string[]>,
    summary: VerifySummary,
    dropUnsupported: boolean,
    aborted: boolean,
): EffortApply[] {
    const usable = new Map<string, Set<string>>()
    const unsupported = new Map<string, Set<string>>()
    const probed = new Map<string, number>()
    const planned = new Map<string, number>()
    for (const item of summary.usableEfforts) collect(usable, targetKey(item.provider, item.model), item.effort)
    for (const item of summary.unsupportedEfforts) collect(unsupported, targetKey(item.provider, item.model), item.effort)
    for (const item of summary.results) count(probed, targetKey(item.provider, item.model))
    for (const group of groups) for (const probe of group.probes) count(planned, targetKey(probe.provider, probe.model))
    const entries: EffortApply[] = []
    for (const target of targets) {
        const key = targetKey(target.provider, target.model)
        // 预声明时不在配置里的模型（探测期间被用户删掉）不在原有档位表里，也不该被写回
        const before = preexisting.get(key)
        if (before === undefined) continue
        const keep = !aborted && (probed.get(key) ?? 0) >= (planned.get(key) ?? 0)
        entries.push({ provider: target.provider, model: target.model, levels: keep ? finalLevels(key, before, usable, unsupported, dropUnsupported) : before })
    }
    return entries
}

/** 收敛后的档位表：`可用 ∪ 原有`，开「剔除不支持」时再从原有里扣掉明确判不支持的那些；按 `EFFORT_LEVELS` 排序 */
function finalLevels(
    key: string,
    before: readonly string[],
    usable: ReadonlyMap<string, Set<string>>,
    unsupported: ReadonlyMap<string, Set<string>>,
    dropUnsupported: boolean,
): readonly string[] {
    const kept = new Set<string>()
    for (const level of before) {
        if (dropUnsupported && unsupported.get(key)?.has(level)) continue
        kept.add(level)
    }
    for (const level of usable.get(key) ?? []) kept.add(level)
    return EFFORT_LEVELS.filter((level) => kept.has(level))
}

/** 往「模型 → 集合」里加一项 */
function collect(target: Map<string, Set<string>>, key: string, value: string): void {
    const set = target.get(key)
    if (set === undefined) target.set(key, new Set([value]))
    else set.add(value)
}

/** 往「模型 → 条数」里加一 */
function count(target: Map<string, number>, key: string): void {
    target.set(key, (target.get(key) ?? 0) + 1)
}

/**
 * 跑一轮探测式填充：预声明 → 逐档探测 → 收敛写回 → 发终帧。
 *
 * 两个开关（`ignoreExcludes` / `dropUnsupported`）随载荷走而不走参数：它们与模型清单同为浏览器半的声明，
 * 走载荷才与「入参按不可信输入校验」同一处收口。
 *
 * 事件流守卫**全程持有**（预声明到收敛之间不放开）：放开的话，用户或别的插件在这几分钟里改一次配置就会
 * 触发 `fix`，把预声明按 models.dev 改回去，探测剩余的请求会被宿主本地拒绝、结论全错。
 * 代价是一轮探测期间本插件的其它写回端点被拒、自动填充暂停——一轮探测本就是用户主动发起的，
 * 且带着未收敛的写回，放开守卫的风险比让出这段时间更大。
 */
export async function probeAndFill(
    ctx: Context,
    llm: Pick<LlmRuntime, 'stream'>,
    payload: unknown,
    options: ProbeRunOptions = {},
): Promise<VerifySummary> {
    const flags = flagsOf(payload)
    const groups = planProbeGroups(payload, PROBE_LIMITS, PROBE_REJECT_MESSAGE)
    const targets: EffortApply[] = []
    const seen = new Set<string>()
    for (const group of groups) {
        for (const probe of group.probes) {
            const key = targetKey(probe.provider, probe.model)
            if (seen.has(key)) continue
            seen.add(key)
            targets.push({ provider: probe.provider, model: probe.model, levels: [] })
        }
    }
    startIgnoreAll()
    try {
        // 先落一份整段配置到自有段再动配置：崩了也不至于把预声明留在用户配置里（详见 probe-backup.ts）。
        // 存不下就整轮中止——没有退路就不动用户配置
        await saveProbeBackup(ctx)
        const preexisting = await declareProbeEfforts(ctx, targets, flags.ignoreExcludes)
        const summary = await runProbeGroups(llm, groups, runProbeGroup, options)
        const entries = convergeEntries(groups, targets, preexisting, summary, flags.dropUnsupported, options.signal?.aborted === true)
        const { models, added, removed } = await convergeProbeEfforts(ctx, entries, flags.ignoreExcludes, preexisting)
        // 收敛已落盘即可撤掉兜底备份；撤不掉只告警（下次启动会把这轮补全回退掉，多探一次而已），
        // 不因清理失败把已经成功的补全报成失败
        await clearProbeBackup(ctx).catch((error: unknown) => {
            ctx.logger.warn(`${PLUGIN_NAME}: 探测兜底备份清理失败（下次启动会回退本轮补全）：${error instanceof Error ? error.message : String(error)}`)
        })
        // 终帧最后发：写回已经落盘，消费方拿到 done 时看到的已是最终配置
        const filled: VerifySummary = { ...summary, fill: { models, added, removed } }
        finishRun(filled, options)
        return filled
    } finally {
        endIgnoreAll()
    }
}
