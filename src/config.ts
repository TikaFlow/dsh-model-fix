import z from '@deepseek-ai/schemastery'
import { CONFIG_VERSION, MIN_SUPPORTED_VERSION, VERSION_PREFIX } from './constants'
import type { CompatRules, EffortMemory, FieldRules, PluginConfig, VersionedSection } from './types'
import { isPlainObject } from './types'

/** 默认配置：填充缺失开启，覆盖更新关闭，兼容性规则默认按旧版 API（不使用 developer 角色）处理，排除列表为空，每模型推理级别记忆为空 */
export const DEFAULT_CONFIG: PluginConfig = {
    allowUpdate: { reasoning: false, context: false, image: false },
    autoFill: { reasoning: true, context: true, image: true },
    compat: { disableDeveloper: true },
    excludes: [],
    efforts: {},
}

/** 命名空间下的默认段值（版本快照容器） */
export const DEFAULT_SECTION: VersionedSection = {}

/** 字段规则 schema：dflt 为省略字段的默认值（autoFill 传 true，allowUpdate 传 false） */
const fieldRules = (dflt: boolean): z<FieldRules> => z.object({
    reasoning: z.boolean().default(dflt),
    context: z.boolean().default(dflt),
    image: z.boolean().default(dflt),
})

/**
 * 兼容性规则 schema：每个键对应 provider 路由 compat 下的一个字段。
 * 后续新增兼容性配置在此追加布尔键即可（缺省落 DEFAULT_CONFIG.compat），不需要递增 CONFIG_VERSION。
 */
const compatRules: z<CompatRules> = z.object({
    disableDeveloper: z.boolean().default(true),
})

/**
 * 排除列表 schema：整项缺失落空数组；非数组或元素非字符串判整段快照非法
 * （与 fieldRules / compatRules 同一严格度，浏览器半 parseV5 须逐条镜像）。
 */
const excludesRules: z<string[]> = z.array(z.string()).default([])

/**
 * 每模型推理级别记忆的宽松解析：结构不符回落 {}。
 * efforts 是运行时记忆而非用户配置——不放进 PluginConfigSchema（schema 只管用户配置字段），
 * 单独宽松解析：记忆坏值不能让整段快照判非法（否则配置自愈重写会连累丢配置）。
 */
export function parseEfforts(value: unknown): EffortMemory {
    if (!isPlainObject(value)) return {}
    const result: EffortMemory = {}
    for (const [provider, models] of Object.entries(value)) {
        if (!isPlainObject(models)) continue
        const entry: Record<string, string> = {}
        for (const [model, level] of Object.entries(models)) {
            if (typeof level === 'string') entry[model] = level
        }
        if (Object.keys(entry).length > 0) result[provider] = entry
    }
    return result
}

/**
 * 当前版本配置 schema：仅对象写法（不接受布尔简写，杜绝语法二义性）；字段整体缺失时落该项默认（取 DEFAULT_CONFIG，
 * 展开为新对象以免 schema 默认与运行时常量共享引用）。
 */
const PluginConfigSchema: z<Omit<PluginConfig, 'efforts'>> = z.object({
    allowUpdate: fieldRules(false).default({ ...DEFAULT_CONFIG.allowUpdate }),
    autoFill: fieldRules(true).default({ ...DEFAULT_CONFIG.autoFill }),
    compat: compatRules.default({ ...DEFAULT_CONFIG.compat }),
    excludes: excludesRules.default([...DEFAULT_CONFIG.excludes]),
})

/** 命名空间整段的 schema：宽松字典，保证比当前代码更新的版本快照也能通过注册校验 */
export const SectionSchema: z<VersionedSection> = z.dict(z.any())

/** 解析版本快照键 version-N；非法返回 undefined。严格匹配规范键（重建键名需与实际键一致，禁宽泛归一） */
export function parseVersion(key: string): number | undefined {
    const match = /^version-(0|[1-9]\d*)$/.exec(key)
    return match ? Number(match[1]) : undefined
}

/** 版本快照键 */
export function versionKey(version: number): string {
    return `${VERSION_PREFIX}${version}`
}

/**
 * 校验单个快照值并物化默认；剥离 configVersion 等运行时不消费的键，非法返回 undefined。
 * 导出供迁移侧判定「当前版本快照是否仍可解析」以决定是否需要自愈重写。
 */
export function parseSnapshot(value: unknown): PluginConfig | undefined {
    if (!isPlainObject(value)) return
    try {
        const parsed = PluginConfigSchema(value as unknown as PluginConfig)
        // excludes 复制为新数组：schema 默认实例不与运行时配置共享引用；efforts 宽松解析（结构不符回落 {}）
        return { allowUpdate: parsed.allowUpdate, autoFill: parsed.autoFill, compat: parsed.compat, excludes: [...parsed.excludes], efforts: parseEfforts(value.efforts) }
    } catch {
        return
    }
}

/**
 * 从版本快照段解析运行时配置：优先当前版本；否则取 ≤ 当前且 ≥ 最低支持的最高版本；
 * 均不可用时回退默认配置（更高版本快照超出本代码理解范围，由写入它的版本负责）。
 */
export function resolveConfig(section: unknown): PluginConfig {
    if (!isPlainObject(section)) return DEFAULT_CONFIG
    let best: { version: number; config: PluginConfig } | undefined
    for (const [key, value] of Object.entries(section)) {
        const version = parseVersion(key)
        if (version === undefined || version < MIN_SUPPORTED_VERSION || version > CONFIG_VERSION) continue
        const config = parseSnapshot(value)
        if (!config) continue
        if (version === CONFIG_VERSION) return config
        if (!best || version > best.version) best = { version, config }
    }
    return best?.config ?? DEFAULT_CONFIG
}

// 生效配置源：ctx.settings.installSection 的 setSource 挂上 scope 后指向命名空间，否则回退默认
let configSource: () => PluginConfig = () => DEFAULT_CONFIG

/** 挂载配置读取来源（由 index.ts 的 installSection setSource 调用） */
export function setConfigSource(current: () => PluginConfig): void {
    configSource = current
}

/** 当前生效配置 */
export function getConfig(): PluginConfig {
    return configSource()
}
