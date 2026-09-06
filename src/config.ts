import z from '@deepseek-ai/schemastery'
import { CONFIG_VERSION, MIN_SUPPORTED_VERSION, VERSION_PREFIX } from './constants'
import type { FieldRules, PluginConfig, VersionedSection } from './types'
import { isPlainObject } from './types'

/** 默认配置：填充缺失开启，覆盖更新关闭 */
export const DEFAULT_CONFIG: PluginConfig = {
    allowUpdate: { reasoning: false, context: false, image: false },
    autoFill: { reasoning: true, context: true, image: true },
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
 * 当前版本配置 schema：仅对象写法（布尔写法只存在于 v0，经升级链展开为对象后进入存储，
 * 运行时只接受对象写法，杜绝语法二义性）；字段整体缺失时落该项默认（取 DEFAULT_CONFIG，
 * 展开为新对象以免 schema 默认与运行时常量共享引用）。
 */
const PluginConfigSchema: z<PluginConfig> = z.object({
    allowUpdate: fieldRules(false).default({ ...DEFAULT_CONFIG.allowUpdate }),
    autoFill: fieldRules(true).default({ ...DEFAULT_CONFIG.autoFill }),
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
        return { allowUpdate: parsed.allowUpdate, autoFill: parsed.autoFill }
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

// 生效配置源：installSettingsSection 挂载后指向 settings scope，否则回退默认
let configSource: () => PluginConfig = () => DEFAULT_CONFIG

/** 挂载配置读取来源（由 installSettingsSection 的 setSource 调用） */
export function setConfigSource(current: () => PluginConfig): void {
    configSource = current
}

/** 当前生效配置 */
export function getConfig(): PluginConfig {
    return configSource()
}
