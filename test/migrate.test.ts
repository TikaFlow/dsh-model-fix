// migrate.ts 纯函数测试：upgradeConfig 升级链 / DEFAULT_STORED / toStored / pruneOps 清理规则 / canonicalizeCurrentOp 规范化 / excludes 去重 op
import { DEFAULT_STORED, canonicalizeCurrentOp, dedupeExcludesOp, pruneOps, upgradeConfig, upgradeTo5, upgradeTo6 } from '@/migrate'
import { resolveConfig } from '@/config'
import { parseEfforts, toStored, versionKey } from '@/shared/parse'
import { CONFIG_VERSION } from '@/shared/constants'
import { check, stable } from '@test/helper'

/** 执行本文件的全部用例 */
export function run(): void {
    // 台阶补的默认值（与当前版本默认同值：defaultHigh 与 forgetRemoved 的台阶默认值均为 true，故全新用户直写 DEFAULT_STORED 与走升级链结果一致）
    const COMPAT = { disableDeveloper: true }
    const EXCLUDES: string[] = []
    const EFFORTS: Record<string, Record<string, string>> = {}
    const USER_EXPERIENCE = { rememberEfforts: true, defaultHigh: true, forgetRemoved: true }

    // ---------- v3 → v7：三组布尔与 compat 原样沿用，补 excludes（v4 起）、efforts/userExperience（v5 起）、defaultHigh（v6 起）、forgetRemoved（v7 起） ----------
    const v3Stored = {
        configVersion: 3,
        allowUpdate: { reasoning: true, context: false, image: false },
        autoFill: { reasoning: false, context: true, image: true },
        compat: { disableDeveloper: false },
    }
    check('v3 快照升到 v7 且保留 compat 现值', stable(upgradeConfig(v3Stored, 3)) === stable({
        configVersion: 7,
        allowUpdate: v3Stored.allowUpdate,
        autoFill: v3Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig(v3Stored, 3))
    // v3 的 compat 段按 v3 冻结 schema 解析：缺键落 v3 默认，非布尔整段回 v3 默认（不牵连其他组）
    check('v3 输入 compat 非布尔回 v3 默认', stable(upgradeConfig({ autoFill: { reasoning: true }, compat: 'x' }, 3)) === stable({
        configVersion: 7,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig({ autoFill: { reasoning: true }, compat: 'x' }, 3))
    check('v3 垃圾输入回 v3 默认再补 excludes / efforts / userExperience', stable(upgradeConfig('garbage', 3)) === stable({
        configVersion: 7,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig('garbage', 3))
    // 台阶产物形态恒定：即便未来默认演进，v7 台阶补的仍是空对象与默认开关
    check('升级产物不携带用户段之外的多余键', Object.keys(upgradeConfig(v3Stored, 3)).sort().join(',') === 'allowUpdate,autoFill,compat,configVersion,efforts,excludes,userExperience', upgradeConfig(v3Stored, 3))

    // ---------- v4 → v7：三组布尔 + compat + excludes 原样沿用，补 efforts / userExperience（v5 起）、defaultHigh（v6 起）、forgetRemoved（v7 起） ----------
    const v4Stored = {
        configVersion: 4,
        allowUpdate: { reasoning: true, context: false, image: true },
        autoFill: { reasoning: false, context: true, image: false },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
    }
    check('v4 快照升到 v7 且保留全部字段', stable(upgradeConfig(v4Stored, 4)) === stable({
        configVersion: 7,
        allowUpdate: v4Stored.allowUpdate,
        autoFill: v4Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig(v4Stored, 4))
    check('v4 垃圾输入回 v4 默认再补 efforts / userExperience / defaultHigh / forgetRemoved', stable(upgradeConfig('garbage', 4)) === stable({
        configVersion: 7,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig('garbage', 4))

    // ---------- v5 → v7：原样沿用三组布尔 + compat + excludes + efforts + userExperience{rememberEfforts}，补 defaultHigh 与 forgetRemoved 默认 true ----------
    const v5Stored = {
        configVersion: 5,
        allowUpdate: { reasoning: true, context: false, image: true },
        autoFill: { reasoning: false, context: true, image: false },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: { 'z-ai': { 'glm-5.2': 'high' } },
        userExperience: { rememberEfforts: false },
    }
    check('v5 快照升到 v7 且保留 efforts 记忆与 userExperience 现值，补 defaultHigh / forgetRemoved 默认', stable(upgradeConfig(v5Stored, 5)) === stable({
        configVersion: 7,
        allowUpdate: v5Stored.allowUpdate,
        autoFill: v5Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: { 'z-ai': { 'glm-5.2': 'high' } },
        userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: true },
    }), upgradeConfig(v5Stored, 5))
    // v5 输入的 userExperience 经 v5 冻结 schema 解析：缺 rememberEfforts 落 v5 默认 true，非布尔回 v5 默认（不牵连其他组）
    check('v5 输入 userExperience 缺字段落 v5 默认', stable((upgradeConfig({ ...v5Stored, userExperience: {} }, 5) as { userExperience: { rememberEfforts: boolean; defaultHigh: boolean; forgetRemoved: boolean } }).userExperience) === stable({ rememberEfforts: true, defaultHigh: true, forgetRemoved: true }), upgradeConfig({ ...v5Stored, userExperience: {} }, 5))
    check('v5 输入 userExperience 非布尔回 v5 默认再补 defaultHigh / forgetRemoved', stable((upgradeConfig({ ...v5Stored, userExperience: { rememberEfforts: 'yes' } }, 5) as { userExperience: { rememberEfforts: boolean; defaultHigh: boolean; forgetRemoved: boolean } }).userExperience) === stable({ rememberEfforts: true, defaultHigh: true, forgetRemoved: true }), upgradeConfig({ ...v5Stored, userExperience: { rememberEfforts: 'yes' } }, 5))
    // v5 输入的 efforts 宽松保留：坏结构只回落 {}，不拖垮整段配置
    check('v5 输入 efforts 坏结构回落空但保留其余字段', stable(upgradeConfig({ ...v5Stored, efforts: 'bad' }, 5)) === stable({
        configVersion: 7,
        allowUpdate: v5Stored.allowUpdate,
        autoFill: v5Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: {},
        userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: true },
    }), upgradeConfig({ ...v5Stored, efforts: 'bad' }, 5))
    check('v5 垃圾输入回 v5 默认再补 defaultHigh / forgetRemoved', stable(upgradeConfig('garbage', 5)) === stable({
        configVersion: 7,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig('garbage', 5))
    // v5 台阶冻结形态：upgradeTo5 产物只含 rememberEfforts（无 defaultHigh），确认历史台阶不被当前演进污染
    check('v5 台阶产物 userExperience 不含 defaultHigh', stable(upgradeTo5('garbage', 5).userExperience) === stable({ rememberEfforts: true }), upgradeTo5('garbage', 5).userExperience)

    // ---------- v6 → v7：原样沿用全部 v6 字段与 efforts 记忆，userExperience 补 forgetRemoved 默认 true（维持「忘记已删除模型」的既有行为） ----------
    const v6Stored = {
        configVersion: 6,
        allowUpdate: { reasoning: true, context: false, image: true },
        autoFill: { reasoning: false, context: true, image: false },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: { 'z-ai': { 'glm-5.2': 'high' } },
        userExperience: { rememberEfforts: false, defaultHigh: true },
    }
    check('v6 快照升到 v7 且保留 efforts 记忆与 userExperience 现值，补 forgetRemoved 默认', stable(upgradeConfig(v6Stored, 6)) === stable({
        configVersion: 7,
        allowUpdate: v6Stored.allowUpdate,
        autoFill: v6Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: { 'z-ai': { 'glm-5.2': 'high' } },
        userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: true },
    }), upgradeConfig(v6Stored, 6))
    // v6 输入的 userExperience 经 v6 冻结 schema 解析：缺字段落 v6 默认，非布尔回 v6 默认（不牵连其他组）
    check('v6 输入 userExperience 缺字段落 v6 默认', stable((upgradeConfig({ ...v6Stored, userExperience: {} }, 6) as { userExperience: { rememberEfforts: boolean; defaultHigh: boolean; forgetRemoved: boolean } }).userExperience) === stable({ rememberEfforts: true, defaultHigh: true, forgetRemoved: true }), upgradeConfig({ ...v6Stored, userExperience: {} }, 6))
    check('v6 输入 userExperience defaultHigh 非布尔回 v6 默认再补 forgetRemoved', stable((upgradeConfig({ ...v6Stored, userExperience: { rememberEfforts: true, defaultHigh: 'yes' } }, 6) as { userExperience: { rememberEfforts: boolean; defaultHigh: boolean; forgetRemoved: boolean } }).userExperience) === stable({ rememberEfforts: true, defaultHigh: true, forgetRemoved: true }), upgradeConfig({ ...v6Stored, userExperience: { rememberEfforts: true, defaultHigh: 'yes' } }, 6))
    // v6 输入的 efforts 宽松保留：坏结构只回落 {}，不拖垮整段配置
    check('v6 输入 efforts 坏结构回落空但保留其余字段', stable(upgradeConfig({ ...v6Stored, efforts: 'bad' }, 6)) === stable({
        configVersion: 7,
        allowUpdate: v6Stored.allowUpdate,
        autoFill: v6Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: {},
        userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: true },
    }), upgradeConfig({ ...v6Stored, efforts: 'bad' }, 6))
    check('v6 垃圾输入回 v6 默认再补 forgetRemoved', stable(upgradeConfig('garbage', 6)) === stable({
        configVersion: 7,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig('garbage', 6))
    // v6 台阶冻结形态：upgradeTo6 产物只含 rememberEfforts 与 defaultHigh（无 forgetRemoved），确认历史台阶不被当前演进污染
    check('v6 台阶产物 userExperience 不含 forgetRemoved', stable(upgradeTo6('garbage', 6).userExperience) === stable({ rememberEfforts: true, defaultHigh: true }), upgradeTo6('garbage', 6).userExperience)

    // ---------- 守卫：低于最低支持版本（MIN_SUPPORTED_VERSION = 3）的输入由链上台阶拒绝 ----------
    let guarded = ''
    try {
        upgradeConfig({ autoFill: { reasoning: true } }, 2)
    } catch (error) {
        guarded = error instanceof Error ? error.message : String(error)
    }
    check('低于最低支持版本抛错', guarded.includes('低于最低支持版本'), guarded)

    // 默认快照与升级链的一致性（全新用户直写默认 vs 空配置走升级链，结果必须相同）
    check('DEFAULT_STORED 与升级链空输入一致', stable(DEFAULT_STORED) === stable(upgradeConfig({}, 3)), { DEFAULT_STORED, chain: upgradeConfig({}, 3) })

    // toStored：运行时配置 -> 当前版本快照（自愈重写与全新用户直写的唯一构造口）
    check('toStored 补 configVersion 且含三组布尔与排除列表与 efforts 与 userExperience（含 defaultHigh 与 forgetRemoved）', stable(toStored({
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: { 'z-ai': { 'glm-5.2': 'high' } },
        userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: false },
    })) === stable({
        configVersion: 7,
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: { 'z-ai': { 'glm-5.2': 'high' } },
        userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: false },
    }), toStored({ autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true, context: false, image: true }, compat: { disableDeveloper: false }, excludes: ['acme-gateway'], efforts: { 'z-ai': { 'glm-5.2': 'high' } }, userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: false } }))
    check('DEFAULT_STORED 即 toStored(默认配置)', stable(DEFAULT_STORED) === stable(toStored({
        autoFill: { reasoning: true, context: true, image: true },
        allowUpdate: { reasoning: false, context: false, image: false },
        compat: { disableDeveloper: true },
        excludes: [],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: true, forgetRemoved: true },
    })), DEFAULT_STORED)
    check('DEFAULT_STORED 的 configVersion 为当前版本', DEFAULT_STORED.configVersion === CONFIG_VERSION, DEFAULT_STORED)

    // 自愈重写（migrateConfig 中当前版本快照非法时的动作）：重写目标取「当前生效值」，故重写前后
    // 行为必须一致；有可用旧快照时沿用其语义，绝不把段内仍可用的快照静默抹成默认
    const brokenV7WithV5 = {
        'version-7': { autoFill: 'garbage' },
        'version-5': { configVersion: 5, autoFill: { reasoning: false, context: false, image: true }, allowUpdate: { reasoning: true, context: true, image: false }, compat: { disableDeveloper: false }, excludes: ['x'], efforts: { 'z-ai': { 'glm-5.2': 'high' } }, userExperience: { rememberEfforts: false } },
    }
    const healed = { 'version-7': toStored(resolveConfig(brokenV7WithV5)) }
    check('自愈后生效配置不变', stable(resolveConfig(healed)) === stable(resolveConfig(brokenV7WithV5)), { healed, before: resolveConfig(brokenV7WithV5) })
    check('自愈沿用可用旧快照语义（未落默认，保留 efforts 记忆与 userExperience 现值并补 defaultHigh / forgetRemoved）', stable(resolveConfig(healed)) === stable({
        autoFill: { reasoning: false, context: false, image: true },
        allowUpdate: { reasoning: true, context: true, image: false },
        compat: { disableDeveloper: false },
        excludes: ['x'],
        efforts: { 'z-ai': { 'glm-5.2': 'high' } },
        userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: true },
    }), resolveConfig(healed))
    // 无任何可用快照时自愈为默认（回退语义：不静默保留坏值；更高版本垃圾快照同样不计）
    const allBroken = { 'version-7': 42, 'version-9': 42 }
    check('无任何可用快照时自愈为默认', stable(resolveConfig({ 'version-7': toStored(resolveConfig(allBroken)) })) === stable(resolveConfig(allBroken)), resolveConfig(allBroken))
    // v7 非法但段内有可用更高版本快照：自愈沿用高版本降级解析的当前生效值（而非落默认）
    const v9Valid = { 'version-7': 42, 'version-9': { autoFill: { reasoning: false, context: false, image: false } } }
    check('v7 非法时自愈用更高版本降级值', stable(resolveConfig({ 'version-7': toStored(resolveConfig(v9Valid)) })) === stable({
        autoFill: { reasoning: false, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: false },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), resolveConfig({ 'version-7': toStored(resolveConfig(v9Valid)) }))

    // parseEfforts：宽松解析（结构不符回落 {}，不判整段快照非法）
    check('parseEfforts 正常嵌套', stable(parseEfforts({ 'z-ai': { 'glm-5.2': 'high' } })) === stable({ 'z-ai': { 'glm-5.2': 'high' } }))
    check('parseEfforts 非对象回落空', stable(parseEfforts('bad')) === stable({}) && stable(parseEfforts(null)) === stable({}) && stable(parseEfforts(undefined)) === stable({}))
    check('parseEfforts 内层非对象跳过', stable(parseEfforts({ a: 'bad' })) === stable({}))
    check('parseEfforts 非字符串级别跳过', stable(parseEfforts({ a: { m: 42 } })) === stable({}))
    check('parseEfforts 混合保留合法', stable(parseEfforts({ a: { m: 'high', bad: 42 } })) === stable({ a: { m: 'high' } }))

    // pruneOps：两阶段清理——先淘汰低于最低支持版本（Phase A），再淘汰低于当前版本且超出保留上限的 excess（Phase B）；
    // 等于/高于当前版本永不清理
    check('当前与高版本不参与清理', pruneOps([7, 8, 9, 10]).length === 0, pruneOps([7, 8, 9, 10]))
    check('低于最低支持版本的快照由 Phase A 清理', stable(pruneOps([1, 2, 3, 4, 5, 6])) === stable([
        { op: 'unset', path: ['version-1'] }, { op: 'unset', path: ['version-2'] }, { op: 'unset', path: ['version-3'] }, { op: 'unset', path: ['version-4'] }, { op: 'unset', path: ['version-5'] },
    ]), pruneOps([1, 2, 3, 4, 5, 6]))
    check('olds 超限淘汰最低（<=当前版本共保留 2 个）', stable(pruneOps([3, 4, 5, 6])) === stable([
        { op: 'unset', path: ['version-3'] }, { op: 'unset', path: ['version-4'] }, { op: 'unset', path: ['version-5'] },
    ]), pruneOps([3, 4, 5, 6]))
    check('olds 未超限不清理', pruneOps([3]).length === 0, pruneOps([3]))
    check('Phase A 清理低于最低支持版本', stable(pruneOps([1, 2, 3, 4], 6, 4, 3)) === stable([
        { op: 'unset', path: ['version-1'] }, { op: 'unset', path: ['version-2'] }, { op: 'unset', path: ['version-3'] },
    ]), pruneOps([1, 2, 3, 4], 6, 4, 3))
    check('Phase B 超限淘汰最低', stable(pruneOps([1, 2, 3, 4], 5, 0, 3)) === stable([
        { op: 'unset', path: ['version-1'] },
    ]), pruneOps([1, 2, 3, 4], 5, 0, 3))
    check('两阶段叠加（A 先于 B）', stable(pruneOps([1, 2, 3, 4, 5, 6], 8, 4, 3)) === stable([
        { op: 'unset', path: ['version-1'] }, { op: 'unset', path: ['version-2'] }, { op: 'unset', path: ['version-3'] },
    ]), pruneOps([1, 2, 3, 4, 5, 6], 8, 4, 3))

    // canonicalizeCurrentOp：当前版本快照规范化——以当前生效值物化规范完整快照（resolveConfig → toStored），与盘上 v7 不一致才产出 op
    const V7 = versionKey(CONFIG_VERSION)
    // 残缺 v7（只有 efforts）→ parseSnapshot 补默认判为合法，但与规范完整快照不一致 → 重写（补四组默认 + configVersion，保留 efforts 记忆）
    check('残缺 v7（只有 efforts）被规范化重写且保留记忆', stable(canonicalizeCurrentOp({ [V7]: { efforts: { 'z-ai': { 'glm-5.2': 'high' } } } })) === stable([{ op: 'set', path: [V7], value: { ...DEFAULT_STORED, efforts: { 'z-ai': { 'glm-5.2': 'high' } } } }]), canonicalizeCurrentOp({ [V7]: { efforts: { 'z-ai': { 'glm-5.2': 'high' } } } }))
    // 残缺 v7（只有 excludes）→ 同理重写，保留 excludes 现值
    check('残缺 v7（只有 excludes）被规范化重写且保留 excludes', stable(canonicalizeCurrentOp({ [V7]: { excludes: ['acme-gateway'] } })) === stable([{ op: 'set', path: [V7], value: { ...DEFAULT_STORED, excludes: ['acme-gateway'] } }]), canonicalizeCurrentOp({ [V7]: { excludes: ['acme-gateway'] } }))
    // 残缺 v7 同时保留 efforts 与 excludes，并补齐四组默认
    check('残缺 v7 同时保留 efforts 与 excludes 并补四组默认', stable(canonicalizeCurrentOp({ [V7]: { efforts: { 'z-ai': { 'glm-5.2': 'high' } }, excludes: ['acme-gateway'] } })) === stable([{ op: 'set', path: [V7], value: { ...DEFAULT_STORED, efforts: { 'z-ai': { 'glm-5.2': 'high' } }, excludes: ['acme-gateway'] } }]), canonicalizeCurrentOp({ [V7]: { efforts: { 'z-ai': { 'glm-5.2': 'high' } }, excludes: ['acme-gateway'] } }))
    // 非法 v7（非对象）→ resolveConfig 无其他可用快照时回落默认，重写为 DEFAULT_STORED
    check('非法 v7（非对象）按默认重写', stable(canonicalizeCurrentOp({ [V7]: 42 })) === stable([{ op: 'set', path: [V7], value: DEFAULT_STORED }]), canonicalizeCurrentOp({ [V7]: 42 }))
    // 非法 v7 但段内有可用更高版本 → 沿用高版本降级值重写（不落默认，保留语义）
    check('非法 v7 段内有高版本则沿用降级值重写', stable(canonicalizeCurrentOp({ [V7]: 42, 'version-9': { autoFill: { reasoning: false, context: false, image: false } } })) === stable([{ op: 'set', path: [V7], value: toStored(resolveConfig({ [V7]: 42, 'version-9': { autoFill: { reasoning: false, context: false, image: false } } })) }]), canonicalizeCurrentOp({ [V7]: 42, 'version-9': { autoFill: { reasoning: false, context: false, image: false } } }))
    // 规范完整 v7 → 零 op（幂等：重写后第二轮同值不产出）
    check('规范完整 v7 零 op', canonicalizeCurrentOp({ [V7]: DEFAULT_STORED }).length === 0, canonicalizeCurrentOp({ [V7]: DEFAULT_STORED }))
    // 规范完整但含多余键 → 物化时 toStored 剥离未知键，比对不一致即重写
    check('v7 含多余键被规范化剥离', stable(canonicalizeCurrentOp({ [V7]: { ...DEFAULT_STORED, extra: 'x', unknown: 1 } })) === stable([{ op: 'set', path: [V7], value: DEFAULT_STORED }]), canonicalizeCurrentOp({ [V7]: { ...DEFAULT_STORED, extra: 'x', unknown: 1 } }))
    // 用户改过四组布尔且完整 → 与规范物化结果一致（同值不同键序/引用），零 op（不误伤合法自定义配置）
    const customFull = { ...DEFAULT_STORED, autoFill: { reasoning: false, context: false, image: false }, allowUpdate: { reasoning: true, context: true, image: true }, compat: { disableDeveloper: false }, userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: false } }
    check('合法自定义完整 v7 零 op（不误伤）', canonicalizeCurrentOp({ [V7]: customFull }).length === 0, canonicalizeCurrentOp({ [V7]: customFull }))
    // v7 不存在 → 零 op（交给迁移分支）
    check('无 v7 零 op', canonicalizeCurrentOp({ 'version-5': { ...DEFAULT_STORED, configVersion: 5 } }).length === 0, canonicalizeCurrentOp({ 'version-5': { ...DEFAULT_STORED, configVersion: 5 } }))
    // 空段 / undefined → 零 op
    check('空段零 op', canonicalizeCurrentOp({}).length === 0 && canonicalizeCurrentOp(undefined).length === 0)

    // dedupeExcludesOp：excludes 的手写重复自愈——只有经 Set 收窄后变短（有重复）才产出定向写回 op，
    // 保留首次出现；无重复/垃圾输入一律零 op（这是 onChange 自愈的终止条件，防反馈循环）
    check('dedupe 有重复才产出 op 且保留首次出现', stable(dedupeExcludesOp({ excludes: ['a', 'b', 'a'] })) === stable([
        { op: 'set', path: [versionKey(CONFIG_VERSION), 'excludes'], value: ['a', 'b'] },
    ]), dedupeExcludesOp({ excludes: ['a', 'b', 'a'] }))
    check('dedupe 无重复返回空（收敛保证）', dedupeExcludesOp({ excludes: ['a', 'b'] }).length === 0)
    check('dedupe 空列表返回空', dedupeExcludesOp({ excludes: [] }).length === 0)
    check('dedupe 缺 excludes 返回空', dedupeExcludesOp({ autoFill: {} }).length === 0)
    check('dedupe 非数组返回空', dedupeExcludesOp({ excludes: 'a' }).length === 0)
    check('dedupe 含非字符串元素整段非法返回空（parseSnapshot 整段回退口径，不洗半合法段）', dedupeExcludesOp({ excludes: ['a', 1, 'a'] }).length === 0 && dedupeExcludesOp({ excludes: [null] }).length === 0)
    check('dedupe 非纯对象返回空', dedupeExcludesOp('garbage').length === 0 && dedupeExcludesOp(undefined).length === 0)
}
