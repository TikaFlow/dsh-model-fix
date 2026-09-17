import { API_NS, MAX_ATTEMPTS, PLUGIN_NAME, PLUGIN_NS } from './constants'
import { resolveConfig, DEFAULT_CONFIG } from './config'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { PluginConfig } from './types'
import { isPlainObject } from './types'
import { startIgnoreAll, endIgnoreAll } from './guard'

/** 插件可能填充的模型字段（用户自定义字段不动） */
const FILLED_FIELDS = ['reasoningEfforts', 'contextWindow', 'maxTokens', 'input'] as const

/**
 * 重置操作的模型参数计划（纯函数，零 ctx 依赖可单测）：
 * 每个非排除 provider 逐模型剔除 FILLED_FIELDS 中的键、其余键原样保留，
 * 仅当该 provider 至少一个模型有可剔除的键时才整段重建写回（零变更零 op，与 fix 写回纪律一致）。
 * 配置段一律不写——开关保持原值，重置后修改配置仍会按原开关触发填充。
 * 返回 { modelOps, changed }，changed 为受影响（至少剔除一个字段）的模型数，与 fix 的模型计数口径一致。
 */
export function planResetModels(config: PluginConfig, providers: Record<string, unknown>): {
    modelOps: SettingsPathOp[]
    changed: number
} {
    const excluded = new Set(config.excludes)
    const modelOps: SettingsPathOp[] = []
    let changed = 0
    for (const [providerId, provider] of Object.entries(providers)) {
        if (excluded.has(providerId)) continue
        if (!isPlainObject(provider)) continue
        const models = provider.models
        if (!Array.isArray(models)) continue
        let next: Record<string, unknown>[] | undefined
        for (let i = 0; i < models.length; i++) {
            const model = models[i]
            if (!isPlainObject(model)) continue
            const kept: Record<string, unknown> = {}
            for (const [key, value] of Object.entries(model)) {
                if ((FILLED_FIELDS as readonly string[]).includes(key)) continue
                kept[key] = value
            }
            if (Object.keys(model).length === Object.keys(kept).length) continue
            changed++
            next ??= models.slice()
            next[i] = kept
        }
        if (next) modelOps.push({ op: 'set', path: ['providers', providerId, 'models'], value: next })
    }
    return { modelOps, changed }
}

/**
 * 重置全部模型参数：剔除各非排除 provider 模型上的插件填充字段（reasoningEfforts /
 * contextWindow / maxTokens / input），用户自定义字段与配置段（开关）原样保留——
 * 重置后修改配置仍按原开关触发填充。事件流守卫全程打开，写回触发的 settings/updated
 * 事件被入口判定拦下，不会反向触发填充。
 * 返回受影响（至少剔除一个字段）的模型数；写失败先告警再抛出，由调用方转 RPC 失败结果。
 */
export async function resetModels(ctx: Context): Promise<number> {
    startIgnoreAll()
    try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const descriptors = ctx.settings.describe()
            const apiDescriptor = descriptors.find((d) => d.ns === API_NS)
            const providers = apiDescriptor
                ? (apiDescriptor.user as { providers?: Record<string, unknown> } | undefined)?.providers
                : undefined
            if (!isPlainObject(providers)) return 0
            // 当前生效配置（损坏快照回退次高版本/默认，excludes 一并生效）
            const configDescriptor = descriptors.find((d) => d.ns === PLUGIN_NS)
            const config = configDescriptor ? resolveConfig(configDescriptor.user) : DEFAULT_CONFIG
            const { modelOps, changed } = planResetModels(config, providers)
            if (modelOps.length === 0) {
                ctx.logger.info(`${PLUGIN_NAME}: 重置：无可剔除字段的模型`)
                return 0
            }
            try {
                await ctx.settings.mutate(API_NS, modelOps, apiDescriptor?.revision || 0)
                ctx.logger.info(`${PLUGIN_NAME}: 已重置 ${changed} 个模型的插件字段`)
                return changed
            } catch (error) {
                // 冲突重试：重读两段最新 revision 后重算计划（幂等——已剔除的模型不再计入 changed）
                if ((error as { code?: unknown })?.code === 'SETTINGS_CONFLICT' && attempt < MAX_ATTEMPTS) continue
                ctx.logger.warn(`${PLUGIN_NAME}: 重置失败（第 ${attempt}/${MAX_ATTEMPTS} 次）：${error instanceof Error ? error.message : String(error)}`)
                throw error
            }
        }
        throw new Error(`${PLUGIN_NAME}: 重置冲突重试耗尽`)
    } finally {
        endIgnoreAll()
    }
}
