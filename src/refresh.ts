import type { Context } from '@deepseek-ai/cordis'
import { fetchLatest, setCatalog } from '@/catalog'
import { MAX_ATTEMPTS, REFRESH_INTERVAL_MS, RETRY_DELAY_MS } from '@/constants'
import { PLUGIN_NAME } from '@/shared/constants'
import { fix } from '@/fix'

// 拉取生命周期状态：时间戳只在成功时更新（失败路径不封保鲜窗口，下一次用户事件即可重试自愈）；
// 在途守卫防止连续事件叠加拉取——在途期间事件只填充，结算（成功/重试耗尽/卸载）后自然放行
let lastRefreshAt = 0
let refreshing = false

/** 距上次成功拉取超过保鲜窗口且无在途拉取时才真正拉取（长期不重启的保鲜路径，由模型配置变更事件驱动） */
export function refreshIfStale(ctx: Context, isDisposed: () => boolean): void {
    const isFresh = Date.now() - lastRefreshAt < REFRESH_INTERVAL_MS
    if (refreshing || isFresh) return
    refresh(ctx, isDisposed)
}

function refresh(ctx: Context, isDisposed: () => boolean, retryCount = MAX_ATTEMPTS): void {
    // 单飞不变量在此兜底：任何调用点进入时若已有拉取在途就直接返回，
    // 保证同一时刻只有一个 refresh 流程——否则并发在途的响应可能后发先至、把较旧的目录覆盖回去。
    // 依赖调用方先判 refreshing 是不够的（新增调用点极易漏判），此行不可删。
    if (refreshing) return
    refreshing = true
    fetchLatest(ctx)
        .then((indexed) => {
            if (isDisposed()) {
                refreshing = false
                return
            }
            // 时间戳仅在成功时落定：失败不封保鲜窗口（REFRESH_INTERVAL_MS），网络恢复后的下一次事件即可自愈
            lastRefreshAt = Date.now()
            setCatalog(indexed)
            fix(ctx).catch((error) => {
                if (isDisposed()) return
                ctx.logger.warn(`${PLUGIN_NAME}: 填充失败：${error instanceof Error ? error.message : String(error)}`)
            })
            refreshing = false
        })
        .catch((error) => {
            if (isDisposed()) {
                refreshing = false
                return
            }
            // 每次失败都记录，便于判断是一次成功还是重试后才成功
            const attempt = MAX_ATTEMPTS - retryCount + 1
            ctx.logger.warn(
                `${PLUGIN_NAME}: 拉取 models.dev 最新数据失败（第 ${attempt}/${MAX_ATTEMPTS} 次）：${error instanceof Error ? error.message : String(error)}`,
            )
            // 剩余重试次数不足则放弃，交由后续事件或重启再触发
            if (--retryCount <= 0) {
                refreshing = false
                return
            }
            setTimeout(() => {
                if (isDisposed()) {
                    refreshing = false
                    return
                }
                // 重试前复位在途守卫
                refreshing = false
                refresh(ctx, isDisposed, retryCount)
            }, RETRY_DELAY_MS)
        })
}
