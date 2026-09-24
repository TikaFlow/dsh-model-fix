import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'

/** 宿主 HMR 事务感知的通用执行原语：把 task 从宿主事务的 AsyncLocalStorage 上下文中摘出执行，
 * 无论从哪条链调用（事件响应、RPC、启动链）都不会因事务嵌套失败。
 */
export function queueTask<T>(ctx: Context, task: () => Promise<T>): Promise<T> {
    const als = (ctx.get('hmr') as { executing?: unknown } | undefined)?.executing
    return als instanceof AsyncLocalStorage ? als.exit(task) : task()
}
