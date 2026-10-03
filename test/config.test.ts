// config.ts 纯函数测试：resolveConfig / parseSnapshot / versionKey / parseVersion
import { resolveConfig } from '@/config'
import { DEFAULT_CONFIG, parseSnapshot, parseVersion, versionKey } from '@/shared/parse'
import { check, stable } from '@test/helper'

/** 执行本文件的全部用例 */
export function run(): void {
    check('versionKey 拼接', versionKey(1) === 'version-1')
    check('parseVersion 合法', parseVersion('version-12') === 12 && parseVersion('version-0') === 0)
    check('parseVersion 非法返回 undefined', parseVersion('version-x') === undefined && parseVersion('allowUpdate') === undefined)
    // 非规范键必须拒绝：collectVersions/pruneOps 会用 versionKey() 重建键名，宽泛归一会导致读空、清理脱靶
    for (const bad of ['version-', 'version-01', 'version- 1', 'version-+1', 'version-1e3', 'version-1.0', 'version--1']) {
        check(`parseVersion 拒绝非规范键 ${bad}`, parseVersion(bad) === undefined, bad)
    }

    const DEFAULT_STABLE = stable({
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: { disableDeveloper: true },
        excludes: [],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    })
    // 当前版本（v7）快照：缺 efforts / userExperience 整项，经当前 schema 解析后落该项默认
    const v7Entry = {
        configVersion: 7,
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway', 'lab-7'],
    }
    check('取当前版本（v7）快照', stable(resolveConfig({ 'version-7': v7Entry })) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway', 'lab-7'],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-7': v7Entry }))
    // 兼容语义：v6 无 forgetRemoved，经当前 schema 解析后落该项默认（等价于「忘记已删除模型」，即维持既有行为）
    const v6Entry = {
        configVersion: 6,
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway', 'lab-7'],
        userExperience: { rememberEfforts: false, defaultHigh: true },
    }
    check('取低版本（v6）快照并补 forgetRemoved 默认', stable(resolveConfig({ 'version-6': v6Entry })) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway', 'lab-7'],
        efforts: {},
        userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: true },
    }), resolveConfig({ 'version-6': v6Entry }))
    // 兼容语义：v5 无 defaultHigh / forgetRemoved，经当前 schema 解析后落该项默认（等价于「不默认 high」）
    const v5Entry = {
        configVersion: 5,
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway', 'lab-7'],
    }
    check('取低版本（v5）快照并补 defaultHigh 默认', stable(resolveConfig({ 'version-5': v5Entry })) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway', 'lab-7'],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-5': v5Entry }))
    // 兼容语义：v4 无 efforts / userExperience，经当前 schema 解析后落该项默认
    check('取低版本（v4）快照并补 efforts / userExperience 默认', stable(resolveConfig({ 'version-4': v5Entry })) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway', 'lab-7'],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-4': v5Entry }))
    // 兼容语义：v3 无 excludes 数组，经当前 schema 解析后落该项默认（等价于「不排除任何提供方」）
    const v3Entry = {
        configVersion: 3,
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
    }
    check('取低版本（v3）快照并补 excludes / efforts / userExperience 默认', stable(resolveConfig({ 'version-3': v3Entry })) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: [],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-3': v3Entry }))
    // 兼容语义：v2 无 compat 对象，经当前 schema 解析后落该项默认（等价于「按旧版 API 处理」）
    const v2Entry = {
        configVersion: 2,
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
    }
    check('v2 快照（无 compat）解析后落 compat 默认 true', stable(resolveConfig({ 'version-2': v2Entry })) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: true },
        excludes: [],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-2': v2Entry }))
    check('布尔写法在 v4 快照中非法，回退默认', stable(resolveConfig({ 'version-4': { configVersion: 4, allowUpdate: true, autoFill: false } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, allowUpdate: true, autoFill: false } }))
    check('缺字段按整项默认补齐（含 image）', stable(resolveConfig({ 'version-4': { configVersion: 4, autoFill: { context: false } } })) === stable({
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: true },
        excludes: [],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-4': { configVersion: 4, autoFill: { context: false } } }))
    check('image 非法值整项回退默认', stable(resolveConfig({ 'version-4': { configVersion: 4, autoFill: { image: 'x' } } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, autoFill: { image: 'x' } } }))
    // compat 组与 fieldRules 同严格度：整项非对象、字段非布尔都判整段快照非法
    check('compat 非对象整段回退默认', stable(resolveConfig({ 'version-4': { configVersion: 4, compat: 'x' } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, compat: 'x' } }))
    check('compat 字段非布尔整段回退默认', stable(resolveConfig({ 'version-4': { configVersion: 4, compat: { disableDeveloper: 'yes' } } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, compat: { disableDeveloper: 'yes' } } }))
    // compat 省略 disableDeveloper 落该字段默认（true），而非判非法——与「新增键向后兼容」一致
    check('compat 缺字段落该字段默认', stable(resolveConfig({ 'version-4': { configVersion: 4, compat: {} } })) === stable({
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: true, image: true },
        compat: { disableDeveloper: true },
        excludes: [],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-4': { configVersion: 4, compat: {} } }))
    // excludes 与其余组同严格度：非数组、元素非字符串都判整段非法（宁可整段回默认，也不带着坏值继续写回）
    check('excludes 非数组整段回退默认', stable(resolveConfig({ 'version-4': { configVersion: 4, excludes: 'acme' } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, excludes: 'acme' } }))
    check('excludes 元素非字符串整段回退默认', stable(resolveConfig({ 'version-4': { configVersion: 4, excludes: ['ok', 42] } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, excludes: ['ok', 42] } }))
    check('excludes 空数组合法', stable(resolveConfig({ 'version-4': { configVersion: 4, excludes: [] } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, excludes: [] } }))
    // 唯一性由录入端保证（重复即提示并拒绝写入），故解析端只原样保留、不去重也不排序（顺序是用户意图）
    check('excludes 解析端原样保留（不去重、不排序）', stable((resolveConfig({ 'version-4': { configVersion: 4, excludes: ['b', 'a', 'b'] } }) as { excludes: string[] }).excludes) === stable(['b', 'a', 'b']), resolveConfig({ 'version-4': { configVersion: 4, excludes: ['b', 'a', 'b'] } }))
    // userExperience 与 compat 同严格度：整项非对象、字段非布尔判整段非法；省略字段落默认
    check('userExperience 非对象整段回退默认', stable(resolveConfig({ 'version-4': { configVersion: 4, userExperience: 'x' } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, userExperience: 'x' } }))
    check('userExperience 字段非布尔整段回退默认', stable(resolveConfig({ 'version-4': { configVersion: 4, userExperience: { rememberEfforts: 'yes' } } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, userExperience: { rememberEfforts: 'yes' } } }))
    check('userExperience defaultHigh 非布尔整段回退默认', stable(resolveConfig({ 'version-7': { configVersion: 7, userExperience: { defaultHigh: 'yes' } } })) === DEFAULT_STABLE, resolveConfig({ 'version-7': { configVersion: 7, userExperience: { defaultHigh: 'yes' } } }))
    check('userExperience forgetRemoved 非布尔整段回退默认', stable(resolveConfig({ 'version-7': { configVersion: 7, userExperience: { forgetRemoved: 'yes' } } })) === DEFAULT_STABLE, resolveConfig({ 'version-7': { configVersion: 7, userExperience: { forgetRemoved: 'yes' } } }))
    check('userExperience 缺字段落该字段默认', stable(resolveConfig({ 'version-4': { configVersion: 4, userExperience: {} } })) === DEFAULT_STABLE, resolveConfig({ 'version-4': { configVersion: 4, userExperience: {} } }))
    check('userExperience rememberEfforts false 原样生效', stable((resolveConfig({ 'version-4': { configVersion: 4, userExperience: { rememberEfforts: false } } }) as { userExperience: { rememberEfforts: boolean; defaultHigh: boolean; forgetRemoved: boolean } }).userExperience) === stable({ rememberEfforts: false, defaultHigh: false, forgetRemoved: true }))
    check('userExperience defaultHigh true 原样生效', stable((resolveConfig({ 'version-7': { configVersion: 7, userExperience: { defaultHigh: true } } }) as { userExperience: { rememberEfforts: boolean; defaultHigh: boolean; forgetRemoved: boolean } }).userExperience) === stable({ rememberEfforts: true, defaultHigh: true, forgetRemoved: true }))
    check('userExperience forgetRemoved false 原样生效', stable((resolveConfig({ 'version-7': { configVersion: 7, userExperience: { forgetRemoved: false } } }) as { userExperience: { rememberEfforts: boolean; defaultHigh: boolean; forgetRemoved: boolean } }).userExperience) === stable({ rememberEfforts: true, defaultHigh: false, forgetRemoved: false }))
    check('v1 旧快照缺 image 按默认补齐后生效', stable(resolveConfig({ 'version-1': { configVersion: 1, autoFill: { reasoning: false, context: false } } })) === stable({
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: true },
        excludes: [],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-1': { configVersion: 1, autoFill: { reasoning: false, context: false } } }))
    check('低于最低支持版本的快照被忽略回默认', stable(resolveConfig({ 'version-0': { allowUpdate: true } })) === DEFAULT_STABLE, resolveConfig({ 'version-0': { allowUpdate: true } }))
    // 降级兼容语义：无当前版本时，取段内最高版本快照按当前 schema 解析（多余键忽略、缺失字段落默认）
    check('仅更高版本降级解析保留配置', stable(resolveConfig({ 'version-9': { autoFill: { reasoning: false, context: true, image: false }, compat: { disableDeveloper: false }, excludes: ['x'] } })) === stable({
        autoFill: { reasoning: false, context: true, image: false },
        allowUpdate: { reasoning: false, context: false, image: false },
        compat: { disableDeveloper: false },
        excludes: ['x'],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-9': { autoFill: { reasoning: false, context: true, image: false }, compat: { disableDeveloper: false }, excludes: ['x'] } }))
    check('仅更高版本降级解析保留 efforts 记忆', stable(resolveConfig({ 'version-9': { efforts: { 'z-ai': { 'glm-5.2': 'high' } } } }).efforts) === stable({ 'z-ai': { 'glm-5.2': 'high' } }), resolveConfig({ 'version-9': { efforts: { 'z-ai': { 'glm-5.2': 'high' } } } }).efforts)
    check('仅更高版本降级解析保留 userExperience（含 defaultHigh 与 forgetRemoved）', stable((resolveConfig({ 'version-9': { userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: false } } }) as { userExperience: { rememberEfforts: boolean; defaultHigh: boolean; forgetRemoved: boolean } }).userExperience) === stable({ rememberEfforts: false, defaultHigh: true, forgetRemoved: false }), resolveConfig({ 'version-9': { userExperience: { rememberEfforts: false, defaultHigh: true, forgetRemoved: false } } }))
    check('仅更高版本且全缺省降级得默认', stable(resolveConfig({ 'version-9': { whatever: true } })) === DEFAULT_STABLE, resolveConfig({ 'version-9': { whatever: true } }))
    // 当前版本优先于更高版本：即使高版本先被遍历成为候选，命中当前版本即提前返回
    check('当前版本与更高版本并存仍取当前版本', stable(resolveConfig({ 'version-9': { autoFill: { reasoning: false, context: false, image: false } }, 'version-7': v7Entry })) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway', 'lab-7'],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), resolveConfig({ 'version-9': { autoFill: { reasoning: false, context: false, image: false } }, 'version-7': v7Entry }))
    check('非法快照回默认', stable(resolveConfig({ 'version-4': 'garbage' })) === DEFAULT_STABLE, resolveConfig({ 'version-4': 'garbage' }))
    check('段为数组/非对象回默认', stable(resolveConfig([])) === DEFAULT_STABLE, resolveConfig([]))

    // parseSnapshot：迁移侧据此判定当前版本快照是否仍可解析（决定要不要自愈重写）
    check('parseSnapshot 合法快照物化为三组布尔 + 排除列表 + 记忆 + 用户体验', stable(parseSnapshot(v7Entry)) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
        compat: { disableDeveloper: false },
        excludes: ['acme-gateway', 'lab-7'],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), parseSnapshot(v7Entry))
    check('parseSnapshot 省略字段落该项默认', stable(parseSnapshot({ configVersion: 4, autoFill: { context: false } })) === stable({
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: false, image: true },
        compat: { disableDeveloper: true },
        excludes: [],
        efforts: {},
        userExperience: { rememberEfforts: true, defaultHigh: false, forgetRemoved: true },
    }), parseSnapshot({ configVersion: 4, autoFill: { context: false } }))
    check('parseSnapshot 拒绝垃圾/布尔写法/非对象', parseSnapshot('garbage') === undefined
        && parseSnapshot({ autoFill: true, allowUpdate: false }) === undefined
        && parseSnapshot(undefined) === undefined
        && parseSnapshot([]) === undefined)
    check('parseSnapshot 剥离 configVersion 等运行时不消费的键', Object.keys(parseSnapshot(v7Entry) ?? {}).sort().join(',') === 'allowUpdate,autoFill,compat,efforts,excludes,userExperience', parseSnapshot(v7Entry))
    // 缺省 excludes 落的是新建数组：解析结果被调用方改动不得污染 DEFAULT_CONFIG
    const materialized = parseSnapshot({ configVersion: 4 })
    materialized?.excludes.push('mutated')
    check('parseSnapshot 缺省 excludes 不与默认常量共享引用', DEFAULT_CONFIG.excludes.length === 0, { DEFAULT_CONFIG, materialized })
}
