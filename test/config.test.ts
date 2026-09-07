// config.ts 纯函数测试：resolveConfig / parseSnapshot / versionKey / parseVersion
import { parseSnapshot, resolveConfig, versionKey, parseVersion } from '../src/config'
import { check, stable } from './helper'

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
    })
    const v2Entry = {
        configVersion: 2,
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
    }
    check('取当前版本（v2）快照', stable(resolveConfig({ 'version-2': v2Entry })) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
    }), resolveConfig({ 'version-2': v2Entry }))
    check('布尔写法在 v2 快照中非法，回退默认', stable(resolveConfig({ 'version-2': { configVersion: 2, allowUpdate: true, autoFill: false } })) === DEFAULT_STABLE, resolveConfig({ 'version-2': { configVersion: 2, allowUpdate: true, autoFill: false } }))
    check('缺字段按整项默认补齐（含 image）', stable(resolveConfig({ 'version-2': { configVersion: 2, autoFill: { context: false } } })) === stable({
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: false, image: true },
    }), resolveConfig({ 'version-2': { configVersion: 2, autoFill: { context: false } } }))
    check('image 非法值整项回退默认', stable(resolveConfig({ 'version-2': { configVersion: 2, autoFill: { image: 'x' } } })) === DEFAULT_STABLE, resolveConfig({ 'version-2': { configVersion: 2, autoFill: { image: 'x' } } }))
    check('v1 旧快照缺 image 按默认补齐后生效', stable(resolveConfig({ 'version-1': { configVersion: 1, autoFill: { reasoning: false, context: false } } })) === stable({
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: false, context: false, image: true },
    }), resolveConfig({ 'version-1': { configVersion: 1, autoFill: { reasoning: false, context: false } } }))
    check('低于最低支持版本的快照（如残留 v0 键）被忽略回默认', stable(resolveConfig({ 'version-0': { allowUpdate: true } })) === DEFAULT_STABLE, resolveConfig({ 'version-0': { allowUpdate: true } }))
    check('仅更高版本回默认', stable(resolveConfig({ 'version-9': { whatever: true } })) === DEFAULT_STABLE, resolveConfig({ 'version-9': { whatever: true } }))
    check('非法快照回默认', stable(resolveConfig({ 'version-2': 'garbage' })) === DEFAULT_STABLE, resolveConfig({ 'version-2': 'garbage' }))
    check('段为数组/非对象回默认', stable(resolveConfig([])) === DEFAULT_STABLE, resolveConfig([]))

    // parseSnapshot：迁移侧据此判定当前版本快照是否仍可解析（决定要不要自愈重写）
    check('parseSnapshot 合法快照物化为六布尔', stable(parseSnapshot(v2Entry)) === stable({
        autoFill: { reasoning: true, context: false, image: false },
        allowUpdate: { reasoning: false, context: false, image: true },
    }), parseSnapshot(v2Entry))
    check('parseSnapshot 省略字段落该项默认', stable(parseSnapshot({ configVersion: 2, autoFill: { context: false } })) === stable({
        allowUpdate: { reasoning: false, context: false, image: false },
        autoFill: { reasoning: true, context: false, image: true },
    }), parseSnapshot({ configVersion: 2, autoFill: { context: false } }))
    check('parseSnapshot 拒绝垃圾/布尔写法/非对象', parseSnapshot('garbage') === undefined
        && parseSnapshot({ autoFill: true, allowUpdate: false }) === undefined
        && parseSnapshot(undefined) === undefined
        && parseSnapshot([]) === undefined)
    check('parseSnapshot 剥离 configVersion 等运行时不消费的键', Object.keys(parseSnapshot(v2Entry) ?? {}).sort().join(',') === 'allowUpdate,autoFill', parseSnapshot(v2Entry))
}
