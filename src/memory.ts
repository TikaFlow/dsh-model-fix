/**
 * 推理级别记忆的失效清理（Node 半）：按宿主的**全量**模型列表剪掉已不存在的条目。
 *
 * 覆盖面与 UI 选型一致而非「llm-pi-ai 配置段里登记过的模型」——判据取 `ctx.llm` 的活路由
 * （`listProviders` + `listModels`，与宿主模型目录 `buildModelCatalog` 同源），故官方提供方与
 * 插件 adapter 动态注册的模型同样受管。取数只对**有记忆条目**的 provider 发请求，成本与条目数成正比。
 *
 * 与浏览器半的分工：那边只管存取（写入 / 恢复 / 自动设 `high`），这边只管整理。之所以能这样分，
 * 是因为「模型还在不在」是宿主路由的事实、与会话无关；而 `fix` 不参与记忆生命周期（见 docs/decisions.md）。
 *
 * 触发面：`llm/adapters-updated`（provider 拓扑变化，天然在 commit 之后）+ `llm-pi-ai` 段变更
 * （模型级增删，settings 的 document-updated 在 describe 时发出、值已是最新的）+ 自有段变更
 * （用户把 `forgetRemoved` 转开等时当场补一次，不必等下一个模型列表事件）+ 启动首轮。
 */
import type { Context } from '@deepseek-ai/cordis'
import { MAX_ATTEMPTS } from '@/constants'
import { getConfig } from '@/config'
import { queueTask } from '@/host'
import { descriptorOf } from '@/section'
import { isSettingsConflict } from '@/writeback'
import { CONFIG_VERSION, PLUGIN_NS, PLUGIN_NAME } from '@/shared/constants'
import { errorText } from '@/shared/errors'
import { versionKey } from '@/shared/parse'
import type { EffortMemory } from '@/shared/types'

/**
 * 存活模型清单：provider id → 该 provider 现存的模型 id 集合。
 * 三态：`undefined` = 该 provider 已无活路由（真删了）；`null` = 在路由上但目录读失败（读不到 ≠ 不存在）；
 * 集合 = 读成功，集合外即已删除。
 */
export type LiveModels = ReadonlyMap<string, ReadonlySet<string> | null>

/** 剪枝计划：清理后的整段记忆 + 本轮删掉的条目数（供日志，一条也不白记） */
export interface PrunePlan {
    readonly memory: EffortMemory
    readonly removed: number
}

/**
 * 按存活清单剪枝记忆（不改入参、产出不共享嵌套引用）。返回清理后的记忆，`null` = 无需写回。
 *
 * 口径（见 docs/decisions.md）：
 * - **缺席即删除**：provider 已无活路由 ⇒ 整段删；模型不在其存活集合里 ⇒ 删该模型，
 *   段被删空则整个折叠掉，全删光归 `{}`（与写入侧同形态：字段恒存在、形态恒定）。
 *   记忆是可丢数据（丢了只是不自动设置级别），而「忘记已删除模型」更在意，故宁删勿留。
 * - **读失败不等于删除**：provider 在路由上但 `listModels` 抛错 ⇒ 整段原样保留（拿不到目录
 *   与「目录里没有」不可区分，这是唯一必须留的安全阀）。
 * - **开关关闭即不剪**：`forgetRemoved` 关时本函数直接返回 `null`。
 * - **不看档位**：模型还在就保留，哪怕记忆的档位已不被 `reasoning.efforts` 广告——恢复侧
 *   `advertisesEffort` 已守卫，陈旧条目零成本（与既有逻辑一致，不按档位剪枝）。
 */
export function planPruneMemory(memory: EffortMemory, live: LiveModels, forgetRemoved: boolean): PrunePlan | null {
    if (!forgetRemoved) return null
    const next: EffortMemory = {}
    let changed = false
    let removed = 0
    for (const [providerId, models] of Object.entries(memory)) {
        const liveModels = live.get(providerId)
        // provider 已无活路由：整段删除
        if (liveModels === undefined) {
            changed = true
            removed += Object.keys(models).length
            continue
        }
        // 在路由上但目录读失败：读不到不等于不存在，整段原样保留
        if (liveModels === null) {
            next[providerId] = { ...models }
            continue
        }
        const kept: Record<string, string> = {}
        for (const [modelId, effort] of Object.entries(models)) {
            if (!liveModels.has(modelId)) {
                changed = true
                removed++
                continue
            }
            kept[modelId] = effort
        }
        // 该 provider 下的模型全被删（或本就是空壳段）→ 段随之折叠
        if (Object.keys(kept).length === 0) {
            changed = true
            continue
        }
        next[providerId] = kept
    }
    return changed ? { memory: next, removed } : null
}

/**
 * 采集存活清单：只对有记忆条目的 provider 调 `listModels`，其余 provider 一律不查。
 *
 * 返回 `null` = 本轮不剪（`listProviders()` 为空，即退化读：此刻宣称「全都不存在」等于全删）。
 * 单个 provider 的 `listModels` 抛错不影响其他 provider，只把它标成未知（`null`）。
 */
export async function collectLiveModels(ctx: Context, providerIds: readonly string[]): Promise<LiveModels | null> {
    const registered = new Set(ctx.llm.listProviders().map((provider) => provider.id))
    if (registered.size === 0) return null
    const live = new Map<string, ReadonlySet<string> | null>()
    for (const providerId of providerIds) {
        if (!registered.has(providerId)) continue
        try {
            live.set(providerId, new Set((await ctx.llm.listModels(providerId)).map((model) => model.id)))
        } catch {
            // 目录读失败（凭据缺失、端点不通等）不是删除证据：标成未知，本段不剪
            live.set(providerId, null)
        }
    }
    return live
}

/** 剪枝在途标志 + 待补跑标志：事件密集时合并（模型列表变化常连发数个事件），但不丢事件 */
let pruning = false
let pending = false

/**
 * 按全量模型列表剪一次记忆：读当前生效配置 → 采存活清单 → 出计划 → 经 `queueTask` 写回自有段
 * （带 revision 围栏，冲突时重读重算，限次）。
 *
 * 与 `fix` 分开：记忆生命周期不由填充触发，自有段变更也不该连带重建记忆。
 * 写回失败只告警不抛出——记忆是可丢数据，不该让事件链因为清理失败而报错。
 *
 * 在途时到来的事件不丢弃、只置 `pending`：本轮结束后按最新状态补跑一次
 * （否则「剪到一半时发生的模型删除」要等下一次无关事件才被清）。
 */
export async function updateMemory(ctx: Context): Promise<void> {
    if (pruning) {
        pending = true
        return
    }
    pruning = true
    try {
        do {
            pending = false
            await pruneOnce(ctx)
        } while (pending)
    } finally {
        pruning = false
    }
}

/** 一轮剪枝（读 → 采 → 计划 → 写回）。任何一步判定「不必剪」即整轮早退 */
async function pruneOnce(ctx: Context): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const cfg = getConfig()
        if (!cfg.userExperience.forgetRemoved) return
        const live = await collectLiveModels(ctx, Object.keys(cfg.efforts))
        if (!live) return
        const plan = planPruneMemory(cfg.efforts, live, cfg.userExperience.forgetRemoved)
        if (!plan) return
        const descriptor = descriptorOf(ctx, PLUGIN_NS)
        if (!descriptor) return
        try {
            await queueTask(ctx, () => ctx.settings.mutate(
                PLUGIN_NS,
                [{ op: 'set', path: [versionKey(CONFIG_VERSION), 'efforts'], value: plan.memory }],
                descriptor.revision,
            ))
            ctx.logger.info(`${PLUGIN_NAME}: 已清理 ${plan.removed} 条失效的推理级别记忆`)
            return
        } catch (error) {
            if (isSettingsConflict(error) && attempt < MAX_ATTEMPTS) continue
            ctx.logger.warn(`${PLUGIN_NAME}: 清理失效的推理级别记忆失败（第 ${attempt}/${MAX_ATTEMPTS} 次）：${errorText(error)}`)
            return
        }
    }
}