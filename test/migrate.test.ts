// migrate.ts 纯函数测试：upgradeConfig 升级链 / DEFAULT_STORED / toStored / pruneOps 清理规则
import { DEFAULT_STORED, pruneOps, toStored, upgradeConfig } from '../src/migrate'
import { resolveConfig } from '../src/config'
import { check, stable } from './helper'

/** v3 快照的 compat 段：所有台阶产物都补同一默认 */
const COMPAT = { disableDeveloper: true }

/** 执行本文件的全部用例 */
export function run(): void {
    // ---------- v1 → v3：先按 v1 冻结 schema 解析（补 image 默认），再由 v2 → v3 台阶补 compat ----------
    check('v1 快照沿链升到 v3', stable(upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: false }, autoFill: { reasoning: false, context: true } }, 1)) === stable({
        configVersion: 3,
        allowUpdate: { reasoning: true, context: false, image: false },
        autoFill: { reasoning: false, context: true, image: true },
        compat: COMPAT,
    }), upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: false }, autoFill: { reasoning: false, context: true } }, 1))
    check('v1 快照省略 autoFill 整项落默认', stable(upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: true } }, 1)) === stable({
        configVersion: 3,
        allowUpdate: { reasoning: true, context: true, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
    }), upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: true } }, 1))
    check('v1 垃圾输入回 v1 默认再升满链', stable(upgradeConfig('garbage', 1)) === stable({
        configVersion: 3,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
    }), upgradeConfig('garbage', 1))

    // ---------- v2 → v3：六布尔原样沿用，只补 compat 默认（v2 无该对象） ----------
    const v2Stored = {
        configVersion: 2,
        allowUpdate: { reasoning: true, context: false, image: true },
        autoFill: { reasoning: false, context: true, image: false },
    }
    check('v2 快照升到 v3 并补 compat 默认', stable(upgradeConfig(v2Stored, 2)) === stable({
        configVersion: 3,
        allowUpdate: v2Stored.allowUpdate,
        autoFill: v2Stored.autoFill,
        compat: COMPAT,
    }), upgradeConfig(v2Stored, 2))
    check('v2 快照缺字段按整项默认补齐后升 v3', stable(upgradeConfig({ autoFill: { reasoning: true } }, 2)) === stable({
        configVersion: 3,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
    }), upgradeConfig({ autoFill: { reasoning: true } }, 2))
    check('v2 垃圾输入回 v2 默认再补 compat', stable(upgradeConfig('garbage', 2)) === stable({
        configVersion: 3,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: COMPAT,
    }), upgradeConfig('garbage', 2))
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
    check('toStored 补 configVersion 且含三组', stable(toStored({
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: false },
    })) === stable({
        configVersion: 3,
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: false },
    }), toStored({ autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true, context: false, image: true }, compat: { disableDeveloper: false } }))
    check('DEFAULT_STORED 即 toStored(默认配置)', stable(DEFAULT_STORED) === stable(toStored({
        autoFill: { reasoning: true, context: true, image: true },
        allowUpdate: { reasoning: false, context: false, image: false },
        compat: { disableDeveloper: true },
    })), DEFAULT_STORED)

    // 自愈重写（migrateConfig 中当前版本快照非法时的动作）：重写目标取「当前生效值」，故重写前后
    // 行为必须一致；有可用旧快照时沿用其语义，绝不把用户的次高版本静默抹成默认
    const brokenV3WithV2 = {
        'version-3': { autoFill: 'garbage' },
        'version-2': { configVersion: 2, autoFill: { reasoning: false, context: false, image: true }, allowUpdate: { reasoning: true, context: true, image: false } },
    }
    const healed = { 'version-3': toStored(resolveConfig(brokenV3WithV2)) }
    check('自愈后生效配置不变', stable(resolveConfig(healed)) === stable(resolveConfig(brokenV3WithV2)), { healed, before: resolveConfig(brokenV3WithV2) })
    check('自愈沿用次高版本语义（未落默认）', stable(resolveConfig(healed)) === stable({
        autoFill: { reasoning: false, context: false, image: true },
        allowUpdate: { reasoning: true, context: true, image: false },
        compat: { disableDeveloper: true },
    }), resolveConfig(healed))
    const allBroken = { 'version-3': 42, 'version-9': { future: true } }
    check('无任何可用快照时自愈为默认', stable(resolveConfig({ 'version-3': toStored(resolveConfig(allBroken)) })) === stable(resolveConfig(allBroken)), resolveConfig(allBroken))

    // pruneOps：两阶段清理——先淘汰低于最低支持版本（Phase A），再淘汰低于当前版本且超出保留上限的 excess（Phase B）；
    // 等于/高于当前版本永不清理
    check('当前与高版本不参与清理', pruneOps([3, 5, 6, 7]).length === 0, pruneOps([3, 5, 6, 7]))
    check('低版本未超限不清理（v1/v2 同时保留）', pruneOps([1, 2]).length === 0, pruneOps([1, 2]))
    check('Phase A 清理低于最低支持版本', stable(pruneOps([1, 2, 3, 4], 5, 3, 3)) === stable([
        { op: 'unset', path: ['version-1'] }, { op: 'unset', path: ['version-2'] },
    ]), pruneOps([1, 2, 3, 4], 5, 3, 3))
    check('Phase B 超限淘汰最低', stable(pruneOps([1, 2, 3, 4], 5, 0, 3)) === stable([
        { op: 'unset', path: ['version-1'] },
    ]), pruneOps([1, 2, 3, 4], 5, 0, 3))
    check('两阶段叠加（A 先于 B）', stable(pruneOps([1, 2, 3, 4, 5, 6], 7, 3, 3)) === stable([
        { op: 'unset', path: ['version-1'] }, { op: 'unset', path: ['version-2'] }, { op: 'unset', path: ['version-3'] },
    ]), pruneOps([1, 2, 3, 4, 5, 6], 7, 3, 3))
}
