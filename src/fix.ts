import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { getCatalog } from './catalog'
import { planProviderCompat } from './compat'
import { lookup, toReasoningEfforts } from './lookup'
import { API_NS, DEVELOPER_COMPAT_APIS, MAX_ATTEMPTS, PLUGIN_NAME } from './constants'
import { getConfig } from './config'
import { isCapacity, isPlainObject } from './types'

/** 剔除空 input/compat：两者在 harness 语义上等同缺失，删除无损，操作幂等 */
function stripEmptyArtifacts(model: Record<string, unknown>): Record<string, unknown> {
    let next: Record<string, unknown> | undefined
    const input = model.input
    if (Array.isArray(input) && input.length === 0) {
        next = { ...model }
        delete next.input
    }
    const compat = model.compat
    if (isPlainObject(compat) && Object.keys(compat).length === 0) {
        next ??= { ...model }
        delete next.compat
    }
    return next ?? model
}

/** 缓存图片信息转换为写回的 input 模态数组：仅支持图片时填 ['text','image']，无数据或纯文本不填（未声明即按纯文本处理） */
function toInputValue(image: boolean | undefined): string[] | undefined {
    return image ? ['text', 'image'] : undefined
}

/** 判断错误是否为并发写入冲突（settings 命名空间在读写之间被改动） */
function isSettingsConflict(error: unknown): boolean {
    return (error as { code?: unknown })?.code === 'SETTINGS_CONFLICT'
}

/**
 * 遍历提供商写回变更，一次 mutate 内提交两类 op（模型参数与路由兼容性，二者互不影响）：
 * - 模型参数：缺失推理级别/容量/图片模态且有目录数据则填充（受 autoFill 对应字段控制），
 *   allowUpdate（force 时单次绕过，不落存储）开启则按目录最新值同步——含缺失补写与已有覆盖
 *   （旧值缺失经 deepEqualJson 判为不一致，属设计裁决，见 AGENTS.md 填充流程），并剔除空 input/compat。
 *   读 descriptor.user（原始字段），按 provider 整数组写回 models（路径 op 不支持数组下标，故 value 为全量重建的数组，
 *   未变更元素原样保留）；数据无档位不删除已有配置。
 * - 路由 compat：按 compat 规则组为 openai-completions 路由添加或**移除**字段（与模型填充不同，关闭即移除，
 *   见 src/compat.ts），只写路由级、不写模型级。
 * - 提供方排除：`excludes` 命中的 providerId 在循环入口即整条跳过，两类 op 与 force 一律不作用其上
 *   （等效于对该提供方关闭插件；预防性——已写入的值原地保留，见 AGENTS.md 设计裁决）。
 * 返回变更模型数（不含路由 compat 计数，保持 RPC 契约）；写回失败（冲突重试用尽等）
 * 先告警再抛出，由调用方决定后续处理（RPC 转失败结果回传，事件侧吞掉 rejection）。
 */
export async function fix(ctx: Context, force = false): Promise<number> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // 冲突重试时重读，获取最新 revision
        const descriptor = ctx.settings.describe().find((d) => d.ns === API_NS)
        if (!descriptor) return 0
        const providers = (descriptor.user as { providers?: Record<string, unknown> } | undefined)?.providers
        if (!isPlainObject(providers)) return 0
        const cfg = getConfig()
        const allowRules = cfg.allowUpdate
        const autoRules = cfg.autoFill
        const compatRules = cfg.compat
        // 提供方级排除：命中的 id 整条跳过（模型写回与路由 compat 都不作用其上）
        const excludes = new Set(cfg.excludes)
        const indexed = getCatalog()
        const ops: SettingsPathOp[] = []
        let changes = 0
        let compatChanges = 0
        let excluded = 0
        for (const [providerId, provider] of Object.entries(providers)) {
            if (excludes.has(providerId)) {
                excluded++
                continue
            }
            if (!isPlainObject(provider)) continue
            const { api, models, compat: currentCompat } = provider as { api?: unknown; models?: unknown; compat?: unknown }
            if (Array.isArray(models)) {
                let next: Record<string, unknown>[] | undefined
                for (let i = 0; i < models.length; i++) {
                    const model = models[i]
                    if (!isPlainObject(model) || model.id === undefined || model.id === null) continue
                    const record = model
                    const { reasoningEfforts, contextWindow, maxTokens } = record as {
                        reasoningEfforts?: unknown
                        contextWindow?: unknown
                        maxTokens?: unknown
                    }
                    const cleaned = stripEmptyArtifacts(record)
                    const entry = lookup(indexed, providerId, String(record.id))
                    const efforts = toReasoningEfforts(entry)
                    // 图片模态以剔除空数组后的值为准（harness 语义：空数组 = 未声明）
                    const input = cleaned.input
                    const inputValue = toInputValue(entry?.image)
                    // 推理级别
                    const reasoningFillable = autoRules.reasoning
                        && reasoningEfforts === undefined && !!efforts
                    const reasoningUpdatable = (force || allowRules.reasoning)
                        && !deepEqualJson(reasoningEfforts, efforts)
                        && isPlainObject(efforts)
                    // 容量新值须为正整数且非哨兵（存量旧缓存可能仍带 0/99999999，写 0 会被 schema 拒绝并连累整批）
                    const ctxW = entry?.contextWindow
                    const maxT = entry?.maxTokens
                    const contextFillable = autoRules.context
                        && contextWindow === undefined && isCapacity(ctxW)
                    const contextUpdatable = (force || allowRules.context)
                        && ctxW !== contextWindow
                        && isCapacity(ctxW)
                    const maxTokensFillable = autoRules.context
                        && maxTokens === undefined && isCapacity(maxT)
                    const maxTokensUpdatable = (force || allowRules.context)
                        && maxT !== maxTokens
                        && isCapacity(maxT)
                    const imageFillable = autoRules.image
                        && input === undefined && !!inputValue
                    const imageUpdatable = (force || allowRules.image)
                        && !!inputValue
                        && !deepEqualJson(input, inputValue)
                    if (cleaned === record && !reasoningFillable && !reasoningUpdatable
                        && !contextFillable && !contextUpdatable && !maxTokensFillable && !maxTokensUpdatable
                        && !imageFillable && !imageUpdatable) continue
                    changes++
                    next ??= models.slice()
                    const patched = { ...cleaned }
                    if (reasoningFillable || reasoningUpdatable) patched.reasoningEfforts = efforts
                    if (contextFillable || contextUpdatable) patched.contextWindow = ctxW
                    if (maxTokensFillable || maxTokensUpdatable) patched.maxTokens = maxT
                    if (imageFillable || imageUpdatable) patched.input = inputValue
                    next[i] = patched
                }
                if (next) {
                    ops.push({ op: 'set', path: ['providers', providerId, 'models'], value: next })
                }
            }
            // 路由级兼容性（与模型参数无关，故 models 缺失也要处理）：仅 openai-completions 风格的路由消费该字段，
            // 其他协议写入无意义（宿主按协议 gate 静默跳过），故不碰。
            if (typeof api === 'string' && DEVELOPER_COMPAT_APIS.has(api)) {
                const plan = planProviderCompat(compatRules, currentCompat)
                if (plan) {
                    compatChanges++
                    ops.push(plan.op === 'set'
                        ? { op: 'set', path: ['providers', providerId, 'compat'], value: plan.value }
                        : { op: 'unset', path: ['providers', providerId, 'compat'] })
                }
            }
        }
        if (ops.length === 0) return 0
        try {
            await ctx.settings.mutate(API_NS, ops, descriptor.revision)
            ctx.logger.info(`${PLUGIN_NAME}: 已变更 ${changes} 个模型（补充/同步推理级别、容量字段、图片模态、清理空字段）、${compatChanges} 个提供方的路由 compat（developer 角色兼容），跳过 ${excluded} 个已排除提供方`)
            return changes
        } catch (error) {
            if (isSettingsConflict(error) && attempt < MAX_ATTEMPTS) continue
            ctx.logger.warn(`${PLUGIN_NAME}: ${error instanceof Error ? error.message : String(error)}`)
            // 已告警仍抛出：调用方按需处理（RPC 回传错误 / 事件侧吞掉），不静默吞错
            throw error
        }
    }
    // 不可达：循环内各路径均 return/throw，continue 仅在 attempt < MAX_ATTEMPTS 时发生；仅作类型收敛
    return 0
}
