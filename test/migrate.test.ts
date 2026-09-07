// migrate.ts 纯函数测试：upgradeConfig 升级链 / DEFAULT_STORED / toStored / pruneOps 清理规则
import { DEFAULT_STORED, pruneOps, toStored, upgradeConfig } from '../src/migrate'
import { resolveConfig } from '../src/config'
import { check, stable } from './helper'

/** 执行本文件的全部用例 */
export function run(): void {
    // v1 -> v2：沿用原字段，补 image 默认（autoFill=true、allowUpdate=false）；configVersion 等多余键被忽略
    check('v1 快照升到 v2 并补 image 默认', stable(upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: false }, autoFill: { reasoning: false, context: true } }, 1)) === stable({
        configVersion: 2,
        allowUpdate: { reasoning: true, context: false, image: false },
        autoFill: { reasoning: false, context: true, image: true },
    }), upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: false }, autoFill: { reasoning: false, context: true } }, 1))
    check('v1 快照省略 autoFill 整项落默认', stable(upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: true } }, 1)) === stable({
        configVersion: 2,
        allowUpdate: { reasoning: true, context: true, image: false },
        autoFill: { reasoning: true, context: true, image: true },
    }), upgradeConfig({ configVersion: 1, allowUpdate: { reasoning: true, context: true } }, 1))
    check('v1 垃圾输入回 v1 默认再升 v2', stable(upgradeConfig('garbage', 1)) === stable({
        configVersion: 2,
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
    }), upgradeConfig('garbage', 1))

    // 默认快照与升级链的一致性（全新用户直写默认 vs 空配置走升级链，结果必须相同）
    check('DEFAULT_STORED 与升级链空输入一致', stable(DEFAULT_STORED) === stable(upgradeConfig({}, 1)), { DEFAULT_STORED, chain: upgradeConfig({}, 1) })

    // toStored：运行时配置 -> 当前版本快照（自愈重写与全新用户直写的唯一构造口）
    check('toStored 补 configVersion 且只含两组', stable(toStored({
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
    })) === stable({
        configVersion: 2,
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: true, context: false, image: true },
    }), toStored({ autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true, context: false, image: true } }))
    check('DEFAULT_STORED 即 toStored(默认配置)', stable(DEFAULT_STORED) === stable(toStored({
        autoFill: { reasoning: true, context: true, image: true },
        allowUpdate: { reasoning: false, context: false, image: false },
    })), DEFAULT_STORED)

    // 自愈重写（migrateConfig 中当前快照非法时的动作）：重写目标取「当前生效值」，故重写前后
    // 行为必须一致；有可用旧快照时沿用其语义，绝不把用户的次高版本静默抹成默认
    const brokenV2WithV1 = {
        'version-2': { autoFill: 'garbage' },
        'version-1': { configVersion: 1, autoFill: { reasoning: false, context: false }, allowUpdate: { reasoning: true, context: true } },
    }
    const healed = { 'version-2': toStored(resolveConfig(brokenV2WithV1)) }
    check('自愈后生效配置不变', stable(resolveConfig(healed)) === stable(resolveConfig(brokenV2WithV1)), { healed, before: resolveConfig(brokenV2WithV1) })
    check('自愈沿用次高版本语义（未落默认）', stable(resolveConfig(healed)) === stable({
        autoFill: { reasoning: false, context: false, image: true },
        allowUpdate: { reasoning: true, context: true, image: false },
    }), resolveConfig(healed))
    const allBroken = { 'version-2': 42, 'version-9': { future: true } }
    check('无任何可用快照时自愈为默认', stable(resolveConfig({ 'version-2': toStored(resolveConfig(allBroken)) })) === stable(resolveConfig(allBroken)), resolveConfig(allBroken))

    // pruneOps：两阶段清理——先淘汰低于最低支持版本（Phase A），再淘汰低于当前版本且超出保留上限的 excess（Phase B）；
    // 等于/高于当前版本永不清理
    check('当前与高版本不参与清理', pruneOps([2, 5, 6, 7]).length === 0, pruneOps([2, 5, 6, 7]))
    check('低版本未超限不清理', pruneOps([1]).length === 0, pruneOps([1]))
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
