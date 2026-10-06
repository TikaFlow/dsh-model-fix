/**
 * 空壳字段的统一清理：harness 语义下与「未声明」等价的取值，一律从模型条目里剔除。
 *
 * 为什么收口成一个函数而不是各写回路径各自判：同一个「空即未声明」的判据一旦散在 fill / prune /
 * reset / restore 四处，迟早分叉（本仓就分叉过：fill 只清 `input` 与 `compat`，prune 只清
 * `reasoningEfforts`），而空壳留着不是无害的——它会被后续判定当成「用户已声明」
 * （缺失补写因此不触发，写入判定反复触发），也会被恢复备份原样带回来。故凡重建模型条目的
 * 写回路径都过这道清理，判据只此一处。
 *
 * 判据表刻意只列下面三个键：**用户自定义字段一律原样保留**，不能对任意键套用「空即删」——
 * 「空即未声明」是逐键对 harness 语义核过的结论，不是通用规则。
 */
import { isPlainObject } from '@/shared/types'

/** 空对象判据（`input` 用空数组，故分开两个谓词） */
function isEmptyRecord(value: unknown): boolean {
    return isPlainObject(value) && Object.keys(value).length === 0
}

/**
 * 「空即等同未声明」的模型字段及其空形态：
 * - `reasoningEfforts`：空对象 = 未声明任何档位，故 fill 的缺失补写按缺失去认它（不被填只被清，
 *   要等下一轮才补上，等于凭空多一个来回）
 * - `input`：空数组 = 纯文本，等同未声明（未声明按纯文本处理）
 * - `compat`：空对象 = 未声明任何兼容开关
 */
const EMPTY_IS_ABSENT: readonly (readonly [string, (value: unknown) => boolean])[] = [
    ['reasoningEfforts', isEmptyRecord],
    ['input', (value) => Array.isArray(value) && value.length === 0],
    ['compat', isEmptyRecord],
]

/**
 * 剔除模型条目里的空壳字段，其余键原样返回。
 *
 * **无变化时原样返回入参**（不拷贝）：调用方以引用相等判「这一条无需重建」，
 * 与 fix 的零变更零 op 纪律一致，故不能无条件拷贝。
 */
export function stripEmptyFields(model: Record<string, unknown>): Record<string, unknown> {
    let next: Record<string, unknown> | undefined
    for (const [key, isEmpty] of EMPTY_IS_ABSENT) {
        if (!isEmpty(model[key])) continue
        next ??= { ...model }
        delete next[key]
    }
    return next ?? model
}
