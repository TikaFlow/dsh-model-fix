import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { readCache, setCatalog } from '@/catalog'
import { PLUGIN_NS, API_NS, PLUGIN_NAME } from '@/shared/constants'
import { resolveConfig, setConfigSource } from '@/config'
import { migrateConfig, selfHealConfig } from '@/migrate'
import { refreshIfStale } from '@/refresh'
import { installRpc } from '@/rpc'
import { fix } from '@/fix'
import { isIgnoreAll } from '@/guard'
import { captureBackup } from '@/restore'

export const name = PLUGIN_NAME
export const inject = ['settings', 'connection']

/**
 * 宿主 Config schema 面：宽松任意值（「比当前代码更新的版本快照」也能通过注册校验）+
 * 根 `.volatile()`（纯 schema 元数据）——后者使宿主把整段作为实时引用注入 apply 第二参（每次 `.get()` 取当前值）。
 */
export const Config = z.any().volatile()

/** 吞掉 fix 写回失败的 rejection（失败日志已在 fix 内告警，避免未处理拒绝） */
const swallowFixError = (): void => {}

/** 自有段变更：先自愈（排除列表去重，有重复才写，自愈写回再触发一轮零写入而收敛）再重新填充；
 * 插件写回（重置/恢复/强制更新）期间（守卫开启）整条链短路，防止把刚删的字段重新填回。 */
function refillAfterOwnChange(ctx: Context): void {
    if (isIgnoreAll()) return
    void selfHealConfig(ctx)
        .catch((error: unknown) => {
            ctx.logger.warn(`${PLUGIN_NAME}: 排除列表自愈失败（不影响后续填充）：${error instanceof Error ? error.message : String(error)}`)
        })
        .then(() => fix(ctx))
        .catch(swallowFixError)
}

/** llm-pi-ai 段变更：重新填充；距上次成功拉取超过保鲜窗口（如长期不重启）时再拉取（结算后再填充一次），无常驻定时器；守卫同上 */
function refillAfterApiChange(ctx: Context, disposed: () => boolean): void {
    if (isIgnoreAll()) return
    fix(ctx)
        .finally(() => {
            if (disposed()) return
            refreshIfStale(ctx, disposed)
        })
        .catch(swallowFixError)
}

/** 实时取当前段：根 volatile 下 config 为引用包装，.get() 每次返回最新解析值 */
function readVolatile(config: unknown): unknown {
    const value = config as { get?: () => unknown }
    return typeof value?.get === 'function' ? value.get() : config
}

/** 入口：单一编排体（备份 → 配置源与段变更接线 → RPC → 启动链） */
export function apply(ctx: Context, config?: unknown): void {
    // 插件级卸载标记：启动链与事件驱动的异步续体都据此中止，卸载后不触碰已销毁上下文
    let disposed = false
    // 备份仅此一次，且必须早于一切写回（接线即起异步 fix）——晚了备份的就是被填充过的内容；
    // 此刻注册与文档装载都先于 apply，describe() 已含 API_NS，必可读
    captureBackup(ctx)
    // 配置源取 apply 第二参的实时引用——.get() 必须在工厂内、不得在 apply 时刻取走，
    // 否则卡片保存后的新值读不进来；段变更走 settings/document-updated（0.1.7 唯一段级事件），按 ns 分流
    setConfigSource(() => resolveConfig(readVolatile(config)))
    ctx.on('settings/document-updated', (ns) => {
        if (ns === PLUGIN_NS) refillAfterOwnChange(ctx)
        else if (ns === API_NS) refillAfterApiChange(ctx, () => disposed)
    })
    // 浏览器半「强制更新 / 重置推理级别 / 恢复备份」RPC channel（结果经 ConnectionRpcResult 回传卡片）
    installRpc(ctx)
    // 首轮：迁移 → 缓存 → 填充 → 异步刷新（refreshIfStale 的 ts 初始 0 必过期 ⇒ 启动必拉取），
    // 与事件路径共用同一入口与守卫；卸载置位后在途结果不触碰已销毁上下文
    ctx.effect(() => {
        void migrateConfig(ctx, () => disposed)
            .catch((error) => {
                if (disposed) return
                ctx.logger.warn(`${PLUGIN_NAME}: 配置迁移失败，使用当前生效配置继续：${error instanceof Error ? error.message : String(error)}`)
            })
            .then(() => {
                // 卸载后不再读缓存
                if (disposed) return
                return readCache()
            })
            .then((cached) => {
                if (disposed) return
                if (cached) setCatalog(cached)
                // 先用缓存填充即刻生效，再异步刷新（与事件路径同构：fix → refreshIfStale → 拉取结算后再 fix）
                fix(ctx)
                    .finally(() => {
                        if (disposed) return
                        refreshIfStale(ctx, () => disposed)
                    })
                    .catch((error) => {
                        if (disposed) return
                        ctx.logger.warn(`${PLUGIN_NAME}: 填充失败：${error instanceof Error ? error.message : String(error)}`)
                    })
            })
        return () => {
            disposed = true
        }
    })
}
