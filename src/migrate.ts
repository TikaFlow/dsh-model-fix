import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsNamespace, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { CONFIG_VERSION, MAX_OLD_SNAPSHOTS, MIN_SUPPORTED_VERSION, PLUGIN_NAME, PLUGIN_NS, REGISTER_WAIT_MAX } from './constants'
import { DEFAULT_CONFIG, parseSnapshot, parseVersion, resolveConfig, versionKey } from './config'
import type { PluginConfig, PluginConfigSnapshot, V1FieldRules, V1PluginConfigSnapshot, VersionedSection } from './types'
import { isPlainObject } from './types'

// ---------- 历史版本（v1）迁移源代码：新命名空间版本快照体系内 v1 快照的冻结形态（见 types.ts 历史版本(v1) 段说明），不引用当前版本的可演进定义。 ----------

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

// ---------- 升级链（每级只做相邻版本升级；最新台阶的守卫拒绝低于最低支持版本的输入） ----------

/** v1 → v2：输入按 v1 冻结 schema 解析（非法整体回退 v1 默认），新增 image 字段并落各自默认（autoFill=true、allowUpdate=false） */
function upgrade1To2(config: unknown, fromVersion: number): PluginConfigSnapshot {
    if (fromVersion < MIN_SUPPORTED_VERSION) {
        throw new Error(`无法从 v${fromVersion} 升级：低于最低支持版本 v${MIN_SUPPORTED_VERSION}`)
    }
    let v1: Omit<V1PluginConfigSnapshot, 'configVersion'>
    try {
        v1 = V1ConfigSchema((isPlainObject(config) ? config : {}) as unknown as Omit<V1PluginConfigSnapshot, 'configVersion'>)
    } catch {
        v1 = V1_BASE
    }
    // 台阶目标版本固定为 2（本函数产物形态恒定），更高版本由后续台阶接力，故不引用 CONFIG_VERSION
    return {
        configVersion: 2,
        allowUpdate: { ...v1.allowUpdate, image: false },
        autoFill: { ...v1.autoFill, image: true },
    }
}

/**
 * 配置版本迁移入口：把 fromVersion（段内旧快照版本）逐级升级到当前 CONFIG_VERSION 快照形态。
 * 新版本发布时：新增「只做相邻一级升级」的 upgradeNToN+1 函数，并把本函数指向最新台阶，
 * 链上既有函数一律不改。例如未来当前版本=3：
 *   upgradeConfig = (c, v) => upgrade2To3(c, v)
 *   upgrade2To3 = (c, v) => { const v2 = v < 2 ? upgrade1To2(c, v) : c; return /* 2→3 的升级 *\/ }
 */
export function upgradeConfig(config: unknown, fromVersion: number): PluginConfigSnapshot {
    // 当前版本 = 2：升级链最新台阶为 v1 → v2
    return upgrade1To2(config, fromVersion)
}

/** 把运行时配置物化为当前版本的存储快照（configVersion 由本函数补，调用方不手写版本号） */
export function toStored(config: PluginConfig): PluginConfigSnapshot {
    return { configVersion: CONFIG_VERSION, allowUpdate: config.allowUpdate, autoFill: config.autoFill }
}

/** 全新用户的规范默认快照（与升级链对空输入的结果一致，由 test 守护） */
export const DEFAULT_STORED: PluginConfigSnapshot = toStored(DEFAULT_CONFIG)

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
 * - 有当前版本快照 → 直接使用（快照本身非法则按当前生效值重写自愈），两阶段清理低版本旧快照：先清低于最低支持版本，再清低于当前版本且超出上限的 excess（高版本快照保留）
 * - 无当前版本 → 段内有最低支持以上的最高旧快照则走升级链；否则视为全新用户，
 *   直接写入规范默认快照（不经升级链），确保后续读取必有当前版本
 */
export async function migrateConfig(ctx: Context): Promise<void> {
    const mine = readSection(ctx, PLUGIN_NS)
    if (!mine) return
    const section = isPlainObject(mine.user) ? mine.user as VersionedSection : undefined
    const versions = collectVersions(section)
    if (versions.includes(CONFIG_VERSION)) {
        const ops: SettingsPathOp[] = []
        // 当前版本快照非法（如用户手改坏）时自愈：不修就会长期停在「文件里是坏值、运行期按
        // 次高版本或默认执行」的不一致状态（浏览器半同样显示默认），且每次启动都无从纠正。
        // 重写目标取当前生效值——有可用的旧快照则沿用其语义，否则落默认。
        if (!parseSnapshot(section?.[versionKey(CONFIG_VERSION)])) {
            ops.push({ op: 'set', path: [versionKey(CONFIG_VERSION)], value: toStored(resolveConfig(section)) })
            ctx.logger.warn(`${PLUGIN_NAME}: ${versionKey(CONFIG_VERSION)} 快照非法，已按当前生效配置重写`)
        }
        ops.push(...pruneOps(versions))
        if (ops.length > 0) await ctx.settings.mutate(PLUGIN_NS, ops, mine.revision)
        return
    }
    if (versions.some((v) => v > CONFIG_VERSION)) {
        ctx.logger.warn(`${PLUGIN_NAME}: 检测到更高版本的配置快照（可能有新版插件在管配置），本版本仅保留不读取其内容`)
    }
    // 迁移源：段内不低于最低支持的最高旧快照；无则视为全新用户，直接落默认
    const olds = versions.filter((v) => v >= MIN_SUPPORTED_VERSION && v < CONFIG_VERSION)
    const sourceVersion = olds[olds.length - 1]
    let stored: PluginConfigSnapshot
    let action: string
    if (sourceVersion !== undefined) {
        stored = upgradeConfig(section?.[versionKey(sourceVersion)], sourceVersion)
        action = `从段内 ${versionKey(sourceVersion)} 快照升级`
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
