/**
 * 浏览器半纯映射层：`tikaflow-model-fix` 版本快照段 <-> 卡片配置（autoFill / allowUpdate / compat / userExperience 四组布尔 + excludes 列表）。
 * 跨半共享的常量、类型、解析函数单一来源在 `src/shared/`：浏览器半值导入 `../shared/*`（经 client 纯度门禁放行，
 * 不引 `src/constants` / `src/types` / `src/config` 的值，避免 `node:path` / schemastery 被打进浏览器包）。
 * 本文件只保留 UI 层：组的行键表与渲染顺序、快照↔配置的 UI 派生（总控 / 单格 / 脏检测 / 排除项增删 / 命中判定）。
 */

import type { PluginConfig } from '../shared/types'
import { isPlainObject } from '../shared/types'
import { API_NS as PI_AI_NS, PLUGIN_NS as MODEL_FIX_NS, CONFIG_VERSION } from '../shared/constants'
import { DEFAULT_CONFIG, FIELD_KEYS, COMPAT_KEYS, USER_EXPERIENCE_KEYS, parseSnapshot, versionKey } from '../shared/parse'

// 公共 API 再导出（卡片、index.tsx 与测试经 ./model 取用，保持既有导入路径）
export { MODEL_FIX_NS, PI_AI_NS, CONFIG_VERSION }
export { DEFAULT_CONFIG as DEFAULT_FLAGS }

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
export const GROUPS: readonly Group[] = ['autoFill', 'allowUpdate', 'compat', 'userExperience']

/** 组内行键全集（词典键映射与各组行表的类型） */
export type RowKey =
    | (typeof FIELD_KEYS)[number]
    | (typeof COMPAT_KEYS)[number]
    | (typeof USER_EXPERIENCE_KEYS)[number]

/** 全部配置布尔（与 PluginConfig 同形） */
export type Flags = PluginConfig

/**
 * 解码命名空间整段：只读当前版本快照 version-5（Node 半迁移保证启动后段内必有，见 migrateConfig）；
 * 段非法、快照缺失或非法均回退默认。永不返回 undefined（返回 undefined 会让宿主 scope 永挂 loading）。
 */
export function decodeSection(section: unknown): Flags {
    return isPlainObject(section) ? parseSnapshot(section[VERSION_KEY]) ?? DEFAULT_CONFIG : DEFAULT_CONFIG
}

/** 配置 -> 规范 v5 存储快照（configVersion + 三组布尔 + 排除列表 + 每模型推理级别记忆 + 用户体验全显式，与宿主 DEFAULT_STORED 形态一致） */
export function snapshotFromFlags(flags: Flags): Record<string, unknown> {
    return {
        configVersion: CONFIG_VERSION,
        allowUpdate: { ...flags.allowUpdate },
        autoFill: { ...flags.autoFill },
        compat: { ...flags.compat },
        excludes: [...flags.excludes],
        efforts: flags.efforts,
        userExperience: { ...flags.userExperience },
    }
}

/** 组内布尔对象的视图：组的值类型是 union，类型收窄只在此处发生一次 */
function rowsOf(flags: Flags, group: Group): Record<string, boolean> {
    return flags[group] as unknown as Record<string, boolean>
}

/** 单格取值 */
export function groupValue(flags: Flags, group: Group, key: RowKey): boolean {
    return rowsOf(flags, group)[key] === true
}

/** 组总控的当前显示值：组内任一为开即为开（点击时取反并整组同置；总开关本身无对应存储） */
export function masterValue(flags: Flags, group: Group): boolean {
    return GROUP_KEYS[group].some((key) => groupValue(flags, group, key))
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

/** 布尔组 + 排除列表逐项比较，判断草稿相对已存配置是否有改动（userExperience 属布尔组，随 GROUPS 遍历覆盖） */
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
    if (!isPlainObject(user)) return []
    const providers = user.providers
    if (!isPlainObject(providers)) return []
    return Object.keys(providers)
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
