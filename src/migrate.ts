import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { MAX_OLD_SNAPSHOTS, MIN_SUPPORTED_VERSION } from '@/constants'
import { CONFIG_VERSION, PLUGIN_NAME, PLUGIN_NS } from '@/shared/constants'
import { resolveConfig } from '@/config'
import { queueTask } from '@/host'
import { DEFAULT_CONFIG, parseEfforts, parseSnapshot, parseVersion, toStored, versionKey } from '@/shared/parse'
import type { PluginConfigSnapshot, VersionedSection } from '@/shared/types'
import type { V3CompatRules, V3FieldRules, V3PluginConfigSnapshot, V4CompatRules, V4FieldRules, V4PluginConfigSnapshot, V5CompatRules, V5FieldRules, V5PluginConfigSnapshot, V5UserExperienceRules, V6CompatRules, V6FieldRules, V6PluginConfigSnapshot, V6UserExperienceRules } from '@/types'
import { isPlainObject } from '@/shared/types'

// ---------- 历史版本（v3）迁移源代码：版本快照体系内 v3 快照的冻结形态（见 types.ts 历史版本(v3) 段说明），不引用当前版本的可演进定义。 ----------

/** 历史版本(v3)：字段规则 schema（与当前 FieldRules 同形，独立声明以冻结形态），dflt 为省略字段的默认值 */
const v3FieldRules = (dflt: boolean): z<V3FieldRules> => z.object({
    reasoning: z.boolean().default(dflt),
    context: z.boolean().default(dflt),
    image: z.boolean().default(dflt),
})

/** 历史版本(v3)：兼容性规则 schema（与当前 CompatRules 同形，独立声明以冻结形态） */
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

/**
 * 排除列表的台阶默认值：升级到 v4 时落空列表。
 * 写字面量而不引用 `src/shared/parse.ts` 的 `DEFAULT_CONFIG.excludes`——后者随当前版本演进，台阶产物形态必须恒定。
 */
const V4_EXCLUDES_DEFAULT: readonly string[] = []

/** 升到 v4（最低一级）：输入按 v3 冻结 schema 解析（非法整体回退 v3 默认），新增 excludes 数组并落默认 */
function upgradeTo4(config: unknown, fromVersion: number): V4PluginConfigSnapshot {
    // 全链唯一的最低版本守卫：本函数是最低一级，其输入版本下限恰为 MIN_SUPPORTED_VERSION，
    // 调用方已按该下限筛过迁移源，故此判断实际不会触发，只用于挡住误用。
    if (fromVersion < MIN_SUPPORTED_VERSION) {
        throw new Error(`无法从 v${fromVersion} 升级：低于最低支持版本 v${MIN_SUPPORTED_VERSION}`)
    }
    let parsed: Omit<V3PluginConfigSnapshot, 'configVersion'>
    try {
        parsed = V3ConfigSchema((isPlainObject(config) ? config : {}) as unknown as Omit<V3PluginConfigSnapshot, 'configVersion'>)
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
 * 写字面量而不引用 `src/shared/parse.ts` 的 `DEFAULT_CONFIG`——后者随当前版本演进，台阶产物形态必须恒定。
 * userExperience 用冻结的 V5UserExperienceRules（只含 rememberEfforts，无 v6 的 defaultHigh）。
 */
const V5_EFFORTS_DEFAULT: Record<string, Record<string, string>> = {}
const V5_USER_EXPERIENCE_DEFAULT: V5UserExperienceRules = { rememberEfforts: true }

/** 升到 v5：低于 v5 的输入先由 upgradeTo4 逐级接力到 v4，再按 v4 冻结 schema 解析（非法整体回退 v4 默认），新增 efforts 对象与 userExperience 并落默认 */
export function upgradeTo5(config: unknown, fromVersion: number): V5PluginConfigSnapshot {
    const v4 = fromVersion < 4 ? upgradeTo4(config, fromVersion) : config
    let parsed: Omit<V4PluginConfigSnapshot, 'configVersion'>
    try {
        parsed = V4ConfigSchema((isPlainObject(v4) ? v4 : {}) as unknown as Omit<V4PluginConfigSnapshot, 'configVersion'>)
    } catch {
        parsed = V4_BASE
    }
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

// ---------- 历史版本（v5）迁移源代码：v5 快照的冻结形态（见 types.ts 历史版本(v5) 段说明），不引用当前版本的可演进定义。 ----------

/** 历史版本(v5)：字段规则 schema（与 v4 同形，独立声明以冻结形态），dflt 为省略字段的默认值 */
const v5FieldRules = (dflt: boolean): z<V5FieldRules> => z.object({
    reasoning: z.boolean().default(dflt),
    context: z.boolean().default(dflt),
    image: z.boolean().default(dflt),
})

/** 历史版本(v5)：兼容性规则 schema（与 v4 同形，独立声明以冻结形态） */
const v5CompatRules: z<V5CompatRules> = z.object({
    disableDeveloper: z.boolean().default(true),
})

/** 历史版本(v5)：用户体验规则 schema（冻结形态：只含 rememberEfforts，无 v6 的 defaultHigh） */
const v5UserExperienceRules: z<V5UserExperienceRules> = z.object({
    rememberEfforts: z.boolean().default(true),
})

/** 历史版本(v5)：默认配置——解析失败兜底与 schema 整项缺省的唯一来源 */
const V5_BASE: Omit<V5PluginConfigSnapshot, 'configVersion'> = {
    allowUpdate: { reasoning: false, context: false, image: false },
    autoFill: { reasoning: true, context: true, image: true },
    compat: { disableDeveloper: true },
    excludes: [],
    efforts: {},
    userExperience: { rememberEfforts: true },
}

/**
 * 历史版本(v5)：配置 schema（仅对象写法，configVersion 等多余键被 schema 忽略；默认取 V5_BASE 的展开副本）。
 * efforts 是宽松记忆字段，不进 schema（坏结构只该回落 {} 而非拖垮整段），由 upgradeTo6 经 parseEfforts 单独保留。
 */
const V5ConfigSchema: z<Omit<V5PluginConfigSnapshot, 'configVersion' | 'efforts'>> = z.object({
    allowUpdate: v5FieldRules(false).default({ ...V5_BASE.allowUpdate }),
    autoFill: v5FieldRules(true).default({ ...V5_BASE.autoFill }),
    compat: v5CompatRules.default({ ...V5_BASE.compat }),
    excludes: z.array(z.string()).default([...V5_BASE.excludes]),
    userExperience: v5UserExperienceRules.default({ ...V5_BASE.userExperience }),
})

/**
 * defaultHigh 的台阶默认值：v5 无该字段，升级到 v6 时落默认（true，即默认使用 high）。
 * 写字面量而不引用 `src/shared/parse.ts` 的 `DEFAULT_CONFIG.userExperience.defaultHigh`——后者随当前版本演进，台阶产物形态必须恒定；
 * 两者当前取值一致，`DEFAULT_STORED 与升级链空输入一致` 的不变量才成立（调整默认值时须同步本字面量）。
 */
const V6_DEFAULT_HIGH_DEFAULT = true

/** 升到 v6：低于 v6 的输入先由 upgradeTo5 逐级接力到 v5，再按 v5 冻结 schema 解析（非法整体回退 v5 默认），新增 userExperience.defaultHigh 并落默认；efforts 经 parseEfforts 宽松保留 */
export function upgradeTo6(config: unknown, fromVersion: number): V6PluginConfigSnapshot {
    const v5 = fromVersion < 5 ? upgradeTo5(config, fromVersion) : config
    let parsed: Omit<V5PluginConfigSnapshot, 'configVersion' | 'efforts'>
    try {
        parsed = V5ConfigSchema((isPlainObject(v5) ? v5 : {}) as unknown as Omit<V5PluginConfigSnapshot, 'configVersion' | 'efforts'>)
    } catch {
        parsed = V5_BASE
    }
    // efforts 宽松保留（结构不符回落 {}）：记忆坏值不判整段快照非法，避免连累配置自愈重写丢配置
    const efforts = parseEfforts(isPlainObject(v5) ? v5.efforts : undefined)
    return {
        configVersion: 6,
        allowUpdate: parsed.allowUpdate,
        autoFill: parsed.autoFill,
        compat: { ...parsed.compat },
        excludes: [...parsed.excludes],
        efforts,
        userExperience: { ...parsed.userExperience, defaultHigh: V6_DEFAULT_HIGH_DEFAULT },
    }
}

// ---------- 历史版本（v6）迁移源代码：v6 快照的冻结形态（见 types.ts 历史版本(v6) 段说明），不引用当前版本的可演进定义。 ----------

/** 历史版本(v6)：字段规则 schema（与 v5 同形，独立声明以冻结形态），dflt 为省略字段的默认值 */
const v6FieldRules = (dflt: boolean): z<V6FieldRules> => z.object({
    reasoning: z.boolean().default(dflt),
    context: z.boolean().default(dflt),
    image: z.boolean().default(dflt),
})

/** 历史版本(v6)：兼容性规则 schema（与 v5 同形，独立声明以冻结形态） */
const v6CompatRules: z<V6CompatRules> = z.object({
    disableDeveloper: z.boolean().default(true),
})

/** 历史版本(v6)：用户体验规则 schema（冻结形态：含 rememberEfforts 与 defaultHigh，无 v7 起的 forgetRemoved）；defaultHigh 省略时落 v6 默认值 true */
const v6UserExperienceRules: z<V6UserExperienceRules> = z.object({
    rememberEfforts: z.boolean().default(true),
    defaultHigh: z.boolean().default(true),
})

/** 历史版本(v6)：默认配置——解析失败兜底与 schema 整项缺省的唯一来源 */
const V6_BASE: Omit<V6PluginConfigSnapshot, 'configVersion'> = {
    allowUpdate: { reasoning: false, context: false, image: false },
    autoFill: { reasoning: true, context: true, image: true },
    compat: { disableDeveloper: true },
    excludes: [],
    efforts: {},
    userExperience: { rememberEfforts: true, defaultHigh: true },
}

/**
 * 历史版本(v6)：配置 schema（仅对象写法，configVersion 等多余键被 schema 忽略；默认取 V6_BASE 的展开副本）。
 * efforts 是宽松记忆字段，不进 schema（坏结构只该回落 {} 而非拖垮整段），由 upgradeTo7 经 parseEfforts 单独保留。
 */
const V6ConfigSchema: z<Omit<V6PluginConfigSnapshot, 'configVersion' | 'efforts'>> = z.object({
    allowUpdate: v6FieldRules(false).default({ ...V6_BASE.allowUpdate }),
    autoFill: v6FieldRules(true).default({ ...V6_BASE.autoFill }),
    compat: v6CompatRules.default({ ...V6_BASE.compat }),
    excludes: z.array(z.string()).default([...V6_BASE.excludes]),
    userExperience: v6UserExperienceRules.default({ ...V6_BASE.userExperience }),
})

/**
 * forgetRemoved 的台阶默认值：v6 无该字段，升级到 v7 时落默认（true，即维持「忘记已删除模型」的既有行为）。
 * 写字面量而不引用 `src/shared/parse.ts` 的 `DEFAULT_CONFIG.userExperience.forgetRemoved`——后者随当前版本演进，台阶产物形态必须恒定。
 */
const V7_FORGET_REMOVED_DEFAULT = true

/** 升到 v7（当前版本）：低于 v7 的输入先由 upgradeTo6 逐级接力到 v6，再按 v6 冻结 schema 解析（非法整体回退 v6 默认），新增 userExperience.forgetRemoved 并落默认；efforts 经 parseEfforts 宽松保留 */
function upgradeTo7(config: unknown, fromVersion: number): PluginConfigSnapshot {
    const v6 = fromVersion < 6 ? upgradeTo6(config, fromVersion) : config
    let parsed: Omit<V6PluginConfigSnapshot, 'configVersion' | 'efforts'>
    try {
        parsed = V6ConfigSchema((isPlainObject(v6) ? v6 : {}) as unknown as Omit<V6PluginConfigSnapshot, 'configVersion' | 'efforts'>)
    } catch {
        parsed = V6_BASE
    }
    // efforts 宽松保留（结构不符回落 {}）：记忆坏值不判整段快照非法，避免连累配置自愈重写丢配置
    const efforts = parseEfforts(isPlainObject(v6) ? v6.efforts : undefined)
    return {
        configVersion: 7,
        allowUpdate: parsed.allowUpdate,
        autoFill: parsed.autoFill,
        compat: { ...parsed.compat },
        excludes: [...parsed.excludes],
        efforts,
        userExperience: { ...parsed.userExperience, forgetRemoved: V7_FORGET_REMOVED_DEFAULT },
    }
}

/**
 * 配置版本迁移入口：只调用最新一级台阶，产物即当前 CONFIG_VERSION 的快照形态。
 * 新版本发布时只追加 `upgradeToN` 并把本函数改指它，既有台阶的逻辑一律不改（约定见 AGENTS.md）。
 */
export function upgradeConfig(config: unknown, fromVersion: number): PluginConfigSnapshot {
    return upgradeTo7(config, fromVersion)
}

/** 全新用户的规范默认快照（与升级链对空输入的结果一致，由 test 守护）；物化函数单一来源在 src/shared/parse.ts 的 `toStored` */
export const DEFAULT_STORED: PluginConfigSnapshot = toStored(DEFAULT_CONFIG)

/** 当前版本的快照键（`version-7`，N 取 `CONFIG_VERSION`），全文件的规范化/迁移/自愈写回共用 */
const CURRENT_KEY = versionKey(CONFIG_VERSION)

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
 * 当前版本快照的规范化 op：以「当前生效值」物化规范完整快照（`resolveConfig` → `toStored`），
 * 与盘上 v7 逐键比较；不一致才产出 set op，幂等——第二轮同值零写入即收敛。
 * 仅在 migrateConfig 的「当前版本已存在」分支调用（无 v7 时由迁移分支直接写规范快照）。
 *
 * 覆盖三类重写动因：
 * - 非法：`parseSnapshot(onDisk)` 判 undefined（如用户手改坏、或 v7 为非对象）——`resolveConfig` 回落到段内最高可解析快照或默认；
 * - 残缺：`parseSnapshot` 对缺失字段一律补默认，会把只有 `efforts` 的 `{efforts:{…}}` 判为合法完整配置，
 *   单纯「非法才自愈」不足以保证盘上是规范完整快照；此处按规范化结果比对，残缺即重写（保留 efforts/excludes 现值，补齐四组默认与 configVersion）；
 * - 多余键：v7 含当前 schema 未知的键时，`toStored` 物化只保留已知键，比对不一致即剥离重写。
 */
export function canonicalizeCurrentOp(section: VersionedSection | undefined): SettingsPathOp[] {
    if (!section) return []
    if (!(CURRENT_KEY in section)) return [] // v7 不存在 → 交给迁移分支，不在此产出
    const onDisk = section[CURRENT_KEY]
    const canonical = toStored(resolveConfig(section))
    return deepEqualJson(onDisk, canonical) ? [] : [{ op: 'set', path: [CURRENT_KEY], value: canonical }]
}

/**
 * 0.1.7 现代栈下本插件 Config schema 命名空间由宿主 Loader 异步登记，晚于 apply——启动时 describe() 可能尚未含本 NS。
 * 有界轮询等待其出现后再迁移（dsh-settings 无"命名空间注册"事件或 ready promise，settings/document-updated 只在 RAW 段变更时发、且 provider 首次 publish 早于本插件 apply 故监听器错过）。
 */
const MIGRATE_POLL_MS = 50
const MIGRATE_WAIT_MS = 2000
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 启动时配置迁移：
 * - 有当前版本快照 → 规范化校验：以当前生效值物化规范完整快照，与盘上 v7 逐键比较；不一致（非法 / 字段残缺 / 含多余键）即重写自愈
 *   （幂等——第二轮同值零写入即收敛），两阶段清理低版本旧快照：先清低于最低支持版本，再清低于当前版本且超出上限的 excess（高版本快照保留）
 * - 无当前版本 → 段内所有 ≥ 最低支持版本中取最高可解析快照：高版本降级解析（按当前 schema，多余键忽略、efforts 宽松保留）、
 *   低版本走升级链；均不可解析或段内无版本则视为全新用户，直接写入规范默认快照，确保后续读取必有当前版本
 */
export async function migrateConfig(ctx: Context, disposed: () => boolean = () => false): Promise<void> {
    // 轮询等待 describe() 含本 NS；超时/卸载即放弃，按当前生效配置继续
    let descriptor = ctx.settings.describe().find((d) => d.ns === PLUGIN_NS)
    let waited = 0
    while (!descriptor) {
        if (disposed()) return
        if (waited >= MIGRATE_WAIT_MS) {
            ctx.logger.warn(`${PLUGIN_NAME}: 等待 ${PLUGIN_NS} 命名空间注册超时（${MIGRATE_WAIT_MS}ms），跳过本次迁移/写回/清理`)
            return
        }
        await sleep(MIGRATE_POLL_MS)
        waited += MIGRATE_POLL_MS
        descriptor = ctx.settings.describe().find((d) => d.ns === PLUGIN_NS)
    }
    const section = isPlainObject(descriptor.user) ? descriptor.user as VersionedSection : undefined
    const versions = collectVersions(section)
    if (versions.includes(CONFIG_VERSION)) {
        const ops: SettingsPathOp[] = [...canonicalizeCurrentOp(section)]
        if (ops.length > 0) {
            // 区分两类重写动因，便于排查：非法（parseSnapshot 判 undefined，如用户手改坏）vs 非规范（合法但字段残缺或含多余键）
            const onDisk = section?.[CURRENT_KEY]
            ctx.logger.warn(!parseSnapshot(onDisk)
                ? `${PLUGIN_NAME}: ${CURRENT_KEY} 快照非法，已按当前生效配置重写`
                : `${PLUGIN_NAME}: ${CURRENT_KEY} 快照非规范（字段残缺或含多余键），已规范化重写`)
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
    for (const v of candidates.toReversed()) {
        const entry = section?.[versionKey(v)]
        const parsed = parseSnapshot(entry)
        if (!parsed) continue
        stored = v > CONFIG_VERSION ? toStored(parsed) : upgradeConfig(entry, v)
        action = v > CONFIG_VERSION ? `从段内 ${versionKey(v)} 快照降级解析` : `从段内 ${versionKey(v)} 快照升级`
        resolved = true
        break
    }
    if (!resolved && versions.some((v) => v > CONFIG_VERSION)) {
        ctx.logger.warn(`${PLUGIN_NAME}: 检测到更高版本的配置快照但解析失败，已写入默认配置`)
    }
    const ops: SettingsPathOp[] = [
        { op: 'set', path: [CURRENT_KEY], value: stored },
        ...pruneOps(versions),
    ]
    await queueTask(ctx, () => ctx.settings.mutate(PLUGIN_NS, ops, descriptor.revision))
    ctx.logger.info(`${PLUGIN_NAME}: ${action}，已写入 ${CURRENT_KEY} 快照`)
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
    return [{ op: 'set', path: [CURRENT_KEY, 'excludes'], value: [...seen] }]
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
