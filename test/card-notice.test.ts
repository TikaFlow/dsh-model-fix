// card-notice.ts 用例：目录新鲜度提示文案——有效时间戳返回「前缀 + 本地时间」，0 / 缺失 / 非法 / 失败一律 undefined（调用方不显示）
import { check } from '@test/helper'
import { catalogFreshnessText } from '@/client/card-notice'

export function run(): void {
    const zhPrefix = '缓存更新时间：'
    const enPrefix = 'Cache updated: '

    // ---------- 有效时间戳：前缀 + 本地时间（YYYY-MM-DD HH:mm） ----------
    const sample = new Date(2020, 0, 2, 3, 4).getTime()
    check('有效时间戳带中文前缀', catalogFreshnessText(sample, zhPrefix) === '缓存更新时间：2020-01-02 03:04', catalogFreshnessText(sample, zhPrefix))
    const padded = new Date(2020, 10, 9, 8, 7).getTime()
    check('有效时间戳带英文前缀且月 / 日 / 时 / 分补零', catalogFreshnessText(padded, enPrefix) === 'Cache updated: 2020-11-09 08:07', catalogFreshnessText(padded, enPrefix))

    // ---------- 无效值：0（缺省哨兵）、缺失、非数字、非有限数、负数一律 undefined ----------
    for (const invalid of [0, -1, -1_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, undefined, null, '0', '', true, {}, []]) {
        check(`无效时间戳不显示 ${String(invalid)}`, catalogFreshnessText(invalid, zhPrefix) === undefined, catalogFreshnessText(invalid, zhPrefix))
    }
    // 超出 Date 可表示范围的有限数同样无效
    check('超出 Date 范围不显示', catalogFreshnessText(Number.MAX_SAFE_INTEGER, zhPrefix) === undefined, catalogFreshnessText(Number.MAX_SAFE_INTEGER, zhPrefix))
}
