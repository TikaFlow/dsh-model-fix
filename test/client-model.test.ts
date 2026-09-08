/** src/client/model.ts 纯映射层用例：解码（只读 version-3，非法/缺失回默认）、组总控/单格语义、脏检测、快照规范化 */

import { check, stable } from './helper'
import { CONFIG_VERSION as PLUGIN_CONFIG_VERSION, PLUGIN_NS } from '../src/constants'
import { DEFAULT_CONFIG } from '../src/config'
import {
    CONFIG_VERSION,
    DEFAULT_FLAGS,
    MODEL_FIX_NS,
    VERSION_KEY,
    applyGroup,
    decodeSection,
    groupValue,
    isDirty,
    masterValue,
    snapshotFromFlags,
    toggleCell,
} from '../src/client/model'
import type { Flags } from '../src/client/model'

/** 三组全开的配置（总控与整组置位用例的基准） */
const ALL_ON: Flags = {
    autoFill: { reasoning: true, context: true, image: true },
    allowUpdate: { reasoning: true, context: true, image: true },
    compat: { disableDeveloper: true },
}

/** 执行本文件的全部用例 */
export function run(): void {
    // ---------- decodeSection：v3 正常解析 ----------
    check(
        'decode 完整 v3 快照',
        stable(decodeSection({
            'version-3': { configVersion: 3, autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true, context: false, image: false }, compat: { disableDeveloper: false } },
        })) === stable({
            autoFill: { reasoning: false, context: true, image: false },
            allowUpdate: { reasoning: true, context: false, image: false },
            compat: { disableDeveloper: false },
        }),
    )
    // ---------- v3 缺 compat 整项落默认（向后兼容语义） ----------
    check(
        'decode 缺 compat 落默认 true',
        stable(decodeSection({ 'version-3': { autoFill: { reasoning: false }, allowUpdate: { reasoning: true } } })) === stable({
            autoFill: { reasoning: false, context: true, image: true },
            allowUpdate: { reasoning: true, context: false, image: false },
            compat: { disableDeveloper: true },
        }),
    )
    // ---------- compat 非对象 / 字段非布尔 => 整段非法，回退默认（镜像 schema 抛错语义） ----------
    check('decode compat 非对象回退默认', stable(decodeSection({ 'version-3': { compat: 'x' } })) === stable(DEFAULT_FLAGS))
    check('decode compat 字段非布尔回退默认', stable(decodeSection({ 'version-3': { compat: { disableDeveloper: 'yes' } } })) === stable(DEFAULT_FLAGS))
    // ---------- 字段类型非法 => 整段快照非法，回退默认（不读旧版本快照） ----------
    check(
        'decode 字段非布尔非法回退默认',
        stable(decodeSection({
            'version-2': { configVersion: 2, autoFill: { reasoning: false, context: false }, allowUpdate: { reasoning: true, context: true } },
            'version-3': { autoFill: { reasoning: 'yes' } },
        })) === stable(DEFAULT_FLAGS),
    )
    // ---------- 只读 version-3：段内仅有低版本快照（迁移未完成/失败）不读取，回默认 ----------
    check(
        'decode 段内仅有 v2 回默认',
        stable(decodeSection({
            'version-2': { configVersion: 2, autoFill: { reasoning: true, context: false }, allowUpdate: { reasoning: false, context: true } },
        })) === stable(DEFAULT_FLAGS),
    )
    // ---------- 更高版本快照不读取（由写入它的版本负责） ----------
    check(
        'decode 段内仅有更高版本回默认',
        stable(decodeSection({ 'version-9': { autoFill: { reasoning: true, context: true, image: true } } })) === stable(DEFAULT_FLAGS),
    )
    // ---------- 非对象段与垃圾输入一律兜默认，永不 undefined ----------
    check('decode 段为布尔回退默认', stable(decodeSection({ 'version-3': true })) === stable(DEFAULT_FLAGS))
    for (const junk of [undefined, null, 42, 'x', [], { foo: 1 }, { 'version-3': null }, { 'version-x': {} }]) {
        check(`decode 垃圾输入兜默认 ${stable(junk)}`, stable(decodeSection(junk)) === stable(DEFAULT_FLAGS), junk)
    }
    // ---------- snapshotFromFlags：规范形态（configVersion + 三组布尔显式 + 无多余键） ----------
    check(
        'snapshot 规范化为 v3 存储形态',
        stable(snapshotFromFlags(DEFAULT_FLAGS)) === stable({
            configVersion: 3,
            autoFill: { reasoning: true, context: true, image: true },
            allowUpdate: { reasoning: false, context: false, image: false },
            compat: { disableDeveloper: true },
        }),
        snapshotFromFlags(DEFAULT_FLAGS),
    )
    check('snapshot 键名为 version-3', VERSION_KEY === 'version-3', VERSION_KEY)
    // ---------- 跨半字面量漂移守护（浏览器半禁值导入 Node 半，字面量须两侧同步） ----------
    check('MODEL_FIX_NS 与 PLUGIN_NS 一致', MODEL_FIX_NS === PLUGIN_NS, MODEL_FIX_NS)
    check('CONFIG_VERSION 与 constants 侧一致', CONFIG_VERSION === PLUGIN_CONFIG_VERSION, CONFIG_VERSION)
    check('DEFAULT_FLAGS 与 DEFAULT_CONFIG 一致', stable(DEFAULT_FLAGS) === stable(DEFAULT_CONFIG), { DEFAULT_FLAGS, DEFAULT_CONFIG })
    // ---------- 组总控显示：任一为开则开，全关才关 ----------
    check('master 全开为开', masterValue(ALL_ON, 'autoFill') === true)
    check('master 全关为关', masterValue(DEFAULT_FLAGS, 'allowUpdate') === false)
    check('master 混合列显示为开', masterValue(toggleCell(DEFAULT_FLAGS, 'autoFill', 'image'), 'autoFill') === true)
    // compat 组只有一行时总控与该行的显示值一致（新增兼容性键后仍按「任一为开」判定）
    check('master compat 行为开则为开', masterValue(ALL_ON, 'compat') === true)
    check('master compat 行为关则为关', masterValue(DEFAULT_FLAGS, 'compat') === true && masterValue({ ...ALL_ON, compat: { disableDeveloper: false } }, 'compat') === false)
    // ---------- 总控点击：整组同置取反值 ----------
    check(
        'applyGroup 整列置反（开->全关）',
        stable(applyGroup(ALL_ON, 'allowUpdate', false)) === stable({ ...ALL_ON, allowUpdate: { reasoning: false, context: false, image: false } }),
        applyGroup(ALL_ON, 'allowUpdate', false),
    )
    check(
        'applyGroup 混合列点击->全开（仅本组）',
        stable(applyGroup(toggleCell(DEFAULT_FLAGS, 'autoFill', 'context'), 'autoFill', true)) === stable({
            autoFill: { reasoning: true, context: true, image: true },
            allowUpdate: DEFAULT_FLAGS.allowUpdate,
            compat: DEFAULT_FLAGS.compat,
        }),
    )
    check(
        'applyGroup compat 整组置关且不动其他组',
        stable(applyGroup(DEFAULT_FLAGS, 'compat', false)) === stable({ ...DEFAULT_FLAGS, compat: { disableDeveloper: false } }),
        applyGroup(DEFAULT_FLAGS, 'compat', false),
    )
    check('applyGroup 不改入参', DEFAULT_FLAGS.autoFill.reasoning === true && DEFAULT_FLAGS.compat.disableDeveloper === true)
    // ---------- 单格翻转不改其他格、不改入参 ----------
    const flipped = toggleCell(DEFAULT_FLAGS, 'allowUpdate', 'context')
    check('toggleCell 仅翻转目标格', flipped.allowUpdate.context === true && flipped.allowUpdate.reasoning === false && flipped.autoFill === DEFAULT_FLAGS.autoFill)
    check('toggleCell 不改入参', DEFAULT_FLAGS.allowUpdate.context === false)
    check('toggleCell compat 仅翻转该行', stable(toggleCell(DEFAULT_FLAGS, 'compat', 'disableDeveloper').compat) === stable({ disableDeveloper: false }))
    check('groupValue 按组取行值', groupValue(DEFAULT_FLAGS, 'compat', 'disableDeveloper') === true && groupValue(DEFAULT_FLAGS, 'allowUpdate', 'image') === false)
    // ---------- 脏检测 ----------
    check('isDirty 相同值不为脏', isDirty(DEFAULT_FLAGS, DEFAULT_FLAGS) === false)
    check('isDirty 单格不同即为脏', isDirty(toggleCell(DEFAULT_FLAGS, 'autoFill', 'image'), DEFAULT_FLAGS) === true)
    // compat 行的改动同样要标脏，否则「关闭即移除」的写回没有 UI 入口
    check('isDirty compat 不同即为脏', isDirty({ ...DEFAULT_FLAGS, compat: { disableDeveloper: false } }, DEFAULT_FLAGS) === true)
    check('isDirty compat 相同不为脏', isDirty({ ...DEFAULT_FLAGS, compat: { ...DEFAULT_FLAGS.compat } }, DEFAULT_FLAGS) === false)
}
