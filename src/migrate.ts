import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { MAX_OLD_SNAPSHOTS, MIN_SUPPORTED_VERSION } from '@/constants'
import { CONFIG_VERSION, PLUGIN_NAME, PLUGIN_NS } from '@/shared/constants'
import { resolveConfig } from '@/config'
import { queueTask } from '@/host'
import { DEFAULT_CONFIG, parseSnapshot, parseVersion, toStored, versionKey } from '@/shared/parse'
import type { PluginConfigSnapshot, UserExperienceRules, VersionedSection } from '@/shared/types'
import type { V1FieldRules, V1PluginConfigSnapshot, V2FieldRules, V2PluginConfigSnapshot, V3CompatRules, V3FieldRules, V3PluginConfigSnapshot, V4CompatRules, V4FieldRules, V4PluginConfigSnapshot } from '@/types'
import { isPlainObject } from '@/shared/types'

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

// ---------- 历史版本（v2）迁移源代码：版本快照体系内 v2 快照的冻结形态（见 types.ts 历史版本(v2) 段说明），不引用当前版本的可演进定义。 ----------

/** 历史版本(v2)：字段规则 schema（含 image，无 compat 对象），dflt 为省略字段的默认值 */
const v2FieldRules = (dflt: boolean): z<V2FieldRules> => z.object({
    reasoning: z.boolean().default(dflt),
    context: z.boolean().default(dflt),
    image: z.boolean().default(dflt),
})

/** 历史版本(v2)：默认配置——解析失败兜底与 schema 整项缺省的唯一来源 */
const V2_BASE: Omit<V2PluginConfigSnapshot, 'configVersion'> = { allowUpdate: { reasoning: false, context: false, image: false }, autoFill: { reasoning: true, context: true, image: true } }

/** 历史版本(v2)：配置 schema（仅对象写法，configVersion 等多余键被 schema 忽略；默认取 V2_BASE 的展开副本） */
const V2ConfigSchema: z<Omit<V2PluginConfigSnapshot, 'configVersion'>> = z.object({
    allowUpdate: v2FieldRules(false).default({ ...V2_BASE.allowUpdate }),
    autoFill: v2FieldRules(true).default({ ...V2_BASE.autoFill }),
})

// ---------- 历史版本（v3）迁移源代码：版本快照体系内 v3 快照的冻结形态（见 types.ts 历史版本(v3) 段说明），不引用当前版本的可演进定义。 ----------

/** 历史版本(v3)：字段规则 schema（与 v2 同形，独立声明以冻结形态），dflt 为省略字段的默认值 */
const v3FieldRules = (dflt: boolean): z<V3FieldRules> => z.object({
    reasoning: z.boolean().default(dflt),
    context: z.boolean().default(dflt),
    image: z.boolean().default(dflt),
})

/** 历史版本(v3)：兼容性规则 schema（该形态只有一个键，取值写字面量以免随当前版本演进） */
const v3CompatRules: z<V3CompatRules> = z.object({
    disableDeveloper: z.boolean().default(true),
})

/** 历史版本(v3)：默认配置——解析失败兜底与 schema 整项缺省的唯一来源 */
const V3_BASE: Omit<V3PluginConfigSnapshot, 'configVersion'> = {
    allowUpdate: { reasoning: false, context: false, image: false },
    autoFill: { reasoning: true, context: true, image: true },
    compat: { disableDeveloper: true },
}

/** 历史版本(v3)：配置 schema（仅对象写法，configVersion 等多余键被 schema 忽略；默认取 V3_BASE 的展开副本） */
const V3ConfigSchema: z<Omit<V3PluginConfigSnapshot, 'configVersion'>> = z.object({
    allowUpdate: v3FieldRules(false).default({ ...V3_BASE.allowUpdate }),
    autoFill: v3FieldRules(true).default({ ...V3_BASE.autoFill }),
    compat: v3CompatRules.default({ ...V3_BASE.compat }),
})

// ---------- 升级链（upgradeToN 的产物即 vN 快照；调用它即「升到 N」，更低版本由它在内部逐级回推） ----------

/** 升到 v2（最低一级）：输入按 v1 冻结 schema 解析（非法整体回退 v1 默认），新增 image 字段并落各自默认（autoFill=true、allowUpdate=false） */
function upgradeTo2(config: unknown, fromVersion: number): V2PluginConfigSnapshot {
    // 全链唯一的最低版本守卫：本函数是最低一级，其输入版本下限恰为 MIN_SUPPORTED_VERSION（自维护常量），
    // 调用方已按该下限筛过迁移源，故此判断实际不会触发，只用于挡住误用。
    if (fromVersion < MIN_SUPPORTED_VERSION) {
        throw new Error(`无法从 v${fromVersion} 升级：低于最低支持版本 v${MIN_SUPPORTED_VERSION}`)
    }
    let v1: Omit<V1PluginConfigSnapshot, 'configVersion'>
    try {
        v1 = V1ConfigSchema((isPlainObject(config) ? config : {}) as unknown as Omit<V1PluginConfigSnapshot, 'configVersion'>)
    } catch {
        v1 = V1_BASE
    }
    // 产物版本固定为 2（本函数形态恒定），更高版本由后续台阶接力，故不引用 CONFIG_VERSION
    return {
        configVersion: 2,
        allowUpdate: { ...v1.allowUpdate, image: false },
        autoFill: { ...v1.autoFill, image: true },
    }
}

/**
 * 兼容性规则的台阶默认值：v2 无该对象，升级到 v3 时落默认。
 * 写字面量而不引用 config.ts 的 DEFAULT_CONFIG.compat——后者会随当前版本演进，台阶产物形态必须恒定。
 */
const V3_COMPAT_DEFAULT: V3CompatRules = { disableDeveloper: true }

/** 升到 v3：低于 v3 的输入先由 upgradeTo2 逐级接力到 v2，再按 v2 冻结 schema 解析（非法整体回退 v2 默认），新增 compat 对象并落默认 */
function upgradeTo3(config: unknown, fromVersion: number): V3PluginConfigSnapshot {
    const v2 = fromVersion < 2 ? upgradeTo2(config, fromVersion) : config
    let parsed: Omit<V2PluginConfigSnapshot, 'configVersion'>
    try {
        parsed = V2ConfigSchema((isPlainObject(v2) ? v2 : {}) as unknown as Omit<V2PluginConfigSnapshot, 'configVersion'>)
    } catch {
        parsed = V2_BASE
    }
    // 产物版本固定为 3（本函数形态恒定），更高版本由后续台阶接力，故不引用 CONFIG_VERSION
    return {
        configVersion: 3,
        allowUpdate: parsed.allowUpdate,
        autoFill: parsed.autoFill,
        compat: { ...V3_COMPAT_DEFAULT },
    }
}

/**
 * 排除列表的台阶默认值：v3 无该数组，升级到 v4 时落空列表。
 * 写空字面量而不引用 config.ts 的 DEFAULT_CONFIG.excludes，理由同上（产物形态恒定）。
 */
const V4_EXCLUDES_DEFAULT: readonly string[] = []

/** 升到 v4：低于 v4 的输入先由 upgradeTo3 逐级接力到 v3，再按 v3 冻结 schema 解析（非法整体回退 v3 默认），新增 excludes 数组并落默认 */
function upgradeTo4(config: unknown, fromVersion: number): V4PluginConfigSnapshot {
    const v3 = fromVersion < 3 ? upgradeTo3(config, fromVersion) : config
    let parsed: Omit<V3PluginConfigSnapshot, 'configVersion'>
    try {
        parsed = V3ConfigSchema((isPlainObject(v3) ? v3 : {}) as unknown as Omit<V3PluginConfigSnapshot, 'configVersion'>)
    } catch {
        parsed = V3_BASE
    }
    // 产物版本固定为 4（本函数形态恒定），更高版本由后续台阶接力，故不引用 CONFIG_VERSION
    return {
        configVersion: 4,
        allowUpdate: parsed.allowUpdate,
        autoFill: parsed.autoFill,
        // v4 的 compat 形态与 v3 完全一致（同键同默认），直接沿用台阶解析结果
        compat: { ...parsed.compat },
        excludes: [...V4_EXCLUDES_DEFAULT],
    }
}

// ---------- 历史版本（v4）迁移源代码：v4 快照的冻结形态（见 types.ts 历史版本(v4) 段说明），不引用当前版本的可演进定义。 ----------

/** 历史版本(v4)：字段规则 schema（与当前 FieldRules 同形，独立声明以冻结形态），dflt 为省略字段的默认值 */
const v4FieldRules = (dflt: boolean): z<V4FieldRules> => z.object({
    reasoning: z.boolean().default(dflt),
    context: z.boolean().default(dflt),
    image: z.boolean().default(dflt),
})

/** 历史版本(v4)：兼容性规则 schema（与当前 CompatRules 同形，独立声明以冻结形态） */
const v4CompatRules: z<V4CompatRules> = z.object({
    disableDeveloper: z.boolean().default(true),
})

/** 历史版本(v4)：默认配置——解析失败兜底与 schema 整项缺省的唯一来源 */
const V4_BASE: Omit<V4PluginConfigSnapshot, 'configVersion'> = {
    allowUpdate: { reasoning: false, context: false, image: false },
    autoFill: { reasoning: true, context: true, image: true },
    compat: { disableDeveloper: true },
    excludes: [],
}

/** 历史版本(v4)：配置 schema（仅对象写法，configVersion 等多余键被 schema 忽略；默认取 V4_BASE 的展开副本） */
const V4ConfigSchema: z<Omit<V4PluginConfigSnapshot, 'configVersion'>> = z.object({
    allowUpdate: v4FieldRules(false).default({ ...V4_BASE.allowUpdate }),
    autoFill: v4FieldRules(true).default({ ...V4_BASE.autoFill }),
    compat: v4CompatRules.default({ ...V4_BASE.compat }),
    excludes: z.array(z.string()).default([...V4_BASE.excludes]),
})

/**
 * 每模型推理级别记忆与用户体验规则的台阶默认值：v4 无这两个键，升级到 v5 时落默认。
 * 写空字面量而不引用 config.ts 的 DEFAULT_CONFIG，理由同上（产物形态恒定）。
 */
const V5_EFFORTS_DEFAULT: Record<string, Record<string, string>> = {}
const V5_USER_EXPERIENCE_DEFAULT: UserExperienceRules = { rememberEfforts: true }

/** 升到 v5（当前版本）：低于 v5 的输入先由 upgradeTo4 逐级接力到 v4，再按 v4 冻结 schema 解析（非法整体回退 v4 默认），新增 efforts 对象并落默认 */
function upgradeTo5(config: unknown, fromVersion: number): PluginConfigSnapshot {
    const v4 = fromVersion < 4 ? upgradeTo4(config, fromVersion) : config
    let parsed: Omit<V4PluginConfigSnapshot, 'configVersion'>
    try {
        parsed = V4ConfigSchema((isPlainObject(v4) ? v4 : {}) as unknown as Omit<V4PluginConfigSnapshot, 'configVersion'>)
    } catch {
        parsed = V4_BASE
    }
    // 产物版本固定为 5（本函数形态恒定），故不引用 CONFIG_VERSION
    return {
        configVersion: 5,
        allowUpdate: parsed.allowUpdate,
        autoFill: parsed.autoFill,
        compat: { ...parsed.compat },
        excludes: [...parsed.excludes],
        efforts: { ...V5_EFFORTS_DEFAULT },
        userExperience: { ...V5_USER_EXPERIENCE_DEFAULT },
    }
}

/**
 * 配置版本迁移入口：只调用最新一级台阶，产物即当前 CONFIG_VERSION 的快照形态。
 * 新版本发布时：新增 `upgradeToN`（它负责把更低版本经 `upgradeToN-1` 接力上来），把本函数改指它，
 * 链上既有函数一律不改，并把上一级台阶的返回类型改指新冻结的 `V(N-1)PluginConfigSnapshot`。
 * 例如当前版本=6：
 *   upgradeConfig = (c, v) => upgradeTo6(c, v)
 *   upgradeTo6 = (c, v) => {
 *     const v5 = v < 5 ? upgradeTo5(c, v) : c
 *     // 在此升到 6 的字段并返回 v6 快照
 *   }
 */
export function upgradeConfig(config: unknown, fromVersion: number): PluginConfigSnapshot {
    return upgradeTo5(config, fromVersion)
}

/** 全新用户的规范默认快照（与升级链对空输入的结果一致，由 test 守护）；物化函数单一来源在 src/shared/parse.ts 的 `toStored` */
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

/**
 * 启动时配置迁移：
 * - 有当前版本快照 → 直接使用（快照本身非法则按当前生效值重写自愈），两阶段清理低版本旧快照：先清低于最低支持版本，再清低于当前版本且超出上限的 excess（高版本快照保留）
 * - 无当前版本 → 段内所有 ≥ 最低支持版本中取最高可解析快照：高版本降级解析（按当前 schema，多余键忽略、efforts 宽松保留）、
 *   低版本走升级链；均不可解析或段内无版本则视为全新用户，直接写入规范默认快照，确保后续读取必有当前版本
 */
export async function migrateConfig(ctx: Context): Promise<void> {
    // 可直接读到本命名空间：provider 在 become injectable 前已 publish(load())，且 installSection 的注册
    // effect 体同步执行；读不到即服务缺席/被禁用，无从迁移，按当前生效配置继续。
    const descriptor = ctx.settings.describe().find((d) => d.ns === PLUGIN_NS)
    if (!descriptor) return
    const section = isPlainObject(descriptor.user) ? descriptor.user as VersionedSection : undefined
    const versions = collectVersions(section)
    if (versions.includes(CONFIG_VERSION)) {
        const ops: SettingsPathOp[] = []
        // 当前版本快照非法（如用户手改坏）时自愈：不修就会长期停在「文件里是坏值、运行期按
        // 最高可解析版本或默认执行」的不一致状态（浏览器半同样显示默认），且每次启动都无从纠正。
        // 重写目标取当前生效值——段内有可用的其余版本快照（含更高版本）则沿用其语义，否则落默认。
        if (!parseSnapshot(section?.[versionKey(CONFIG_VERSION)])) {
            ops.push({ op: 'set', path: [versionKey(CONFIG_VERSION)], value: toStored(resolveConfig(section)) })
            ctx.logger.warn(`${PLUGIN_NAME}: ${versionKey(CONFIG_VERSION)} 快照非法，已按当前生效配置重写`)
        }
        ops.push(...pruneOps(versions))
        if (ops.length > 0) await queueTask(ctx, () => ctx.settings.mutate(PLUGIN_NS, ops, descriptor.revision))
        return
    }
    // 迁移源：versions 升序，从高到低取首个可解析快照——高版本降级解析、低版本走升级链，全不可解析则落默认
    const candidates = versions.filter((v) => v >= MIN_SUPPORTED_VERSION)
    let stored: PluginConfigSnapshot = DEFAULT_STORED
    let action = '写入默认配置'
    let resolved = false
    for (let i = candidates.length - 1; i >= 0; i--) {
        const v = candidates[i]
        const parsed = parseSnapshot(section?.[versionKey(v)])
        if (!parsed) continue
        stored = v > CONFIG_VERSION ? toStored(parsed) : upgradeConfig(section?.[versionKey(v)], v)
        action = v > CONFIG_VERSION ? `从段内 ${versionKey(v)} 快照降级解析` : `从段内 ${versionKey(v)} 快照升级`
        resolved = true
        break
    }
    if (!resolved && versions.some((v) => v > CONFIG_VERSION)) {
        ctx.logger.warn(`${PLUGIN_NAME}: 检测到更高版本的配置快照但解析失败，已写入默认配置`)
    }
    const ops: SettingsPathOp[] = [
        { op: 'set', path: [versionKey(CONFIG_VERSION)], value: stored },
        ...pruneOps(versions),
    ]
    await queueTask(ctx, () => ctx.settings.mutate(PLUGIN_NS, ops, descriptor.revision))
    ctx.logger.info(`${PLUGIN_NAME}: ${action}，已写入 ${versionKey(CONFIG_VERSION)} 快照`)
}

/**
 * 从当前版本快照算出去重写回 op：仅当 `excludes` 经 Set 收窄后**变短**（即存在重复项）才产出，
 * 保留首次出现；无重复返回 []（一个字节都不写，这是 onChange 自愈的终止条件，防反馈循环）。
 * 存储侧不做静默去重是 UI 录入端已拦截重复的前提下的兜底——重复只可能来自手改配置文件。
 */
export function dedupeExcludesOp(snapshot: unknown): SettingsPathOp[] {
    if (!isPlainObject(snapshot)) return []
    const excludes = snapshot.excludes
    if (!Array.isArray(excludes)) return []
    const seen = new Set(excludes)
    if (seen.size === excludes.length) return []
    return [{ op: 'set', path: [versionKey(CONFIG_VERSION), 'excludes'], value: [...seen] }]
}

/**
 * 自有配置的通用自愈入口（onChange 调用）：读 user 层当前版本快照，逐条套用自愈规则，
 * 有 op 才写入（各规则的零写入条件即反馈循环的终止条件）。当前唯一规则：excludes 去重（手改兜底）。
 */
export async function selfHealConfig(ctx: Context): Promise<void> {
    const descriptor = ctx.settings.describe().find((d) => d.ns === PLUGIN_NS)
    if (!descriptor) return
    const section = isPlainObject(descriptor.user) ? descriptor.user as VersionedSection : undefined
    const ops = dedupeExcludesOp(section?.[versionKey(CONFIG_VERSION)])
    if (ops.length === 0) return
    await queueTask(ctx, () => ctx.settings.mutate(PLUGIN_NS, ops, descriptor.revision))
    ctx.logger.warn(`${PLUGIN_NAME}: 检测到排除列表存在重复项，已保留首次出现去重`)
}
