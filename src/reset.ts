import { MAX_ATTEMPTS } from '@/constants'
import { API_NS, PLUGIN_NAME, PLUGIN_NS } from '@/shared/constants'
import { resolveConfig } from '@/config'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { PluginConfig } from '@/shared/types'
import { isPlainObject } from '@/shared/types'
import { stripEmptyFields } from '@/empty'
import { startIgnoreAll, endIgnoreAll } from '@/guard'
import { queueTask } from '@/host'

/** 重置清除的模型字段：仅推理级别——最大上下文 / 输出上限 / 图片模态可在模型页自行设置，不清除 */
const RESET_FIELD = 'reasoningEfforts'

/**
 * 重置推理级别的模型参数计划（纯函数，零 ctx 依赖可单测）：
 * 每个非排除 provider 逐模型剔除推理级别字段、其余键原样保留
 * （contextWindow / maxTokens / input 不在清除范围），
 * 仅当该 provider 至少一个模型有推理级别键时才整段重建写回（零变更零 op，与 fix 写回纪律一致）；
 * 重建值里的其余空壳字段按 `stripEmptyFields` 的统一判据一并清掉，不在本模块另写一份空值判据。
 * 配置段一律不写——开关保持原值，重置后修改配置仍会按原开关触发填充。
 * 返回 { modelOps, changed }，changed 为受影响（至少剔除一个推理级别）的模型数，与 fix 的模型计数口径一致。
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
                if (key === RESET_FIELD) continue
                kept[key] = value
            }
            // 写回触发仍只看「带没带推理级别」：重置只对带推理级别的模型生效，
            // 否则带空壳字段的模型会被算进 changed，卡片上的「重置 N 个模型」就虚高了
            if (!Object.hasOwn(model, RESET_FIELD)) continue
            changed++
            next ??= models.slice()
            // 顺手按统一判据清掉其余空壳字段，不在此处另写一份空值判据
            next[i] = stripEmptyFields(kept)
        }
        if (next) modelOps.push({ op: 'set', path: ['providers', providerId, 'models'], value: next })
    }
    return { modelOps, changed }
}

/**
 * 重置全部推理级别：剔除各非排除 provider 模型上的 reasoningEfforts，其余模型字段
 * （含可在模型页自行设置的最大上下文 / 输出上限 / 图片模态）、用户自定义字段与配置段
 * （开关）原样保留——重置后修改配置仍按原开关触发填充。事件流守卫全程打开，写回触发的
 * settings/document-updated 事件被入口判定拦下，不会反向触发填充。
 * 返回受影响（至少剔除一个推理级别）的模型数；写失败先告警再抛出，由调用方转 RPC 失败结果。
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
            // 当前生效配置（损坏快照回退最高可解析版本/默认，excludes 一并生效）
            const configDescriptor = descriptors.find((d) => d.ns === PLUGIN_NS)
            // 自有段不可读时显式失败：回退 DEFAULT_CONFIG 会使 excludes 变空，
            // 重置会作用到用户实际已排除的提供方
            if (!configDescriptor) throw new Error(`${PLUGIN_NAME}: 自有配置段 ${PLUGIN_NS} 不可读，无法重置`)
            const config = resolveConfig(configDescriptor.user)
            const { modelOps, changed } = planResetModels(config, providers)
            if (modelOps.length === 0) {
                ctx.logger.info(`${PLUGIN_NAME}: 重置：无可剔除推理级别的模型`)
                return 0
            }
            try {
                await queueTask(ctx, () => ctx.settings.mutate(API_NS, modelOps, apiDescriptor?.revision || 0))
                ctx.logger.info(`${PLUGIN_NAME}: 已重置 ${changed} 个模型的推理级别`)
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
