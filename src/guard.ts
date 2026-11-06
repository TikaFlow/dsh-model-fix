import type { Context } from '@deepseek-ai/cordis'

/** cordis `FiberState.ACTIVE`：该枚举运行期无导出，故以数值锚定成员顺序 */
const ACTIVE_STATE = 2

/** fiber 是否尚未越过 ACTIVE（FAILED / DISPOSED / UNLOADING 视为不可用） */
export function isFiberAlive(ctx: Context): boolean {
    return ctx.fiber.state <= ACTIVE_STATE
}

/** 事件流守卫（计数式：可嵌套，解除只折抵一次；写回在途期间段变更事件链短路，理由见 docs/decisions-config.md「写回端点」） */
let depth = 0

export function startIgnoreAll(): void {
    depth += 1
}

export function endIgnoreAll(): void {
    depth -= 1
}

export function isIgnoreAll(): boolean {
    return depth > 0
}
