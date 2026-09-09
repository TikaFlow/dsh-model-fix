/** src/client/model.ts 纯映射层用例：解码（只读 version-4，非法/缺失回默认）、组总控/单格语义、排除列表增删与命中判定、脏检测、快照规范化 */

import { check, stable } from './helper'
import { API_NS, CONFIG_VERSION as PLUGIN_CONFIG_VERSION, PLUGIN_NS } from '../src/constants'
import { DEFAULT_CONFIG } from '../src/config'
import {
    CONFIG_VERSION,
    DEFAULT_FLAGS,
    EXCLUDE_ID_PATTERN,
    MODEL_FIX_NS,
    PI_AI_NS,
    VERSION_KEY,
    addExclude,
    applyGroup,
    decodeSection,
    groupValue,
    isDirty,
    masterValue,
    providerIdsOf,
    removeExclude,
    resolveHits,
    snapshotFromFlags,
    toggleCell,
} from '../src/client/model'
import type { Flags } from '../src/client/model'

/** 三组全开的配置（总控与整组置位用例的基准，无排除项） */
const ALL_ON: Flags = {
    autoFill: { reasoning: true, context: true, image: true },
    allowUpdate: { reasoning: true, context: true, image: true },
    compat: { disableDeveloper: true },
    excludes: [],
}

/** 带两个排除项的配置（排除列表用例的基准，其中 acme-gateway 在 providerIds 里命中） */
const WITH_EXCLUDES: Flags = { ...ALL_ON, excludes: ['acme-gateway', 'lab-7'] }

/** 执行本文件的全部用例 */
export function run(): void {
    // ---------- decodeSection：v4 正常解析 ----------
    check(
        'decode 完整 v4 快照',
        stable(decodeSection({
            'version-4': { configVersion: 4, autoFill: { reasoning: false, context: true, image: false }, allowUpdate: { reasoning: true, context: false, image: false }, compat: { disableDeveloper: false }, excludes: ['acme-gateway'] },
        })) === stable({
            autoFill: { reasoning: false, context: true, image: false },
            allowUpdate: { reasoning: true, context: false, image: false },
            compat: { disableDeveloper: false },
            excludes: ['acme-gateway'],
        }),
    )
    // ---------- v4 缺 excludes 整项落默认（向后兼容语义） ----------
    check(
        'decode 缺 excludes 落空数组',
        stable(decodeSection({ 'version-4': { autoFill: { reasoning: false }, allowUpdate: { reasoning: true } } })) === stable({
            autoFill: { reasoning: false, context: true, image: true },
            allowUpdate: { reasoning: true, context: false, image: false },
            compat: { disableDeveloper: true },
            excludes: [],
        }),
    )
    // ---------- v4 缺 compat 整项落默认（v3 时代就有的兼容语义，升级后不变） ----------
    check(
        'decode 缺 compat 落默认 true',
        stable(decodeSection({ 'version-4': { excludes: ['acme-gateway'] } })) === stable({
            autoFill: { reasoning: true, context: true, image: true },
            allowUpdate: { reasoning: false, context: false, image: false },
            compat: { disableDeveloper: true },
            excludes: ['acme-gateway'],
        }),
    )
    // ---------- 组非对象 / 字段类型非法 => 整段快照非法，回退默认（镜像 Node 侧 schema 抛错语义） ----------
    check('decode compat 非对象回退默认', stable(decodeSection({ 'version-4': { compat: 'x' } })) === stable(DEFAULT_FLAGS))
    check('decode compat 字段非布尔回退默认', stable(decodeSection({ 'version-4': { compat: { disableDeveloper: 'yes' } } })) === stable(DEFAULT_FLAGS))
    check('decode excludes 非数组回退默认', stable(decodeSection({ 'version-4': { excludes: 'acme-gateway' } })) === stable(DEFAULT_FLAGS))
    check('decode excludes 元素非字符串回退默认', stable(decodeSection({ 'version-4': { excludes: ['ok', 42] } })) === stable(DEFAULT_FLAGS))
    check('decode excludes 空数组合法且区别于缺失', stable(decodeSection({ 'version-4': { excludes: [] } })) === stable(DEFAULT_FLAGS))
    check(
        'decode 字段非布尔非法回退默认',
        stable(decodeSection({
            'version-3': { configVersion: 3, autoFill: { reasoning: false, context: false }, allowUpdate: { reasoning: true, context: true } },
            'version-4': { autoFill: { reasoning: 'yes' } },
        })) === stable(DEFAULT_FLAGS),
    )
    // ---------- 只读 version-4：段内仅有低版本快照（迁移未完成/失败）不读取，回默认 ----------
    check(
        'decode 段内仅有 v3 回默认',
        stable(decodeSection({
            'version-3': { configVersion: 3, autoFill: { reasoning: true, context: false }, allowUpdate: { reasoning: false, context: true }, compat: { disableDeveloper: false } },
        })) === stable(DEFAULT_FLAGS),
    )
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
    check('decode 段为布尔回退默认', stable(decodeSection({ 'version-4': true })) === stable(DEFAULT_FLAGS))
    for (const junk of [undefined, null, 42, 'x', [], { foo: 1 }, { 'version-4': null }, { 'version-x': {} }]) {
        check(`decode 垃圾输入兜默认 ${stable(junk)}`, stable(decodeSection(junk)) === stable(DEFAULT_FLAGS), junk)
    }
    // ---------- snapshotFromFlags：规范形态（configVersion + 三组布尔 + 排除列表全显式，无多余键） ----------
    check(
        'snapshot 规范化为 v4 存储形态',
        stable(snapshotFromFlags(DEFAULT_FLAGS)) === stable({
            configVersion: 4,
            autoFill: { reasoning: true, context: true, image: true },
            allowUpdate: { reasoning: false, context: false, image: false },
            compat: { disableDeveloper: true },
            excludes: [],
        }),
        snapshotFromFlags(DEFAULT_FLAGS),
    )
    check('snapshot 键名为 version-4', VERSION_KEY === 'version-4', VERSION_KEY)
    // 序列化产物与自身解码必须互逆（保存后立即读回不得变化）
    check('snapshot -> decode 往返一致', stable(decodeSection({ [VERSION_KEY]: snapshotFromFlags(WITH_EXCLUDES) })) === stable(WITH_EXCLUDES), snapshotFromFlags(WITH_EXCLUDES))
    // ---------- 跨半字面量漂移守护（浏览器半禁值导入 Node 半，字面量须两侧同步） ----------
    check('MODEL_FIX_NS 与 PLUGIN_NS 一致', MODEL_FIX_NS === PLUGIN_NS, MODEL_FIX_NS)
    check('PI_AI_NS 与 API_NS 一致', PI_AI_NS === API_NS, PI_AI_NS)
    check('CONFIG_VERSION 与 constants 侧一致', CONFIG_VERSION === PLUGIN_CONFIG_VERSION, CONFIG_VERSION)
    check('DEFAULT_FLAGS 与 DEFAULT_CONFIG 一致', stable(DEFAULT_FLAGS) === stable(DEFAULT_CONFIG), { DEFAULT_FLAGS, DEFAULT_CONFIG })
    // ---------- 组总控显示：任一为开则开，全关才关 ----------
    check('master 全开为开', masterValue(ALL_ON, 'autoFill') === true)
    check('master 全关为关', masterValue(DEFAULT_FLAGS, 'allowUpdate') === false)
    check('master 混合列显示为开', masterValue(toggleCell(DEFAULT_FLAGS, 'autoFill', 'image'), 'autoFill') === true)
    // compat 组只有一行时总控与该行的显示值一致（新增兼容性键后仍按「任一为开」判定）
    check('master compat 行为开则为开', masterValue(ALL_ON, 'compat') === true)
    check('master compat 行为关则为关', masterValue(DEFAULT_FLAGS, 'compat') === true && masterValue({ ...ALL_ON, compat: { disableDeveloper: false } }, 'compat') === false)
    // ---------- 总控点击：整组同置取反值（只作用于布尔组，排除列表不得被牵连） ----------
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
            excludes: DEFAULT_FLAGS.excludes,
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
    // ---------- 排除项 id 合法性（与宿主 provider route id 同一规则） ----------
    for (const ok of ['acme-gateway', 'a', 'a1', 'openai-compatible', 'lab-7']) {
        check(`排除项 id 合法 ${ok}`, EXCLUDE_ID_PATTERN.test(ok) === true, ok)
    }
    for (const bad of ['Acme', 'acme_gateway', '-acme', 'acme-', 'acme--b', '1acme', '', 'acme gateway', 'acme/', 'acme-gateway ']) {
        check(`排除项 id 非法 ${JSON.stringify(bad)}`, EXCLUDE_ID_PATTERN.test(bad) === false, bad)
    }
    // ---------- providerIdsOf：与 Node 半 fix 同源的 user 层取键 ----------
    check('providerIdsOf 取 user.providers 键', stable(providerIdsOf({ providers: { 'acme-gateway': {}, 'lab-7': {} } })) === stable(['acme-gateway', 'lab-7']), providerIdsOf({ providers: { 'acme-gateway': {}, 'lab-7': {} } }))
    for (const junk of [undefined, null, 42, 'x', [], {}, { providers: 'x' }, { providers: [] }, { providers: null }]) {
        check(`providerIdsOf 垃圾输入返回空 ${stable(junk)}`, providerIdsOf(junk).length === 0, junk)
    }
    // ---------- 命中判定：只看交集，顺序沿用排除列表本身的顺序 ----------
    check('resolveHits 只收命中的排除项', stable([...resolveHits(WITH_EXCLUDES.excludes, ['acme-gateway', 'other'])]) === stable(['acme-gateway']))
    check('resolveHits 全不命中为空集', resolveHits(WITH_EXCLUDES.excludes, ['nothing']).size === 0)
    check('resolveHits 提供方多于排除项时不计入提供方', resolveHits(['a'], ['a', 'b', 'c']).size === 1)
    check('resolveHits 空排除列表恒空', resolveHits([], ['a']).size === 0)
    // ---------- 增删：只追加/原位删除，不改入参，重复与不存在均为幂等空操作 ----------
    const added = addExclude(DEFAULT_FLAGS, 'acme-gateway')
    check('addExclude 追加到末尾', stable(added.excludes) === stable(['acme-gateway']), added)
    check('addExclude 不改入参与其他组', DEFAULT_FLAGS.excludes.length === 0 && added.autoFill === DEFAULT_FLAGS.autoFill)
    check('addExclude 重复 id 返回同一对象', addExclude(added, 'acme-gateway') === added)
    const withTwo = addExclude(added, 'lab-7')
    check('removeExclude 仅删目标项', stable(removeExclude(withTwo, 'acme-gateway').excludes) === stable(['lab-7']), removeExclude(withTwo, 'acme-gateway'))
    check('removeExclude 不改入参', stable(withTwo.excludes) === stable(['acme-gateway', 'lab-7']))
    check('removeExclude 不存在的 id 返回同一对象', removeExclude(withTwo, 'ghost') === withTwo)
    // ---------- 脏检测 ----------
    check('isDirty 相同值不为脏', isDirty(DEFAULT_FLAGS, DEFAULT_FLAGS) === false)
    check('isDirty 单格不同即为脏', isDirty(toggleCell(DEFAULT_FLAGS, 'autoFill', 'image'), DEFAULT_FLAGS) === true)
    // compat 行的改动同样要标脏，否则「关闭即移除」的写回没有 UI 入口
    check('isDirty compat 不同即为脏', isDirty({ ...DEFAULT_FLAGS, compat: { disableDeveloper: false } }, DEFAULT_FLAGS) === true)
    check('isDirty compat 相同不为脏', isDirty({ ...DEFAULT_FLAGS, compat: { ...DEFAULT_FLAGS.compat } }, DEFAULT_FLAGS) === false)
    // 排除列表的增删都必须标脏（否则排除没有保存入口），内容相同则不脏
    check('isDirty 新增排除项为脏', isDirty(added, DEFAULT_FLAGS) === true)
    check('isDirty 删除排除项为脏', isDirty(DEFAULT_FLAGS, withTwo) === true)
    check('isDirty 排除列表等值不为脏', isDirty(withTwo, { ...withTwo, excludes: ['acme-gateway', 'lab-7'] }) === false)
    // 顺序敏感是有意取舍：草稿只由已存值经增删派生，故不存在"换顺序即脏"的误报路径
    check('isDirty 排除列表换序视为脏', isDirty({ ...withTwo, excludes: ['lab-7', 'acme-gateway'] }, withTwo) === true)
}
