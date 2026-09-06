import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { CONFIG_VERSION, LEGACY_NS, MAX_OLD_SNAPSHOTS, MIN_SUPPORTED_VERSION, PLUGIN_NAME, PLUGIN_NS, REGISTER_WAIT_MAX } from './constants'
import { DEFAULT_CONFIG, parseVersion, versionKey } from './config'
import type { LegacyConfig, LegacyFieldRules, LegacyFieldSwitch, PluginConfigSnapshot, V1FieldRules, V1PluginConfigSnapshot, VersionedSection } from './types'
import { isPlainObject } from './types'

// ---------- LEGACY（v0）迁移源代码：形态冻结（见 types.ts LEGACY 段说明），不引用当前版本的可演进定义。 ----------

/** LEGACY(v0)：字段规则 schema，dflt 为省略字段的默认值 */
const legacyFieldRules = (dflt: boolean): z<LegacyFieldRules> => z.object({
    reasoning: z.boolean().default(dflt),
    context: z.boolean().default(dflt),
})

/** LEGACY(v0)：默认配置——旧 NS 注册的 base 层、schema 整项缺省与解析失败兜底的唯一来源 */
export const LEGACY_BASE: LegacyConfig = { allowUpdate: false, autoFill: true }

/** LEGACY(v0)：配置 schema（布尔统一开关或对象按字段控制） */
export const LegacyConfigSchema: z<LegacyConfig> = z.object({
    allowUpdate: z.union([z.boolean(), legacyFieldRules(false)]).default(LEGACY_BASE.allowUpdate),
    autoFill: z.union([z.boolean(), legacyFieldRules(true)]).default(LEGACY_BASE.autoFill),
})

/** LEGACY(v0)：布尔统一开关展开为规范对象形态（schema 解析后对象内字段已补齐） */
function legacyExpand(value: LegacyFieldSwitch): LegacyFieldRules {
    if (typeof value === 'boolean') return { reasoning: value, context: value }
    return value
}

// ---------- 历史版本（v1）迁移源代码：新命名空间版本快照体系内 v1 快照的冻结形态（见 types.ts 历史版本(v1) 段说明，非 LEGACY 旧命名空间），不引用当前版本的可演进定义。 ----------

/** 历史版本(v1)：字段规则 schema（无 image 字段），dflt 为省略字段的默认值 */
const v1FieldRules = (dflt: boolean): z<V1FieldRules> => z.object({
    reasoning: z.boolean().default(dflt),
    context: z.boolean().default(dflt),
})

/** 历史版本(v1)：默认配置——解析失败兜底与 schema 整项缺省的唯一来源 */
const V1_BASE: Omit<V1PluginConfigSnapshot, 'configVersion'> = { allowUpdate: { reasoning: false, context: false }, autoFill: { reasoning: true, context: true } }

/** 历史版本(v1)：配置 schema（仅对象写法，configVersion 等多余键被 schema 忽略；默认取 V1_BASE 的展开副本） */
const V1ConfigSchema: z<Omit<V1PluginConfigSnapshot, 'configVersion'>> = z.object({
    allowUpdate: v1FieldRules(false).default({ ...V1_BASE.allowUpdate }),
    autoFill: v1FieldRules(true).default({ ...V1_BASE.autoFill }),
})

/** v0 → v1：输入按 v0 schema 解析（非法整体回退 v0 默认），布尔统一开关展开为对象并补齐省略字段，添加版本号 */
function upgrade0To1(config: unknown, fromVersion: number): V1PluginConfigSnapshot {
    if (fromVersion < MIN_SUPPORTED_VERSION) {
        throw new Error(`无法从 v${fromVersion} 升级：低于最低支持版本 v${MIN_SUPPORTED_VERSION}`)
    }
    let legacy: LegacyConfig
    try {
        legacy = LegacyConfigSchema((isPlainObject(config) ? config : {}) as unknown as LegacyConfig)
    } catch {
        legacy = LEGACY_BASE
    }
    // 台阶目标版本固定为 1（本函数产物形态恒定），更高版本由后续台阶接力，故不引用 CONFIG_VERSION
    return { configVersion: 1, allowUpdate: legacyExpand(legacy.allowUpdate), autoFill: legacyExpand(legacy.autoFill) }
}

// ---------- 升级链（每级只做相邻版本升级） ----------

/** v1 → v2：输入按 v1 冻结 schema 解析（非法整体回退 v1 默认），新增 image 字段并落各自默认（autoFill=true、allowUpdate=false） */
function upgrade1To2(config: unknown, fromVersion: number): PluginConfigSnapshot {
    const v1 = fromVersion < 1
        ? upgrade0To1(config, fromVersion)
        : (() => {
            try {
                return V1ConfigSchema((isPlainObject(config) ? config : {}) as unknown as Omit<V1PluginConfigSnapshot, 'configVersion'>)
            } catch {
                return V1_BASE
            }
        })()
    // 台阶目标版本固定为 2（本函数产物形态恒定），更高版本由后续台阶接力，故不引用 CONFIG_VERSION
    return {
        configVersion: 2,
        allowUpdate: { ...v1.allowUpdate, image: false },
        autoFill: { ...v1.autoFill, image: true },
    }
}

/**
 * 配置版本迁移入口：把 fromVersion（段内旧快照版本；旧 NS 配置传最低支持版本 0）
 * 逐级升级到当前 CONFIG_VERSION 快照形态。
 * 新版本发布时：新增「只做相邻一级升级」的 upgradeNToN+1 函数，并把本函数指向最新台阶，
 * 链上既有函数一律不改。例如未来当前版本=3：
 *   upgradeConfig = (c, v) => upgrade2To3(c, v)
 *   upgrade2To3 = (c, v) => { const v2 = v < 2 ? upgrade1To2(c, v) : c; return /* 2→3 的升级 *\/ }
 */
export function upgradeConfig(config: unknown, fromVersion: number): PluginConfigSnapshot {
    // 当前版本 = 2：升级链最新台阶为 v1 → v2
    return upgrade1To2(config, fromVersion)
}

/** 全新用户的规范默认快照（与升级链对空输入的结果一致，由 test 守护） */
export const DEFAULT_STORED: PluginConfigSnapshot = {
    configVersion: CONFIG_VERSION,
    allowUpdate: DEFAULT_CONFIG.allowUpdate,
    autoFill: DEFAULT_CONFIG.autoFill,
}

/** 收集段内合法版本号（升序）；不按最低支持过滤，低于最低支持的版本交由 pruneOps Phase A 清理 */
function collectVersions(section: VersionedSection | undefined): number[] {
    if (!section) return []
    const versions = new Set<number>()
    for (const key of Object.keys(section)) {
        const version = parseVersion(key)
        if (version !== undefined) versions.add(version)
    }
    return [...versions].sort((a, b) => a - b)
}

/**
 * 两阶段清理旧快照（versions 升序）：
 * - Phase A：清理低于 MIN_SUPPORTED_VERSION 的快照（已失效，不读取不处理）
 * - Phase B：清理低于当前版本且超出 MAX_OLD_SNAPSHOTS 上限的 excess（从最低版本起淘汰）
 * 等于或高于当前版本的快照始终保留（当前在使用，高版本供回退后无损读取）。
 * v0 位于 LEGACY 旧命名空间、不在当前 NS 的 version-N 键内，故不在此处理。
 * configVersion/minSupported/maxOld 默认取当前常量，测试可覆写以覆盖更高版本台阶。
 */
export function pruneOps(
    versions: number[],
    configVersion: number = CONFIG_VERSION,
    minSupported: number = MIN_SUPPORTED_VERSION,
    maxOld: number = MAX_OLD_SNAPSHOTS,
): SettingsPathOp[] {
    const ops: SettingsPathOp[] = []
    // Phase A：清理低于最低支持版本的快照（已失效，不读取不处理）
    for (const version of versions) {
        if (version < minSupported) ops.push({ op: 'unset', path: [versionKey(version)] })
    }
    // Phase B：低于当前版本且超出保留上限的，从最低版本起淘汰
    const olds = versions.filter((version) => version >= minSupported && version < configVersion)
    if (olds.length > maxOld) {
        for (const version of olds.slice(0, olds.length - maxOld)) {
            ops.push({ op: 'unset', path: [versionKey(version)] })
        }
    }
    return ops
}

/** 读取指定命名空间当前的用户段与 revision */
function readSection(ctx: Context, ns: SettingsNamespace) {
    const descriptor = ctx.settings.describe().find((d) => d.ns === ns)
    if (!descriptor) return
    return { user: descriptor.user, revision: descriptor.revision }
}

/**
 * 某命名空间当前是否已成功注册。
 * 注册在 installSettingsSection 的子 fiber 微任务内完成，重复注册或存储段非法会在该时点抛出，
 * 故注册成功与否只能在异步就绪点用本函数观察。
 */
export function isNamespaceRegistered(ctx: Context, ns: SettingsNamespace): boolean {
    return ctx.settings.describe().some((descriptor) => descriptor.ns === ns)
}

/**
 * 有界等待自有配置命名空间完成注册。
 * 背景：installSettingsSection 经 ctx.inject 子 fiber 注册命名空间，注册回调被推迟到微任务；
 * 而插件 apply 内的启动 effect 同步执行，此刻 describe() 尚不含 PLUGIN_NS，直接迁移会读空、写空。
 * 让出一个宏任务即可排空这些微任务（含注册）；设次数上限以在服务缺席时不阻塞，尊重卸载。
 */
export async function waitForSettingsReady(ctx: Context, isDisposed: () => boolean): Promise<boolean> {
    for (let attempt = 0; attempt < REGISTER_WAIT_MAX; attempt++) {
        if (isDisposed()) return false
        if (isNamespaceRegistered(ctx, PLUGIN_NS)) return true
        // 让出一个宏任务：当前所有微任务（含注册回调）排空后再检查
        await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return isNamespaceRegistered(ctx, PLUGIN_NS)
}

/**
 * 启动时配置迁移：
 * - 有当前版本快照 → 直接使用，两阶段清理低版本旧快照：先清低于最低支持版本，再清低于当前版本且超出上限的 excess（高版本快照保留）
 * - 无当前版本 → 依次尝试：段内最低支持以上的最高旧快照 → 旧命名空间用户段（v0），走升级链；
 *   两者皆无（全新用户）→ 直接写入规范默认快照（不经升级链），确保后续读取必有当前版本
 * - 旧命名空间段保留，供回滚旧版插件继续读取
 */
export async function migrateConfig(ctx: Context): Promise<void> {
    const mine = readSection(ctx, PLUGIN_NS)
    if (!mine) return
    const section = isPlainObject(mine.user) ? mine.user as VersionedSection : undefined
    const versions = collectVersions(section)
    if (versions.includes(CONFIG_VERSION)) {
        const ops = pruneOps(versions)
        if (ops.length > 0) await ctx.settings.mutate(PLUGIN_NS, ops, mine.revision)
        return
    }
    if (versions.some((v) => v > CONFIG_VERSION)) {
        ctx.logger.warn(`${PLUGIN_NAME}: 检测到更高版本的配置快照（可能有新版插件在管配置），本版本仅保留不读取其内容`)
    }
    // 迁移源：段内不低于最低支持的最高旧快照；其次存在用户段的旧 NS；均无则视为全新用户，直接落默认
    const olds = versions.filter((v) => v >= MIN_SUPPORTED_VERSION && v < CONFIG_VERSION)
    const sourceVersion = olds[olds.length - 1]
    const legacyUser = readSection(ctx, LEGACY_NS)?.user
    let stored: PluginConfigSnapshot
    let action: string
    if (sourceVersion !== undefined) {
        stored = upgradeConfig(section?.[versionKey(sourceVersion)], sourceVersion)
        action = `从段内 ${versionKey(sourceVersion)} 快照升级`
    } else if (isPlainObject(legacyUser)) {
        stored = upgradeConfig(legacyUser, MIN_SUPPORTED_VERSION)
        action = `从旧命名空间配置（v${MIN_SUPPORTED_VERSION}）升级`
    } else {
        stored = DEFAULT_STORED
        action = '写入默认配置'
    }
    const ops: SettingsPathOp[] = [
        { op: 'set', path: [versionKey(CONFIG_VERSION)], value: stored },
        ...pruneOps(versions),
    ]
    await ctx.settings.mutate(PLUGIN_NS, ops, mine.revision)
    ctx.logger.info(`${PLUGIN_NAME}: ${action}，已写入 ${versionKey(CONFIG_VERSION)} 快照`)
}
