import { AsyncLocalStorage } from 'node:async_hooks'

/** 宿主 HMR 事务感知的通用执行原语：把 task 从宿主事务的 AsyncLocalStorage 上下文中摘出执行，
 * 无论从哪条链调用（事件响应、RPC、启动链）都不会因事务嵌套失败。
 * hmr 服务经 `src/index.ts` 的子 fiber 注入；缺席时降级为裸 task()。
 */

let _hmrExecuting: unknown | undefined

/** 由 `src/index.ts` 的子 fiber 设置 hmr 执行上下文（缺席时为 undefined） */
export function setHmrExecuting(value: unknown | undefined): void {
    _hmrExecuting = value
}

export function queueTask<T>(task: () => Promise<T>): Promise<T> {
    const als = _hmrExecuting
    return als instanceof AsyncLocalStorage ? als.exit(task) : task()
}
