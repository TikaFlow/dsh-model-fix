/** src/client/model.ts 纯映射层用例：解码（只读 version-2，非法/缺失回默认）、总控/单格语义、脏检测、快照规范化 */

import { check, stable } from './helper'
import { CONFIG_VERSION as PLUGIN_CONFIG_VERSION, PLUGIN_NS } from '../src/constants'
import {
    CONFIG_VERSION,
    DEFAULT_FLAGS,
    MODEL_FIX_NS,
    VERSION_KEY,
    applyColumn,
    decodeSection,
    isDirty,
    masterValue,
    snapshotFromFlags,
    toggleCell,
} from '../src/client/model'
import type { Flags } from '../src/client/model'

const FLAGS_ALL_ON: Flags = {
    autoFill: { reasoning: true, context: true, image: true },
    allowUpdate: { reasoning: true, context: true, image: true },
}

/** 执行本文件的全部用例 */
export function run(): void {
    // ---------- decodeSection：v2 正常解析 ----------
    check(
        'decode 完整 v2 快照',
        stable(decodeSection({
            'version-2': { configVersion: 2, autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true, context: false, image: false } },
        })) === stable({ autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true, context: false, image: false } }),
        decodeSection({ 'version-2': { autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true } } }),
    )
    // ---------- v2 省略字段物化默认（autoFill 默认 true、allowUpdate 默认 false） ----------
    check(
        'decode v2 省略字段落默认',
        stable(decodeSection({ 'version-2': { autoFill: { reasoning: false } } })) === stable({
            autoFill: { reasoning: false, context: true, image: true },
            allowUpdate: { reasoning: false, context: false, image: false },
        }),
        decodeSection({ 'version-2': { autoFill: { reasoning: false } } }),
    )
    // ---------- v2 非对象视为非法，走回落 ----------
    check('decode v2 布尔形态非法回退默认', stable(decodeSection({ 'version-2': true })) === stable(DEFAULT_FLAGS))
    // ---------- v2 字段类型非法 => 整段快照非法，回退默认（不读旧版本快照） ----------
    check(
        'decode v2 字段非布尔非法回退默认',
        stable(decodeSection({
            'version-1': { configVersion: 1, autoFill: { reasoning: false, context: false }, allowUpdate: { reasoning: true, context: true } },
            'version-2': { autoFill: { reasoning: 'yes' } },
        })) === stable(DEFAULT_FLAGS),
        decodeSection({ 'version-1': { autoFill: { reasoning: false, context: false }, allowUpdate: { reasoning: true, context: true } }, 'version-2': { autoFill: { reasoning: 'yes' } } }),
    )
    // ---------- 只读 version-2：段内仅有低版本快照（迁移未完成/失败）不读取，回默认 ----------
    check(
        'decode 段内仅有 v1 回默认',
        stable(decodeSection({
            'version-1': { configVersion: 1, autoFill: { reasoning: true, context: false }, allowUpdate: { reasoning: false, context: true } },
        })) === stable(DEFAULT_FLAGS),
        decodeSection({ 'version-1': { autoFill: { reasoning: true, context: false }, allowUpdate: { reasoning: false, context: true } } }),
    )
    // ---------- 更高版本快照不读取（由写入它的版本负责） ----------
    check(
        'decode 段内仅有更高版本回默认',
        stable(decodeSection({ 'version-9': { autoFill: { reasoning: true, context: true, image: true } } })) === stable(DEFAULT_FLAGS),
        decodeSection({ 'version-9': { autoFill: { reasoning: true, context: true, image: true } } }),
    )
    // ---------- 垃圾输入一律兜默认，永不 undefined ----------
    for (const junk of [undefined, null, 42, 'x', [], { foo: 1 }, { 'version-2': null }, { 'version-x': {} }]) {
        check(`decode 垃圾输入兜默认 ${stable(junk)}`, stable(decodeSection(junk)) === stable(DEFAULT_FLAGS), junk)
    }
    // ---------- snapshotFromFlags：规范形态（configVersion + 六布尔显式 + 无多余键） ----------
    check(
        'snapshot 规范化为 v2 存储形态',
        stable(snapshotFromFlags(DEFAULT_FLAGS)) === stable({
            configVersion: 2,
            autoFill: { reasoning: true, context: true, image: true },
            allowUpdate: { reasoning: false, context: false, image: false },
        }),
        snapshotFromFlags(DEFAULT_FLAGS),
    )
    check('snapshot 键名为 version-2', VERSION_KEY === 'version-2', VERSION_KEY)
    // ---------- 跨半字面量漂移守护（浏览器半禁值导入 Node 半，字面量须两侧同步） ----------
    check('MODEL_FIX_NS 与 PLUGIN_NS 一致', MODEL_FIX_NS === PLUGIN_NS, MODEL_FIX_NS)
    check('CONFIG_VERSION 与 constants 侧一致', CONFIG_VERSION === PLUGIN_CONFIG_VERSION, CONFIG_VERSION)
    // ---------- 总控显示：任一为开则开，全关才关 ----------
    check('master 全开为开', masterValue(FLAGS_ALL_ON, 'autoFill') === true)
    check('master 全关为关', masterValue(DEFAULT_FLAGS, 'allowUpdate') === false)
    check(
        'master 混合列显示为开',
        masterValue(toggleCell(DEFAULT_FLAGS, 'autoFill', 'image'), 'autoFill') === true,
    )
    // ---------- 总控点击：整列同置取反值 ----------
    check(
        'applyColumn 全列置反（开->全关）',
        stable(applyColumn(FLAGS_ALL_ON, 'allowUpdate', false)) === stable({ ...FLAGS_ALL_ON, allowUpdate: { reasoning: false, context: false, image: false } }),
        applyColumn(FLAGS_ALL_ON, 'allowUpdate', false),
    )
    check(
        'applyColumn 混合列点击->全开（仅本列）',
        stable(applyColumn(toggleCell(DEFAULT_FLAGS, 'autoFill', 'context'), 'autoFill', true)) === stable({
            autoFill: { reasoning: true, context: true, image: true },
            allowUpdate: DEFAULT_FLAGS.allowUpdate,
        }),
    )
    // ---------- 单格翻转不改其他格、不改入参 ----------
    const base = DEFAULT_FLAGS
    const flipped = toggleCell(base, 'allowUpdate', 'context')
    check('toggleCell 仅翻转目标格', flipped.allowUpdate.context === true && flipped.allowUpdate.reasoning === false && flipped.autoFill === base.autoFill)
    check('toggleCell 不改入参', base.allowUpdate.context === false)
    // ---------- 脏检测 ----------
    check('isDirty 相同值不为脏', isDirty(DEFAULT_FLAGS, DEFAULT_FLAGS) === false)
    check(
        'isDirty 单格不同即为脏',
        isDirty(toggleCell(DEFAULT_FLAGS, 'autoFill', 'image'), DEFAULT_FLAGS) === true,
    )
}
