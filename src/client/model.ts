/**
 * 浏览器半纯映射层：`tikaflow-model-fix` 版本快照段 <-> 卡片配置（autoFill / allowUpdate / compat / userExperience 四组布尔 + excludes 列表）。
 * 跨半共享的常量、类型、解析函数单一来源在 `src/shared/`：浏览器半值导入 `@/shared/*`（经 client 纯度门禁放行，
 * 不引 `src/constants` / `src/types` / `src/config` 的值，避免 `node:path` / schemastery 被打进浏览器包）。
 * 本文件只保留 UI 层：组的行键表与渲染顺序、快照↔配置的 UI 派生（总控 / 单格 / 脏检测 / 排除项增删 / 命中判定）、
 * 以及验证候选的拍取与目标收敛（卡片「验证模型」弹层消费）。
 */

import type { PluginConfig } from '@/shared/types'
import { isPlainObject, providersOf } from '@/shared/types'
import { CONFIG_VERSION, EFFORT_LEVELS } from '@/shared/constants'
import { DEFAULT_CONFIG, FIELD_KEYS, COMPAT_KEYS, USER_EXPERIENCE_KEYS, parseSnapshot, versionKey } from '@/shared/parse'

/** 版本快照键 */
export const VERSION_KEY = versionKey(CONFIG_VERSION)

/** 瓦片对应的配置组：两个填充列 + 兼容性组 + 用户体验组 */
export type Group = 'autoFill' | 'allowUpdate' | 'compat' | 'userExperience'

/** 各组行键表（渲染顺序与总控共用） */
export const GROUP_KEYS: Record<Group, readonly RowKey[]> = {
    autoFill: FIELD_KEYS,
    allowUpdate: FIELD_KEYS,
    compat: COMPAT_KEYS,
    userExperience: USER_EXPERIENCE_KEYS,
}

/** 全部布尔配置组（脏检测遍历用；瓦片渲染顺序见 card.tsx 的 TILE_ORDER，排除提供方夹在 compat 与 userExperience 之间） */
const GROUPS: readonly Group[] = ['autoFill', 'allowUpdate', 'compat', 'userExperience']

/** 组内行键全集（词典键映射与各组行表的类型） */
export type RowKey =
    | (typeof FIELD_KEYS)[number]
    | (typeof COMPAT_KEYS)[number]
    | (typeof USER_EXPERIENCE_KEYS)[number]

/** 卡片侧消费的完整当前配置（与 PluginConfig 同形：四组布尔 + excludes + efforts） */
export type Flags = PluginConfig

/**
 * 解码命名空间整段：只读当前版本快照（键见上方 `VERSION_KEY`；Node 半迁移保证启动后段内必有，见 migrateConfig）；
 * 段非法、快照缺失或非法均回退默认。永不返回 undefined（返回 undefined 会让宿主 scope 永挂 loading）。
 */
export function decodeSection(section: unknown): Flags {
    return isPlainObject(section) ? parseSnapshot(section[VERSION_KEY]) ?? DEFAULT_CONFIG : DEFAULT_CONFIG
}

/** 组内布尔对象的视图：组的值类型是 union，类型收窄只在此处发生一次 */
function rowsOf(flags: Flags, group: Group): Record<string, boolean> {
    return flags[group] as unknown as Record<string, boolean>
}

/** 单格取值 */
export function groupValue(flags: Flags, group: Group, key: RowKey): boolean {
    return rowsOf(flags, group)[key] === true
}

/** 组总控的当前显示值：组内全为开才显示开。判据取 every 而非 any——部分选中显示关，点击即整组补全为开；
 *  若取 any，部分选中会显示成开、点击反而把用户已勾的那几行抹掉。口径与验证弹层分组「全选」一致。
 *  （总开关本身无对应存储，只是个批量操作） */
export function masterValue(flags: Flags, group: Group): boolean {
    return GROUP_KEYS[group].every((key) => groupValue(flags, group, key))
}

/** 整组同置：把 group 的全部行设为 value，返回新对象（不改入参） */
export function applyGroup(flags: Flags, group: Group, value: boolean): Flags {
    const rows: Record<string, boolean> = {}
    for (const key of GROUP_KEYS[group]) rows[key] = value
    return { ...flags, [group]: rows } as Flags
}

/** 单格取反：把 group.key 翻转，返回新对象（不改入参） */
export function toggleCell(flags: Flags, group: Group, key: RowKey): Flags {
    const rows = { ...rowsOf(flags, group) }
    rows[key] = !rows[key]
    return { ...flags, [group]: rows } as Flags
}

/**
 * 排除列表逐项比较（**顺序敏感**）：草稿只由已存值经增删派生，顺序不会自行漂移，
 * 故无需排序——插入顺序是用户意图的一部分。
 */
function sameIdList(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) return false
    return a.every((id, index) => id === b[index])
}

/** 布尔组 + 排除列表逐项比较，判断草稿相对已存配置是否有改动（userExperience 属布尔组，随 GROUPS 遍历覆盖；
 * `efforts` 是运行时记忆而非用户配置，不参与比较，故改记忆不标脏） */
export function isDirty(draft: Flags, saved: Flags): boolean {
    for (const group of GROUPS) {
        for (const key of GROUP_KEYS[group]) {
            if (groupValue(draft, group, key) !== groupValue(saved, group, key)) return true
        }
    }
    return !sameIdList(draft.excludes, saved.excludes)
}

/**
 * 从 `llm-pi-ai` 的 user 层取提供方 id（与 Node 半 fix 遍历的 `descriptor.user.providers` 同一事实源，
 * 故「命中」判定与本插件真实会跳过的集合零漂移）。非纯对象、无 providers 或 providers 非纯对象一律视为空。
 */
export function providerIdsOf(user: unknown): string[] {
    return Object.keys(providersOf(user) ?? {})
}

/** 命中的排除项集合：既决定标签的命中高亮，其 size 即 summary 徽标的命中数（未命中项仍生效，只是当前无同名提供方） */
export function resolveHits(excludes: readonly string[], providerIds: readonly string[]): ReadonlySet<string> {
    const live = new Set(providerIds)
    return new Set(excludes.filter((id) => live.has(id)))
}

/** 新增排除项：已存在则原样返回（调用方先行拦截重复，此处只保证幂等）；不改入参 */
export function addExclude(flags: Flags, id: string): Flags {
    if (flags.excludes.includes(id)) return flags
    return { ...flags, excludes: [...flags.excludes, id] }
}

/** 删除排除项：不存在的 id 原样返回；不改入参 */
export function removeExclude(flags: Flags, id: string): Flags {
    const index = flags.excludes.indexOf(id)
    if (index < 0) return flags
    const excludes = [...flags.excludes]
    excludes.splice(index, 1)
    return { ...flags, excludes }
}

/** 排除项 id 的合法性规则：逐字复制宿主 models 页新增提供方时的 route id 校验（同一权威规则，两侧不得自行放宽） */
export const EXCLUDE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * 一个待验证的「提供方 / 模型」：附带该模型在配置里声明的推理级别（`reasoningEfforts` 的键，
 * 按 `EFFORT_LEVELS` 由低到高排序去重；无该字段即 `[]`，表示不带档位探测）。
 * 列表项与 RPC 载荷同形，故两者共用这一个类型。
 */
export interface VerifyCandidate {
    provider: string
    model: string
    efforts: string[]
}

/** 选择键：模型 id 可含 '/'，故取二元组序列化而非字符串拼接（同一口径与 Node 半 summarizeProbes 的去重键一致） */
export function verifyKey(provider: string, model: string): string {
    return JSON.stringify([provider, model])
}

/**
 * 从 `llm-pi-ai` 的 user 层拍出验证候选（与 Node 半 fix 遍历同一事实源，故列表与实际会填充的模型零漂移）。
 * 保持录入顺序；提供方非对象、无 models 数组、模型无 id 的行一律跳过。
 * 不套用 `excludes`：验证是只读诊断，排除语义只约束插件对配置的写入。
 */
export function verifyCandidatesOf(user: unknown): VerifyCandidate[] {
    const candidates: VerifyCandidate[] = []
    for (const [provider, entry] of Object.entries(providersOf(user) ?? {})) {
        if (!isPlainObject(entry) || !Array.isArray(entry.models)) continue
        for (const model of entry.models) {
            if (!isPlainObject(model) || typeof model.id !== 'string' || model.id === '') continue
            const declared = isPlainObject(model.reasoningEfforts) ? model.reasoningEfforts : undefined
            // 档位取配置里的**键**（即模型页送出、宿主校验的那个 id），并按规范次序归一
            const efforts = declared === undefined ? [] : EFFORT_LEVELS.filter((level) => Object.hasOwn(declared, level))
            candidates.push({ provider, model: model.id, efforts: [...efforts] })
        }
    }
    return candidates
}

/**
 * 从勾选的候选算出校验目标：`allEfforts` 为真时逐个档位探测，否则只取最低的一个
 * （`EFFORT_LEVELS` 首位即最低；无档位模型两种模式都产出空数组，即不带档位探测）。
 */
export function verifyTargets(
    candidates: readonly VerifyCandidate[],
    keys: ReadonlySet<string>,
    allEfforts: boolean,
): VerifyCandidate[] {
    return candidates
        .filter((candidate) => keys.has(verifyKey(candidate.provider, candidate.model)))
        .map((candidate) => ({
            ...candidate,
            efforts: allEfforts || candidate.efforts.length === 0 ? candidate.efforts : candidate.efforts.slice(0, 1),
        }))
}
