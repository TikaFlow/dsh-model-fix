// migrate.ts 纯函数测试：upgradeConfig 升级链 / DEFAULT_STORED / toStored / pruneOps 清理规则 / excludes 去重 op
import { DEFAULT_STORED, dedupeExcludesOp, pruneOps, toStored, upgradeConfig } from '../src/migrate'
import { parseEfforts, resolveConfig } from '../src/config'
import { check, stable } from './helper'

/** 执行本文件的全部用例 */
export function run(): void {
    // 台阶补的默认值：compat 组自 v3 起存在、excludes 自 v4 起存在、efforts 与 userExperience 自 v5 起存在
    const COMPAT = { disableDeveloper: true }
    const EXCLUDES: string[] = []
    const EFFORTS: Record<string, Record<string, string>> = {}
    const USER_EXPERIENCE = { rememberEfforts: true }

    // ---------- v1 → v5：先按 v1 冻结 schema 解析（补 image 默认），再经 v2 → v3 补 compat、v3 → v4 补 excludes、v4 → v5 补 efforts ----------
    check('v1 快照沿链升到 v5', stable(upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: false }, autoFill: { reasoning: false, context: true } }, 1)) === stable({
        configVersion: 5,
        allowUpdate: { reasoning: true, context: false, image: false },
        autoFill: { reasoning: false, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: false }, autoFill: { reasoning: false, context: true } }, 1))
    check('v1 快照省略 autoFill 整项落默认', stable(upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: true } }, 1)) === stable({
        configVersion: 5,
        allowUpdate: { reasoning: true, context: true, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: true } }, 1))
    check('v1 垃圾输入回 v1 默认再升满链', stable(upgradeConfig('garbage', 1)) === stable({
        configVersion: 5,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig('garbage', 1))

    // ---------- v2 → v5：六布尔原样沿用，补 compat（v2 无该对象）、excludes（v4 起）、efforts（v5 起） ----------
    const v2Stored = {
        configVersion: 2,
        allowUpdate: { reasoning: true, context: false, image: true },
        autoFill: { reasoning: false, context: true, image: false },
    }
    check('v2 快照升到 v5 并补 compat / excludes / efforts / userExperience 默认', stable(upgradeConfig(v2Stored, 2)) === stable({
        configVersion: 5,
        allowUpdate: v2Stored.allowUpdate,
        autoFill: v2Stored.autoFill,
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig(v2Stored, 2))
    check('v2 快照缺字段按整项默认补齐后升 v5', stable(upgradeConfig({ autoFill: { reasoning: true } }, 2)) === stable({
        configVersion: 5,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig({ autoFill: { reasoning: true } }, 2))

    // ---------- v3 → v5：三组布尔与 compat 原样沿用，补 excludes（v4 起）与 efforts / userExperience（v5 起） ----------
    const v3Stored = {
        configVersion: 3,
        allowUpdate: { reasoning: true, context: false, image: false },
        autoFill: { reasoning: false, context: true, image: true },
        compat: { disableDeveloper: false },
    }
    check('v3 快照升到 v5 且保留 compat 现值', stable(upgradeConfig(v3Stored, 3)) === stable({
        configVersion: 5,
        allowUpdate: v3Stored.allowUpdate,
        autoFill: v3Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig(v3Stored, 3))
    // v3 的 compat 段按 v3 冻结 schema 解析：缺键落 v3 默认，非布尔整段回 v3 默认（不牵连其他组）
    check('v3 输入 compat 非布尔回 v3 默认', stable(upgradeConfig({ autoFill: { reasoning: true }, compat: 'x' }, 3)) === stable({
        configVersion: 5,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig({ autoFill: { reasoning: true }, compat: 'x' }, 3))
    check('v3 垃圾输入回 v3 默认再补 excludes / efforts', stable(upgradeConfig('garbage', 3)) === stable({
        configVersion: 5,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig('garbage', 3))
    // 台阶产物形态恒定：即便未来默认演进，v5 台阶补的仍是空对象与默认开关
    check('升级产物不携带用户段之外的多余键', Object.keys(upgradeConfig(v3Stored, 3)).sort().join(',') === 'allowUpdate,autoFill,compat,configVersion,efforts,excludes,userExperience', upgradeConfig(v3Stored, 3))

    // ---------- v4 → v5：三组布尔 + compat + excludes 原样沿用，补 efforts 与 userExperience ----------
    const v4Stored = {
        configVersion: 4,
        allowUpdate: { reasoning: true, context: false, image: true },
        autoFill: { reasoning: false, context: true, image: false },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
    }
    check('v4 快照升到 v5 且保留全部字段', stable(upgradeConfig(v4Stored, 4)) === stable({
        configVersion: 5,
        allowUpdate: v4Stored.allowUpdate,
        autoFill: v4Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig(v4Stored, 4))
    check('v4 快照省略 efforts 落空对象、省略 userExperience 落默认开关', stable(upgradeConfig(v4Stored, 4)) === stable({
        configVersion: 5,
        allowUpdate: v4Stored.allowUpdate,
        autoFill: v4Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: {},
        userExperience: { rememberEfforts: true },
    }), upgradeConfig(v4Stored, 4))
    check('v4 垃圾输入回 v4 默认再补 efforts / userExperience', stable(upgradeConfig('garbage', 4)) === stable({
        configVersion: 5,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), upgradeConfig('garbage', 4))

    // ---------- 守卫：低于最低支持版本的输入由链上台阶拒绝 ----------
    let guarded = ''
    try {
        upgradeConfig({ autoFill: { reasoning: true } }, 0)
    } catch (error) {
        guarded = error instanceof Error ? error.message : String(error)
    }
    check('低于最低支持版本抛错', guarded.includes('低于最低支持版本'), guarded)

    // 默认快照与升级链的一致性（全新用户直写默认 vs 空配置走升级链，结果必须相同）
    check('DEFAULT_STORED 与升级链空输入一致', stable(DEFAULT_STORED) === stable(upgradeConfig({}, 1)), { DEFAULT_STORED, chain: upgradeConfig({}, 1) })

    // toStored：运行时配置 -> 当前版本快照（自愈重写与全新用户直写的唯一构造口）
    check('toStored 补 configVersion 且含三组布尔与排除列表与 efforts 与 userExperience', stable(toStored({
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: { 'z-ai': { 'glm-5.2': 'high' } },
        userExperience: { rememberEfforts: false },
    })) === stable({
        configVersion: 5,
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
        efforts: { 'z-ai': { 'glm-5.2': 'high' } },
        userExperience: { rememberEfforts: false },
    }), toStored({ autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true, context: false, image: true }, compat: { disableDeveloper: false }, excludes: ['acme-gateway'], efforts: { 'z-ai': { 'glm-5.2': 'high' } }, userExperience: { rememberEfforts: false } }))
    check('DEFAULT_STORED 即 toStored(默认配置)', stable(DEFAULT_STORED) === stable(toStored({
        autoFill: { reasoning: true, context: true, image: true },
        allowUpdate: { reasoning: false, context: false, image: false },
        compat: { disableDeveloper: true },
        excludes: [],
        efforts: {},
        userExperience: { rememberEfforts: true },
    })), DEFAULT_STORED)
    check('DEFAULT_STORED 的 configVersion 为当前版本', DEFAULT_STORED.configVersion === 5, DEFAULT_STORED)

    // 自愈重写（migrateConfig 中当前版本快照非法时的动作）：重写目标取「当前生效值」，故重写前后
    // 行为必须一致；有可用旧快照时沿用其语义，绝不把段内仍可用的快照静默抹成默认
    const brokenV5WithV4 = {
        'version-5': { autoFill: 'garbage' },
        'version-4': { configVersion: 4, autoFill: { reasoning: false, context: false, image: true }, allowUpdate: { reasoning: true, context: true, image: false }, compat: { disableDeveloper: false }, excludes: ['x'] },
    }
    const healed = { 'version-5': toStored(resolveConfig(brokenV5WithV4)) }
    check('自愈后生效配置不变', stable(resolveConfig(healed)) === stable(resolveConfig(brokenV5WithV4)), { healed, before: resolveConfig(brokenV5WithV4) })
    check('自愈沿用可用旧快照语义（未落默认）', stable(resolveConfig(healed)) === stable({
        autoFill: { reasoning: false, context: false, image: true },
        allowUpdate: { reasoning: true, context: true, image: false },
        compat: { disableDeveloper: false },
        excludes: ['x'],
        efforts: {},
        userExperience: { rememberEfforts: true },
    }), resolveConfig(healed))
    // 无任何可用快照时自愈为默认（回退语义：不静默保留坏值；更高版本垃圾快照同样不计）
    const allBroken = { 'version-5': 42, 'version-9': 42 }
    check('无任何可用快照时自愈为默认', stable(resolveConfig({ 'version-5': toStored(resolveConfig(allBroken)) })) === stable(resolveConfig(allBroken)), resolveConfig(allBroken))
    // v5 非法但段内有可用更高版本快照：自愈沿用高版本降级解析的当前生效值（而非落默认）
    const v9Valid = { 'version-5': 42, 'version-9': { autoFill: { reasoning: false, context: false, image: false } } }
    check('v5 非法时自愈用更高版本降级值', stable(resolveConfig({ 'version-5': toStored(resolveConfig(v9Valid)) })) === stable({
        autoFill: { reasoning: false, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: false },
        compat: COMPAT,
        excludes: EXCLUDES,
        efforts: EFFORTS,
        userExperience: USER_EXPERIENCE,
    }), resolveConfig({ 'version-5': toStored(resolveConfig(v9Valid)) }))

    // parseEfforts：宽松解析（结构不符回落 {}，不判整段快照非法）
    check('parseEfforts 正常嵌套', stable(parseEfforts({ 'z-ai': { 'glm-5.2': 'high' } })) === stable({ 'z-ai': { 'glm-5.2': 'high' } }))
    check('parseEfforts 非对象回落空', stable(parseEfforts('bad')) === stable({}) && stable(parseEfforts(null)) === stable({}) && stable(parseEfforts(undefined)) === stable({}))
    check('parseEfforts 内层非对象跳过', stable(parseEfforts({ a: 'bad' })) === stable({}))
    check('parseEfforts 非字符串级别跳过', stable(parseEfforts({ a: { m: 42 } })) === stable({}))
    check('parseEfforts 混合保留合法', stable(parseEfforts({ a: { m: 'high', bad: 42 } })) === stable({ a: { m: 'high' } }))

    // pruneOps：两阶段清理——先淘汰低于最低支持版本（Phase A），再淘汰低于当前版本且超出保留上限的 excess（Phase B）；
    // 等于/高于当前版本永不清理
    check('当前与高版本不参与清理', pruneOps([5, 6, 7, 8]).length === 0, pruneOps([5, 6, 7, 8]))
    check('olds 超限淘汰最低（<=当前版本共保留 2 个）', pruneOps([1, 2, 3]).length === 2 && stable(pruneOps([1, 2, 3])) === stable([{ op: 'unset', path: ['version-1'] }, { op: 'unset', path: ['version-2'] }]), pruneOps([1, 2, 3]))
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

    // dedupeExcludesOp：excludes 的手写重复自愈——只有经 Set 收窄后变短（有重复）才产出定向写回 op，
    // 保留首次出现；无重复/垃圾输入一律零 op（这是 onChange 自愈的终止条件，防反馈循环）
    check('dedupe 有重复才产出 op 且保留首次出现', stable(dedupeExcludesOp({ excludes: ['a', 'b', 'a'] })) === stable([
        { op: 'set', path: ['version-5', 'excludes'], value: ['a', 'b'] },
    ]), dedupeExcludesOp({ excludes: ['a', 'b', 'a'] }))
    check('dedupe 无重复返回空（收敛保证）', dedupeExcludesOp({ excludes: ['a', 'b'] }).length === 0)
    check('dedupe 空列表返回空', dedupeExcludesOp({ excludes: [] }).length === 0)
    check('dedupe 缺 excludes 返回空', dedupeExcludesOp({ autoFill: {} }).length === 0)
    check('dedupe 非数组返回空', dedupeExcludesOp({ excludes: 'a' }).length === 0)
    check('dedupe 非纯对象返回空', dedupeExcludesOp('garbage').length === 0 && dedupeExcludesOp(undefined).length === 0)
}