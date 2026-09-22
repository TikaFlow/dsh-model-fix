import z from '@deepseek-ai/schemastery'
import { MIN_SUPPORTED_VERSION } from './constants'
import { CONFIG_VERSION } from './shared/constants'
import type { PluginConfig, VersionedSection } from './shared/types'
import { isPlainObject } from './shared/types'
import { DEFAULT_CONFIG, parseSnapshot, parseVersion } from './shared/parse'

/** 命名空间下的默认段值（版本快照容器） */
export const DEFAULT_SECTION: VersionedSection = {}

/** 命名空间整段的 schema：宽松字典，保证比当前代码更新的版本快照也能通过注册校验 */
export const SectionSchema: z<VersionedSection> = z.dict(z.any())

/**
 * 从版本快照段解析运行时配置：优先当前版本；否则取所有版本中 ≥ 最低支持的最高可解析快照
 * （含更高版本——按当前 schema 解析，多余键忽略、缺失字段落默认）；均不可用时回退默认配置。
 * 用于自愈重写取「当前生效值」与运行期配置源；高版本快照读取后不清理，仍供再升级无损。
 */
export function resolveConfig(section: unknown): PluginConfig {
    if (!isPlainObject(section)) return DEFAULT_CONFIG
    let best: { version: number; config: PluginConfig } | undefined
    for (const [key, value] of Object.entries(section)) {
        const version = parseVersion(key)
        if (version === undefined || version < MIN_SUPPORTED_VERSION) continue
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
