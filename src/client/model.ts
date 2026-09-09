/**
 * 浏览器半纯映射层：`tikaflow-model-fix` 版本快照段 <-> 卡片配置（autoFill / allowUpdate / compat 三组布尔 + excludes 列表）。
 * 零外部值依赖（不引 src/constants、src/types 的值，避免 node:path 等被打进浏览器包），
 * 只读当前版本快照（Node 半迁移保证其存在；缺失/非法回退默认）。
 */

import type { CompatRules, FieldRules, PluginConfig } from '../types'

/** 本插件的配置命名空间（与 src/constants.ts 的 PLUGIN_NS 字面量一致，宿主迁移后仅存本 NS）；
 * 浏览器半另以 `/${MODEL_FIX_NS}` 拼强制更新 RPC channel，与 src/rpc.ts 的 `/${PLUGIN_NS}` 配对，改动须两侧同步 */
export const MODEL_FIX_NS = 'tikaflow-model-fix'

/** 提供方所在的宿主配置命名空间（与 src/constants.ts 的 API_NS 字面量一致）：仅用于读 user 层提供方 id 以判定排除项是否命中 */
export const PI_AI_NS = 'llm-pi-ai'

/** 当前代码配置版本；与 src/constants.ts 的 CONFIG_VERSION 同步修改 */
export const CONFIG_VERSION = 4

/** 版本快照键前缀 */
const VERSION_PREFIX = 'version-'

/** 快照写入的字段键（保存时单字段原子写 version-N，不触碰段内其他键） */
export const VERSION_KEY = `${VERSION_PREFIX}${CONFIG_VERSION}`

/** 模型参数行对应的字段键（自动填充 / 允许更新两组的行，渲染顺序与总控共用）；对外经 GROUP_KEYS 暴露 */
const FIELD_KEYS = ['reasoning', 'context', 'image'] as const

/** 兼容性规则键（compat 组的行）；后续同组新增兼容性配置在此追加即可，不需要递增 CONFIG_VERSION */
const COMPAT_KEYS = ['disableDeveloper'] as const

/** 组内行键全集（词典键映射与各组行表的类型） */
export type RowKey = (typeof FIELD_KEYS)[number] | (typeof COMPAT_KEYS)[number]

/** 模型参数的两个列名（对应快照的 autoFill / allowUpdate 组） */
type Column = 'autoFill' | 'allowUpdate'

/** 瓦片对应的配置组：两个填充列 + 兼容性组 */
export type Group = Column | 'compat'

/** 各组行键表（渲染顺序与总控共用） */
export const GROUP_KEYS: Record<Group, readonly RowKey[]> = {
    autoFill: FIELD_KEYS,
    allowUpdate: FIELD_KEYS,
    compat: COMPAT_KEYS,
}

/** 全部配置组（= 瓦片渲染顺序，与 COLUMN_KEYS / HINT_KEYS 的枚举一致） */
export const GROUPS: readonly Group[] = ['autoFill', 'allowUpdate', 'compat']

/** 全部配置布尔（与 PluginConfig 同形） */
export type Flags = PluginConfig

/** 判断是否为普通数据对象（与 src/types 同语义的浏览器本地复制，勿改此处以规避值依赖） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const proto: unknown = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

/**
 * 解析一组字段规则（对象写法的单列）：整体缺失落该项默认；
 * 存在但非对象、或字段存在但非布尔 => 返回 undefined 表示整段快照非法（镜像 schema 抛错语义）。
 */
function parseRules(value: unknown, dflt: boolean): FieldRules | undefined {
    if (value === undefined) return { reasoning: dflt, context: dflt, image: dflt }
    if (!isPlainObject(value)) return
    const rules = {} as FieldRules
    for (const key of FIELD_KEYS) {
        const field = value[key]
        if (field === undefined) {
            rules[key] = dflt
            continue
        }
        if (typeof field !== 'boolean') return
        rules[key] = field
    }
    return rules
}

/** 兼容性规则的省略字段默认（与 src/config.ts 的 compat schema 一致：默认按旧版 API 处理） */
const COMPAT_DEFAULTS: CompatRules = { disableDeveloper: true }

/** 解析 compat 组：整体缺失落默认；非对象、或字段存在但非布尔 => undefined（整段快照非法） */
function parseCompat(value: unknown): CompatRules | undefined {
    if (value === undefined) return { ...COMPAT_DEFAULTS }
    if (!isPlainObject(value)) return
    const rules = {} as CompatRules
    for (const key of COMPAT_KEYS) {
        const field = value[key]
        if (field === undefined) {
            rules[key] = COMPAT_DEFAULTS[key]
            continue
        }
        if (typeof field !== 'boolean') return
        rules[key] = field
    }
    return rules
}

/** 排除项 id 的合法性规则：逐字复制宿主 models 页新增提供方时的 route id 校验（同一权威规则，两侧不得自行放宽） */
export const EXCLUDE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** 默认配置：填充缺失开启，覆盖更新关闭，兼容性按旧版 API 处理，无排除项（与 src/config.ts DEFAULT_CONFIG 一致） */
export const DEFAULT_FLAGS: Flags = {
    autoFill: { reasoning: true, context: true, image: true },
    allowUpdate: { reasoning: false, context: false, image: false },
    compat: { ...COMPAT_DEFAULTS },
    excludes: [],
}

/** 解析 excludes 组：整项缺失落空数组；非数组或元素非字符串 => undefined（整段快照非法，镜像 Node 侧 schema 语义） */
function parseExcludes(value: unknown): string[] | undefined {
    if (value === undefined) return []
    if (!Array.isArray(value)) return
    const ids: string[] = []
    for (const item of value) {
        if (typeof item !== 'string') return
        ids.push(item)
    }
    return ids
}

/** 校验并物化当前版本（v4）快照；非法返回 undefined（视为无有效配置） */
function parseV4(entry: unknown): Flags | undefined {
    if (!isPlainObject(entry)) return
    const allowUpdate = parseRules(entry.allowUpdate, false)
    if (!allowUpdate) return
    const autoFill = parseRules(entry.autoFill, true)
    if (!autoFill) return
    const compat = parseCompat(entry.compat)
    if (!compat) return
    const excludes = parseExcludes(entry.excludes)
    if (!excludes) return
    return { allowUpdate, autoFill, compat, excludes }
}

/**
 * 解码命名空间整段：只读当前版本快照 version-4（Node 半迁移保证启动后段内必有，见 migrateConfig）；
 * 段非法、快照缺失或非法均回退默认。永不返回 undefined（返回 undefined 会让宿主 scope 永挂 loading）。
 */
export function decodeSection(section: unknown): Flags {
    return isPlainObject(section) ? parseV4(section[VERSION_KEY]) ?? DEFAULT_FLAGS : DEFAULT_FLAGS
}

/** 配置 -> 规范 v4 存储快照（configVersion + 三组布尔 + 排除列表全显式，与宿主 DEFAULT_STORED 形态一致） */
export function snapshotFromFlags(flags: Flags): Record<string, unknown> {
    return {
        configVersion: CONFIG_VERSION,
        allowUpdate: { ...flags.allowUpdate },
        autoFill: { ...flags.autoFill },
        compat: { ...flags.compat },
        excludes: [...flags.excludes],
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

/** 三组布尔 + 排除列表逐项比较，判断草稿相对已存配置是否有改动 */
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
