// reset.ts 纯函数测试：重置计划（剔除插件填充字段、排除跳过、零变更零 op）
import { planResetModels, startIgnoreAll, endIgnoreAll, isIgnoreAll } from '../src/reset'
import type { PluginConfig } from '../src/types'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { check } from './helper'

const base: PluginConfig = {
    autoFill: { reasoning: true, context: false, image: true },
    allowUpdate: { reasoning: false, context: true, image: false },
    compat: { disableDeveloper: true },
    excludes: ['acme-gateway'],
}

/** 取 modelOps 中 path 匹配的第一条 set op 的 value（provider 级 models 数组） */
function modelsValueOf(modelOps: SettingsPathOp[], providerPath: string): Record<string, unknown>[] | undefined {
    const op = modelOps.find((o) => o.path.join('.') === providerPath)
    return op !== undefined && op.op === 'set' ? (op.value as Record<string, unknown>[]) : undefined
}

/** 执行本文件的全部用例 */
export function run(): void {
    // ---------- planResetModels：模型参数剔除 ----------
    const providers = {
        // 有插件填充字段，应剔除
        normal: { models: [
            { id: 'a', reasoningEfforts: { off: null, high: 'high' }, contextWindow: 200_000, maxTokens: 8_000, input: ['text', 'image'], temperature: 0.7, customField: 42 },
            { id: 'b', description: 'no filled fields' },
        ] },
        // 命中排除，整体跳过
        'acme-gateway': { models: [{ id: 'c', reasoningEfforts: { off: null }, contextWindow: 100 }] },
        // 无 models 键
        noModels: { api: 'openai-completions' },
        // models 非数组
        badModels: { models: { x: 1 } },
    }
    const plan = planResetModels(base, providers)
    const next = modelsValueOf(plan.modelOps, 'providers.normal.models')

    check('排除的 provider 不产出模型 op', plan.modelOps.every((op) => op.path.join('.') !== 'providers.acme-gateway.models'))
    check('无 models 的 provider 不产出模型 op', plan.modelOps.every((op) => op.path.join('.') !== 'providers.noModels.models'))
    check('models 非数组的 provider 不产出模型 op', plan.modelOps.every((op) => op.path.join('.') !== 'providers.badModels.models'))
    check('非排除且有 models 的 provider 产出整段 set op', next !== undefined)
    check('模型数组中无填充字段的元素原样保留', next !== undefined
        && next.length === 2
        && next[1] !== undefined
        && next[1]!.description === 'no filled fields')
    check('有填充字段的模型：四个字段全剔除', next !== undefined
        && next[0] !== undefined
        && next[0]!.reasoningEfforts === undefined
        && next[0]!.contextWindow === undefined
        && next[0]!.maxTokens === undefined
        && next[0]!.input === undefined)
    check('用户自定义字段保留', next !== undefined
        && next[0] !== undefined
        && next[0]!.id === 'a'
        && next[0]!.temperature === 0.7
        && next[0]!.customField === 42)
    check('changed 计数 = 受影响模型数（normal 仅模型 a 剔除字段）', plan.changed === 1)

    // 无填充字段的 provider 不产出 op（零变更零 op，与 fix 写回纪律一致）
    check('无填充字段的 provider 不产出 op（零变更零 op）',
        (() => {
            const p = planResetModels(base, { solo: { models: [{ id: 'x', description: 'd' }] } })
            return p.modelOps.length === 0 && p.changed === 0
        })())

    // 空 providers：无模型 op
    const emptyPlan = planResetModels(base, {})
    check('空 providers 无模型 op、changed 为 0', emptyPlan.modelOps.length === 0 && emptyPlan.changed === 0)

    // ---------- 事件流守卫 ----------
    check('守卫初始为 false', isIgnoreAll() === false)
    startIgnoreAll()
    check('startIgnoreAll 后为 true', isIgnoreAll() === true)
    endIgnoreAll()
    check('endIgnoreAll 后为 false', isIgnoreAll() === false)
}
