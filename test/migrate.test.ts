// migrate.ts 纯函数测试：upgradeConfig 升级链 / DEFAULT_STORED / toStored / pruneOps 清理规则 / excludes 去重 op
import { DEFAULT_STORED, dedupeExcludesOp, pruneOps, toStored, upgradeConfig } from '../src/migrate'
import { resolveConfig } from '../src/config'
import { check, stable } from './helper'

/** 执行本文件的全部用例 */
export function run(): void {
    // 台阶补的默认值：compat 组自 v3 起存在、excludes 自 v4 起存在
    const COMPAT = { disableDeveloper: true }
    const EXCLUDES: string[] = []

    // ---------- v1 → v4：先按 v1 冻结 schema 解析（补 image 默认），再经 v2 → v3 补 compat、v3 → v4 补 excludes ----------
    check('v1 快照沿链升到 v4', stable(upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: false }, autoFill: { reasoning: false, context: true } }, 1)) === stable({
        configVersion: 4,
        allowUpdate: { reasoning: true, context: false, image: false },
        autoFill: { reasoning: false, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
    }), upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: false }, autoFill: { reasoning: false, context: true } }, 1))
    check('v1 快照省略 autoFill 整项落默认', stable(upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: true } }, 1)) === stable({
        configVersion: 4,
        allowUpdate: { reasoning: true, context: true, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
    }), upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: true } }, 1))
    check('v1 垃圾输入回 v1 默认再升满链', stable(upgradeConfig('garbage', 1)) === stable({
        configVersion: 4,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
    }), upgradeConfig('garbage', 1))

    // ---------- v2 → v4：六布尔原样沿用，补 compat（v2 无该对象）与 excludes ----------
    const v2Stored = {
        configVersion: 2,
        allowUpdate: { reasoning: true, context: false, image: true },
        autoFill: { reasoning: false, context: true, image: false },
    }
    check('v2 快照升到 v4 并补 compat / excludes 默认', stable(upgradeConfig(v2Stored, 2)) === stable({
        configVersion: 4,
        allowUpdate: v2Stored.allowUpdate,
        autoFill: v2Stored.autoFill,
        compat: COMPAT,
        excludes: EXCLUDES,
    }), upgradeConfig(v2Stored, 2))
    check('v2 快照缺字段按整项默认补齐后升 v4', stable(upgradeConfig({ autoFill: { reasoning: true } }, 2)) === stable({
        configVersion: 4,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
    }), upgradeConfig({ autoFill: { reasoning: true } }, 2))

    // ---------- v3 → v4：三组布尔与 compat 原样沿用，只补 excludes（v3 无该数组） ----------
    const v3Stored = {
        configVersion: 3,
        allowUpdate: { reasoning: true, context: false, image: false },
        autoFill: { reasoning: false, context: true, image: true },
        compat: { disableDeveloper: false },
    }
    check('v3 快照升到 v4 且保留 compat 现值', stable(upgradeConfig(v3Stored, 3)) === stable({
        configVersion: 4,
        allowUpdate: v3Stored.allowUpdate,
        autoFill: v3Stored.autoFill,
        compat: { disableDeveloper: false },
        excludes: EXCLUDES,
    }), upgradeConfig(v3Stored, 3))
    // v3 的 compat 段按 v3 冻结 schema 解析：缺键落 v3 默认，非布尔整段回 v3 默认（不牵连其他组）
    check('v3 输入 compat 非布尔回 v3 默认', stable(upgradeConfig({ autoFill: { reasoning: true }, compat: 'x' }, 3)) === stable({
        configVersion: 4,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
    }), upgradeConfig({ autoFill: { reasoning: true }, compat: 'x' }, 3))
    check('v3 垃圾输入回 v3 默认再补 excludes', stable(upgradeConfig('garbage', 3)) === stable({
        configVersion: 4,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
        excludes: EXCLUDES,
    }), upgradeConfig('garbage', 3))
    // 台阶产物形态恒定：即便未来默认演进，v4 台阶补的仍是空列表
    check('升级产物不携带用户段之外的多余键', Object.keys(upgradeConfig(v3Stored, 3)).sort().join(',') === 'allowUpdate,autoFill,compat,configVersion,excludes', upgradeConfig(v3Stored, 3))

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
    check('toStored 补 configVersion 且含三组布尔与排除列表', stable(toStored({
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
    })) === stable({
        configVersion: 4,
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway'],
    }), toStored({ autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true, context: false, image: true }, compat: { disableDeveloper: false }, excludes: ['acme-gateway'] }))
    check('DEFAULT_STORED 即 toStored(默认配置)', stable(DEFAULT_STORED) === stable(toStored({
        autoFill: { reasoning: true, context: true, image: true },
        allowUpdate: { reasoning: false, context: false, image: false },
        compat: { disableDeveloper: true },
        excludes: [],
    })), DEFAULT_STORED)
    check('DEFAULT_STORED 的 configVersion 为当前版本', DEFAULT_STORED.configVersion === 4, DEFAULT_STORED)

    // 自愈重写（migrateConfig 中当前版本快照非法时的动作）：重写目标取「当前生效值」，故重写前后
    // 行为必须一致；有可用旧快照时沿用其语义，绝不把用户的次高版本静默抹成默认
    const brokenV4WithV3 = {
        'version-4': { autoFill: 'garbage' },
        'version-3': { configVersion: 3, autoFill: { reasoning: false, context: false, image: true }, allowUpdate: { reasoning: true, context: true, image: false }, compat: { disableDeveloper: false } },
    }
    const healed = { 'version-4': toStored(resolveConfig(brokenV4WithV3)) }
    check('自愈后生效配置不变', stable(resolveConfig(healed)) === stable(resolveConfig(brokenV4WithV3)), { healed, before: resolveConfig(brokenV4WithV3) })
    check('自愈沿用次高版本语义（未落默认）', stable(resolveConfig(healed)) === stable({
        autoFill: { reasoning: false, context: false, image: true },
        allowUpdate: { reasoning: true, context: true, image: false },
        compat: { disableDeveloper: false },
        excludes: [],
    }), resolveConfig(healed))
    // 自愈重写不得把用户已配的排除列表丢掉（次高版本快照带 excludes 的形态只有更高版本才写得出，
    // 故这里验证「当前版本快照非法 + 更高版本快照存在」时按语义回退为不豁免，而非静默保留坏值）
    const allBroken = { 'version-4': 42, 'version-9': { future: true } }
    check('无任何可用快照时自愈为默认', stable(resolveConfig({ 'version-4': toStored(resolveConfig(allBroken)) })) === stable(resolveConfig(allBroken)), resolveConfig(allBroken))

    // pruneOps：两阶段清理——先淘汰低于最低支持版本（Phase A），再淘汰低于当前版本且超出保留上限的 excess（Phase B）；
    // 等于/高于当前版本永不清理
    check('当前与高版本不参与清理', pruneOps([4, 5, 6, 7]).length === 0, pruneOps([4, 5, 6, 7]))
    check('v1/v2/v3 同时保留（olds 恰等于上限，一轮不清理）', pruneOps([1, 2, 3]).length === 0, pruneOps([1, 2, 3]))
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
        { op: 'set', path: ['version-4', 'excludes'], value: ['a', 'b'] },
    ]), dedupeExcludesOp({ excludes: ['a', 'b', 'a'] }))
    check('dedupe 无重复返回空（收敛保证）', dedupeExcludesOp({ excludes: ['a', 'b'] }).length === 0)
    check('dedupe 空列表返回空', dedupeExcludesOp({ excludes: [] }).length === 0)
    check('dedupe 缺 excludes 返回空', dedupeExcludesOp({ autoFill: {} }).length === 0)
    check('dedupe 非数组返回空', dedupeExcludesOp({ excludes: 'a' }).length === 0)
    check('dedupe 非纯对象返回空', dedupeExcludesOp('garbage').length === 0 && dedupeExcludesOp(undefined).length === 0)
}
