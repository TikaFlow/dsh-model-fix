import { API_NS, MAX_ATTEMPTS, PLUGIN_NAME } from './constants'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { isPlainObject } from './types'
import { startIgnoreAll, endIgnoreAll } from './guard'

/**
 * 插件启动时捕获的 `llm-pi-ai` 备份：该 NS user 层 `providers` 段的深拷贝（只读缓存，不写盘）。
 * 由 apply 在一切写回路径之前同步读取一次；重启即重建。恢复只回退到本备份对应的状态。
 */
let backup: Record<string, unknown> | undefined

/**
 * 从 `llm-pi-ai` 的 user 层取 `providers` 段（捕获与恢复共用同一收窄口径，杜绝两处形状错配）。
 * user 非纯对象、无 providers 或 providers 非纯对象一律返回 undefined。
 */
export function providersOf(user: unknown): Record<string, unknown> | undefined {
    if (!isPlainObject(user)) return undefined
    const providers = user.providers
    return isPlainObject(providers) ? providers : undefined
}

/**
 * 捕获启动时备份：读 `llm-pi-ai` user 层的 `providers` 段并深拷贝缓存，仅存内存。
 * **只允许在 apply 最顶部调用一次**——备份的语义是"插件动手前"，晚于任何写回的补捕会存进已被填充的
 * 内容，那种备份比没有备份更危险（静默把改后值当原值恢复）。取不到仅告警，该次运行的恢复明确报错。
 * `backup !== undefined` 早退是为 HMR 重复 apply 时不用改后内容覆盖首启动的备份。
 */
export function captureBackup(ctx: Context): void {
    if (backup !== undefined) return
    try {
        const apiDescriptor = ctx.settings.describe().find((d) => d.ns === API_NS)
        const providers = providersOf(apiDescriptor?.user)
        if (!providers) {
            ctx.logger.warn(`${PLUGIN_NAME}: 未能捕获启动时备份（${API_NS} 不可读或无 providers 段），本次运行「恢复备份」不可用`)
            return
        }
        backup = structuredClone(providers)
        ctx.logger.info(`${PLUGIN_NAME}: 已捕获启动时备份（${Object.keys(backup).length} 个提供方）`)
    } catch (error) {
        ctx.logger.warn(`${PLUGIN_NAME}: 捕获启动时配置备份失败（恢复功能不可用）：${error instanceof Error ? error.message : String(error)}`)
        backup = undefined
    }
}

/**
 * 恢复计划（纯函数，零 ctx 依赖可单测）——交集语义：
 * 只恢复「备份与当前都存在」的 provider 内的「备份与当前都存在」的 model；
 * 被整删的 provider、被删的 model、启动后新增的 provider/model 一律跳过（不复活、不覆盖新增）。
 * 对该 provider 重建 models 数组：交集的 model 用备份值（深拷贝），当前独有 model 原样保留。
 * 仅当重建结果与该 provider 当前 models 有差异才产出整段 set op（零变更零 op）。
 * 返回 { modelOps, changed }，changed 为被恢复（交集 model 中被改写）的模型数。
 */
export function planRestore(
    backupProviders: Record<string, unknown> | undefined,
    currentProviders: Record<string, unknown>,
): { modelOps: SettingsPathOp[]; changed: number } {
    const modelOps: SettingsPathOp[] = []
    let changed = 0
    if (!isPlainObject(backupProviders)) return { modelOps, changed }
    for (const [providerId, backupProvider] of Object.entries(backupProviders)) {
        if (!isPlainObject(backupProvider)) continue
        const currentProvider = currentProviders[providerId]
        if (!isPlainObject(currentProvider)) continue
        const backupModels = backupProvider.models
        const currentModels = currentProvider.models
        if (!Array.isArray(backupModels) || !Array.isArray(currentModels)) continue
        // 交集 model id -> 备份值；当前独有 model id -> 原样保留
        const backupById = new Map<string, unknown>()
        for (const m of backupModels) {
            if (isPlainObject(m) && m.id !== undefined && m.id !== null) backupById.set(String(m.id), m)
        }
        const restored = currentModels.map((m) => {
            if (!isPlainObject(m) || m.id === undefined || m.id === null) return m
            const hit = backupById.get(String(m.id))
            return hit !== undefined ? structuredClone(hit) : m
        })
        // 逐个比较（宿主同款 deepEqualJson，见 AGENTS：变更检测的唯一判据）：
        // 仅当有交集 model 的值被改写才产出 op，changed 计被恢复（值不同于当前）的模型数
        let touched = 0
        for (let i = 0; i < currentModels.length; i++) {
            if (!deepEqualJson(currentModels[i], restored[i])) touched++
        }
        if (touched === 0) continue
        modelOps.push({ op: 'set', path: ['providers', providerId, 'models'], value: restored })
        changed += touched
    }
    return { modelOps, changed }
}

/**
 * 恢复备份：把各共有 provider 中共有 model 回退到启动时备份值（交集语义，见 planRestore）。
 * 事件流守卫全程打开，写回触发的 settings/updated 事件被入口判定拦下，不会反向触发填充。
 * 返回被恢复的模型数；写失败先告警再抛出，由调用方转 RPC 失败结果。
 */
export async function restoreModels(ctx: Context): Promise<number> {
    // 备份缺失（启动时捕获失败）必须显式失败：返回 0 会被前端显示成「已恢复 0 个模型」，
    // 与「确实无可恢复」无法区分，用户会误以为按钮坏了或数据本就一致。
    if (backup === undefined) throw new Error(`${PLUGIN_NAME}: 启动时未捕获到备份，本次运行无法恢复`)
    startIgnoreAll()
    try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const apiDescriptor = ctx.settings.describe().find((d) => d.ns === API_NS)
            const providers = providersOf(apiDescriptor?.user)
            // 当前 NS 不可读时同样显式失败：返回 0 会被显示成「已恢复 0 个模型」，掩盖真实故障
            if (!providers) throw new Error(`${PLUGIN_NAME}: 当前 ${API_NS} 无 providers 段，无法恢复`)
            const { modelOps, changed } = planRestore(backup, providers)
            if (modelOps.length === 0) {
                ctx.logger.info(`${PLUGIN_NAME}: 恢复备份：无可恢复的模型`)
                return 0
            }
            try {
                await ctx.settings.mutate(API_NS, modelOps, apiDescriptor?.revision || 0)
                ctx.logger.info(`${PLUGIN_NAME}: 已恢复备份中的 ${changed} 个模型`)
                return changed
            } catch (error) {
                // 冲突重试：重读最新 revision 后重算计划（幂等——已恢复的 model 不再计入 changed）
                if ((error as { code?: unknown })?.code === 'SETTINGS_CONFLICT' && attempt < MAX_ATTEMPTS) continue
                ctx.logger.warn(`${PLUGIN_NAME}: 恢复备份失败（第 ${attempt}/${MAX_ATTEMPTS} 次）：${error instanceof Error ? error.message : String(error)}`)
                throw error
            }
        }
        throw new Error(`${PLUGIN_NAME}: 恢复备份冲突重试耗尽`)
    } finally {
        endIgnoreAll()
    }
}