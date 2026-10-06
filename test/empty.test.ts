// empty.ts 测试：空壳字段的统一清理判据
import { stripEmptyFields } from '@/empty'
import { check, stable } from '@test/helper'

/** 执行本文件的全部用例 */
export function run(): void {
    const model = {
        id: 'm',
        reasoningEfforts: {},
        input: [],
        compat: {},
        contextWindow: 1,
        extra: {},
    }
    const stripped = stripEmptyFields(model)
    check(
        '空壳字段一律剔除',
        stable(stripped) === stable({ id: 'm', contextWindow: 1, extra: {} }),
        stripped,
    )
    check('用户自定义的空字段保留', Object.hasOwn(stripped, 'extra'))
    check('入参不被就地修改', Object.hasOwn(model, 'input') && Object.hasOwn(model, 'compat'))

    // 无变化时返回原引用：调用方以引用相等判「这一条无需重建」，拷贝了就等于凭空多一次写入
    const intact = { id: 'm', reasoningEfforts: { off: true }, input: ['text'], compat: { a: 1 } }
    check('无空壳时原样返回入参（同一引用）', stripEmptyFields(intact) === intact)

    // 空形态只认各自的：一个非空数组不算空壳，非对象的 reasoningEfforts 一律不算（判据不含猜测）
    check(
        '非空与非对象形态不判为空壳',
        stable(stripEmptyFields({ reasoningEfforts: 'off', input: ['image'], compat: { a: 1 } }))
        === stable({ reasoningEfforts: 'off', input: ['image'], compat: { a: 1 } }),
    )
    check('数组形态的 reasoningEfforts 不判为空壳', stripEmptyFields({ reasoningEfforts: [] }).reasoningEfforts !== undefined)
}
