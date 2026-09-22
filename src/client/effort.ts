/**
 * 每模型推理级别记忆的纯逻辑层：从会话模型选择投影的变化序列中区分「模型变化」
 * （应自动恢复记忆）与「级别变化」（应保存记忆），并计算写入后的记忆、校验目标模型
 * 是否公告该级别。零外部值依赖，宿主 API 一律用本文件的结构类型描述（type-only，构建期擦除）。
 */

import type { EffortMemory } from '../shared/types'

// ---------- 宿主 API 的结构类型（type-only，构建期擦除；不引 dsh-api-session-controller / dsh-client-ui-model-selection 依赖） ----------

/** 一次模型选择（provider + model + 可选推理级别） */
export interface SelectionLike {
    provider: string
    model: string
    reasoningEffort?: string
}

/** 模型目录中的单个模型条目 */
interface CatalogModelLike {
    id: string
    reasoning?: { efforts: readonly { id: string }[] }
}

/** 模型目录中的一个提供方分组 */
export interface GroupLike {
    id: string
    models: readonly CatalogModelLike[]
}

/** 目录 store 快照（本模块只消费 current 与 groups） */
export interface DirectoryStateLike {
    current: SelectionLike | null
    groups: readonly GroupLike[]
}

/** 通用可观察值（dsh-client-store ObservableSnapshot 的结构复制） */
interface ObservableLike<T> {
    getSnapshot(): T
    subscribe(listener: () => void): () => void
}

/** 会话保留信息 */
interface SessionRetainInfo {
    referenceCount: number
}

/** 会话列表快照 */
interface SessionListState {
    ids: string[]
}

/** 会话绑定（本模块只消费 session.projections） */
interface SessionBindingLike {
    session: { projections: { faceOf(key: string): ObservableLike<unknown> } }
}

/** 会话服务（本模块只消费 list / retainInfo / binding） */
export interface SessionsLike {
    list: ObservableLike<SessionListState>
    retainInfo(id: string): ObservableLike<SessionRetainInfo>
    binding(id: string): SessionBindingLike | undefined
}

/** 模型目录控制器（本模块只消费 store 与 select） */
interface DirectoryLike {
    store: ObservableLike<DirectoryStateLike>
    select(selection: SelectionLike): Promise<unknown>
}

/** 模型目录解析器（本模块只消费 directoryFor） */
export interface ModelDirectoriesLike {
    directoryFor(sessionId: string): DirectoryLike
}

// ---------- 纯逻辑 ----------

/** 嵌套查记忆：provider → model → 级别；无记录返回 undefined */
export function lookupEffort(memory: EffortMemory, provider: string, model: string): string | undefined {
    return memory[provider]?.[model]
}

/**
 * 计算写入后的整段记忆（不改入参）：`effort` 为字符串则记录该模型，`null` 则清除该模型记忆。
 * provider 下已无模型时整条折叠掉；全空时返回空对象（调用方照写 `{}`，不删键）。
 */
export function applyEffort(memory: EffortMemory, provider: string, model: string, effort: string | null): EffortMemory {
    const next: EffortMemory = {}
    for (const [id, models] of Object.entries(memory)) next[id] = { ...models }
    if (effort === null) {
        const entry = { ...next[provider] }
        delete entry[model]
        if (Object.keys(entry).length === 0) delete next[provider]
        else next[provider] = entry
    } else {
        next[provider] = { ...next[provider], [model]: effort }
    }
    return next
}

/** 目标模型的 `reasoning.efforts` 是否含该级别 */
export function advertisesEffort(groups: readonly GroupLike[], provider: string, model: string, effort: string): boolean {
    const group = groups.find((g) => g.id === provider)
    if (!group) return false
    const entry = group.models.find((m) => m.id === model)
    if (!entry?.reasoning) return false
    return entry.reasoning.efforts.some((e) => e.id === effort)
}

/**
 * 根据上一选择与当前选择，判定本次是否为「模型变化」（应自动恢复记忆）或「级别变化」（应保存记忆）。
 * `prev === null` 视为模型变化（首帧，只应用不记忆）。
 *
 * 返回：
 * - `{ kind: 'model-change', resolved }` — 模型变化；resolved 为可能改写后的选择
 * - `{ kind: 'effort-change' }` — 级别变化（同模型，级别不同）
 * - `{ kind: 'none' }` — 无变化（同模型同级别）
 */
type Transition =
    | { kind: 'model-change'; resolved: SelectionLike }
    | { kind: 'effort-change' }
    | { kind: 'none' }

export function classifyTransition(
    prev: SelectionLike | null,
    next: SelectionLike,
    memory: EffortMemory,
    groups: readonly GroupLike[],
): Transition {
    if (prev === null || prev.provider !== next.provider || prev.model !== next.model) {
        const remembered = lookupEffort(memory, next.provider, next.model)
        if (remembered !== undefined && remembered !== next.reasoningEffort && advertisesEffort(groups, next.provider, next.model, remembered)) {
            return { kind: 'model-change', resolved: { ...next, reasoningEffort: remembered } }
        }
        return { kind: 'model-change', resolved: next }
    }
    if (next.reasoningEffort !== prev.reasoningEffort) return { kind: 'effort-change' }
    return { kind: 'none' }
}

/** 两个选择是否完全相同（provider、model、reasoningEffort 逐字段比较） */
export function sameSelection(a: SelectionLike, b: SelectionLike): boolean {
    return a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort
}