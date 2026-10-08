/**
 * 推理级别记忆的读法：Node 半（子智能体档位策略按记忆取值）与浏览器半（会话模型选择联动恢复记忆）
 * 共用的唯一入口——记忆表 `efforts` 的形状由 `@/shared/types` 定义，两半按同一路径下钻。
 */

import type { EffortMemory } from '@/shared/types'

/** 嵌套查记忆：provider → model → 级别；无记录返回 undefined */
export function lookupEffort(memory: EffortMemory, provider: string, model: string): string | undefined {
    return memory[provider]?.[model]
}