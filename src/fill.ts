/**
 * 探测式填充的两步写回：把候选档位**临时预声明**进模型配置，探测跑完后再按结论**收敛**成最终形态。
 *
 * 为什么必须先写再用：宿主在派发前按**模型配置里声明的档位**做本地校验
 * （`@deepseek-ai/dsh-llm` 的 `resolveCallWithInfo`），未声明的档位根本不会出网、只会本地抛
 * `UNSUPPORTED_REASONING_EFFORT`。故想验「这个模型到底支持哪几档」，得先让宿主认为这些档位存在。
 * 预声明因此是本功能的必要前置，不是副作用——它在探测结束时被同一轮代码收回。
 *
 * 为什么在 Node 半而不是浏览器半直写 settings：写回会被本插件的事件链当成「配置变了」而触发 `fix`，
 * 事件流守卫（`src/guard.ts`）正是为此刻存在的——预声明期间若被 `fix` 覆盖成 models.dev 的档位，
 * 探测剩余的请求会被本地拒绝，结论全错；收敛期间同理。守卫是 Node 半的模块级标志，浏览器半跨不过半纯度门禁。
 *
 * 守卫的持有范围是**整轮**（预声明 → 探测 → 收敛），而不是只包两次写：中间放开的话，
 * 用户或别的插件在这几分钟里改一次配置就会触发 `fix`，把预声明按 models.dev 改回去。
 * 代价是一轮探测期间本插件的其它写回端点被拒、自动填充暂停——一轮探测本就是用户主动发起的、
 * 且带着未收敛的写回，放开守卫的风险比让出这段时间更大。
 *
 * 两次写回共用同一个纯函数 `planEffortApply`：给定「模型 → 目标档位表」，产出整段 `models` 写回 op
 * 与增删条数。它与 `src/prune.ts` 的 `planPruneEfforts` 同形（同一份遍历、同一套排除判定、
 * 同一处 `stripEmptyFields` 收尾），差别只在于它不「剔」而是「设」。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { EFFORT_LEVELS, PLUGIN_NAME, PLUGIN_NS } from '@/shared/constants'
import { resolveConfig } from '@/config'
import type { PluginConfig } from '@/shared/types'
import { isPlainObject } from '@/shared/types'
import { stripEmptyFields } from '@/empty'
import { descriptorOf } from '@/section'
import { writebackApi } from '@/writeback'

/** 写回只动这一个模型字段：最大上下文 / 输出上限 / 图片模态与自定义字段一概保留 */
const FILL_FIELD = 'reasoningEfforts'

/** 「提供方 / 模型」二元组键：模型 id 可含 '/'，故用序列化而非字符串拼接（与 verifyKey、planPruneEfforts 同口径） */
function targetKey(provider: string, model: string): string {
    return JSON.stringify([provider, model])
}

/** 一次档位表改写：「这个模型改成声明这些档位」（空数组 = 声明为零，即删掉该字段） */
export interface EffortApply {
    provider: string
    model: string
    levels: readonly string[]
}

/** 写入计划的结果：ops 与增删条数（口径见 `planEffortApply` 的 `baseline`） */
export interface EffortApplyPlan {
    modelOps: SettingsPathOp[]
    models: number
    added: number
    removed: number
}

/** 目标模型当前声明的档位（按 `EFFORT_LEVELS` 排序；未声明即空表），键为 `targetKey` */
export function declaredEffortsOf(providers: Record<string, unknown>, targets: readonly EffortApply[]): Map<string, readonly string[]> {
    const wanted = new Set(targets.map((target) => targetKey(target.provider, target.model)))
    const declared = new Map<string, readonly string[]>()
    for (const [providerId, provider] of Object.entries(providers)) {
        if (!isPlainObject(provider) || !Array.isArray(provider.models)) continue
        for (const model of provider.models) {
            if (!isPlainObject(model) || typeof model.id !== 'string') continue
            const key = targetKey(providerId, model.id)
            if (!wanted.has(key)) continue
            declared.set(key, declaredLevelsOf(model[FILL_FIELD]))
        }
    }
    return declared
}

/** 档位表取值：只认普通对象的键，按 `EFFORT_LEVELS` 排序（与浏览器半候选列表同口径） */
function declaredLevelsOf(value: unknown): readonly string[] {
    if (!isPlainObject(value)) return []
    const keys = new Set(Object.keys(value))
    return EFFORT_LEVELS.filter((level) => keys.has(level))
}

/** 按档位表物化 `reasoningEfforts` 的取值：`off` 为 null（不推理），其余为档位名本身（与 `toReasoningEfforts` 同形） */
function effortsValueOf(levels: readonly string[]): Record<string, string | null> {
    const value: Record<string, string | null> = {}
    for (const level of levels) value[level] = level === 'off' ? null : level
    return value
}

/**
 * 档位表改写计划（纯函数，零 ctx 依赖可单测）：
 * 按「提供方 / 模型」把档位表整段设成 `levels`，其余模型字段与同提供方的其他模型原样保留，
 * 仅当某 provider 至少改写一个模型时才整段重建写回（零变更零 op）。
 *
 * **目标档位表为空即整个 `reasoningEfforts` 键删掉**（空对象等同未声明），
 * 不是先写空再删：路径 op 不支持数组下标中间段，只能整段 `set`，而空壳留着会反复触发写入判定。
 * 该键连同其余空壳字段（`input` / `compat`）一律走 `stripEmptyFields` 的统一判据，不在此处另写一份。
 *
 * `excludes` 命中的提供方整组跳过——排除语义对本插件的写入处处生效；
 * **唯一例外**是探测式填充的「忽略排除」开关：那是用户在本功能里显式要覆盖排除语义，
 * 由 `ignoreExcludes` 显式放行（默认 false，即照旧尊重排除）。
 *
 * **两套口径各按各的基线**，别混：
 * - `modelOps` 按**当前值**与目标表比对——只有真要改才产出 op，故收敛阶段算出的表与预声明一致时零写入。
 * - `models` / `added` / `removed` 按 `baseline`（缺省即当前值）比对——探测式填充传的是**预声明之前**的档位表，
 *   统计口径要对齐用户视角的那份配置：临时预声明的档位被收回时既不算新增也不算删除，它本不属于用户配置。
 *   正因如此「七档全可用」时收敛是零写入，而统计仍如实报出「补了 7 个档位」。
 */
export function planEffortApply(
    config: PluginConfig,
    providers: Record<string, unknown>,
    entries: readonly EffortApply[],
    ignoreExcludes: boolean,
    baseline?: ReadonlyMap<string, readonly string[]>,
): EffortApplyPlan {
    const excluded = new Set(config.excludes)
    const wanted = new Map<string, readonly string[]>()
    for (const entry of entries) wanted.set(targetKey(entry.provider, entry.model), entry.levels)
    const modelOps: SettingsPathOp[] = []
    let models = 0
    let added = 0
    let removed = 0
    for (const [providerId, provider] of Object.entries(providers)) {
        if (!ignoreExcludes && excluded.has(providerId)) continue
        if (!isPlainObject(provider)) continue
        const list = provider.models
        if (!Array.isArray(list)) continue
        let next: Record<string, unknown>[] | undefined
        for (let i = 0; i < list.length; i++) {
            const model = list[i]
            if (!isPlainObject(model) || typeof model.id !== 'string') continue
            const key = targetKey(providerId, model.id)
            const levels = wanted.get(key)
            if (levels === undefined) continue
            const before = baseline?.get(key) ?? declaredLevelsOf(model[FILL_FIELD])
            if (!sameLevels(levels, before)) {
                models++
                const kept = new Set(levels)
                for (const level of kept) if (!before.includes(level)) added++
                for (const level of before) if (!kept.has(level)) removed++
            }
            if (sameLevels(declaredLevelsOf(model[FILL_FIELD]), levels)) continue
            next ??= list.slice()
            // 目标为空表时**直接删键**：把旧值原样带走的话 stripEmptyFields 判不出空壳（它只清空形态），
            // 临时预声明的那七档就会留在配置里——那正是「全档没验通」的模型该回到的未声明态
            const replaced = { ...model }
            if (levels.length === 0) delete replaced[FILL_FIELD]
            else replaced[FILL_FIELD] = effortsValueOf(levels)
            next[i] = stripEmptyFields(replaced)
        }
        if (next) modelOps.push({ op: 'set', path: ['providers', providerId, 'models'], value: next })
    }
    return { modelOps, models, added, removed }
}

/** 两份档位表是否同集（都按 `EFFORT_LEVELS` 排序，故逐位比较即可） */
function sameLevels(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((level, index) => level === right[index])
}

/**
 * 读最新两段配置 → 出计划 → 写回 `llm-pi-ai` 段（骨架见 `src/writeback.ts`，`SETTINGS_CONFLICT` 时重读重算、限次）。
 *
 * **本函数不碰事件流守卫**：探测式填充的守卫持有整轮（预声明 → 探测 → 收敛），故走不带守卫的 `writebackApi`。
 * `compute` 在每次重试里重算，故它必须是纯函数、可对任意一次快照求值。
 */
async function applyEfforts(
    ctx: Context,
    compute: (providers: Record<string, unknown>, config: PluginConfig) => EffortApplyPlan,
    ignoreExcludes: boolean,
    label: string,
): Promise<EffortApplyPlan> {
    return writebackApi(ctx, {
        label,
        // 段不可读即当「本就无可改写」静默早退（返回零计划，不打日志）
        unreadableProviders: () => ({ modelOps: [], models: 0, added: 0, removed: 0 }),
        plan: ({ providers }) => {
            // 忽略排除时不必读自有段（它只提供 excludes）；否则读不到就必须显式失败：
            // 回退默认配置会使 excludes 变空，写回会作用到用户实际已排除的提供方
            const configDescriptor = descriptorOf(ctx, PLUGIN_NS)
            if (!ignoreExcludes && !configDescriptor) {
                throw new Error(`${PLUGIN_NAME}: 自有配置段 ${PLUGIN_NS} 不可读，无法${label}`)
            }
            return compute(providers, resolveConfig(configDescriptor?.user))
        },
        noChange: `${label}：没有需要改写的推理级别`,
        done: ({ models, added, removed }) => `${label}完成：${models} 个模型、新增 ${added} 个、删除 ${removed} 个推理级别`,
    })
}

/**
 * 预声明：把目标模型的档位表补成「原有 ∪ 全部候选档位」，返回**改写前**各模型原有的档位表。
 *
 * 返回的那份原有档位表是收敛阶段的唯一基线（临时预声明的档位不属于用户配置，收回时不计入增删）。
 * 目标模型已不存在于配置里（探测期间被用户删掉）时不出现在返回值里，收敛阶段自然也不会碰它。
 */
export async function declareProbeEfforts(
    ctx: Context,
    targets: readonly EffortApply[],
    ignoreExcludes: boolean,
): Promise<Map<string, readonly string[]>> {
    let preexisting = new Map<string, readonly string[]>()
    await applyEfforts(ctx, (providers, config) => {
        preexisting = declaredEffortsOf(providers, targets)
        return planEffortApply(
            config,
            providers,
            targets.map((target) => {
                // 档位表按 EFFORT_LEVELS 排序写入（不按「原有在前」）：配置里的键序是用户会看见的东西，
                // 预声明是临时形态也不能让档位表显得杂乱；且收敛阶段按同一口径比对，键序不一致会误判成有变更
                const merged = new Set([...(preexisting.get(targetKey(target.provider, target.model)) ?? []), ...EFFORT_LEVELS])
                return { ...target, levels: EFFORT_LEVELS.filter((level) => merged.has(level)) }
            }),
            ignoreExcludes,
        )
    }, ignoreExcludes, '预声明推理级别')
    return preexisting
}

/**
 * 收敛：按探测结论把档位表改回最终形态（`levels` 为空数组的模型即删掉该字段）。
 * 写入前判空壳、尊重排除（除非显式忽略）、幂等；增删统计对齐 `baseline`（预声明之前的档位表）。
 */
export function convergeProbeEfforts(
    ctx: Context,
    entries: readonly EffortApply[],
    ignoreExcludes: boolean,
    baseline: ReadonlyMap<string, readonly string[]>,
): Promise<EffortApplyPlan> {
    return applyEfforts(ctx, (providers, config) => planEffortApply(config, providers, entries, ignoreExcludes, baseline), ignoreExcludes, '收敛推理级别')
}
