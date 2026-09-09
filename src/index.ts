import type { Context } from '@deepseek-ai/cordis'
import { readCache, setCatalog } from './catalog'
import { PLUGIN_NS, API_NS, PLUGIN_NAME } from './constants'
import { DEFAULT_SECTION, SectionSchema, resolveConfig, setConfigSource } from './config'
import { migrateConfig, selfHealConfig } from './migrate'
import { refreshIfStale } from './refresh'
import { installRpc } from './rpc'
import { fix } from './fix'

export const name = PLUGIN_NAME
export const inject = ['settings', 'connection']

/** 吞掉 fix 写回失败的 rejection（失败日志已在 fix 内告警，避免未处理拒绝） */
const swallowFixError = (): void => {}

export function apply(ctx: Context) {
    // 插件级卸载标记：启动链与事件驱动的异步续体都据此中止，卸载后不触碰已销毁上下文
    let disposed = false
    // 注册自有配置命名空间：段为版本快照容器，setSource 解析出运行时配置，onChange 响应配置变更
    ctx.settings.installSection(ctx, PLUGIN_NS, SectionSchema, DEFAULT_SECTION, {
        setSource: (current) => { setConfigSource(() => resolveConfig(current())) },
        // 配置变化先自愈（手改文件的重复排除项，有重复才写、否则零写入）再重新填充；
        // 自愈写回会再触发一次 onChange，此时长度已相等、零写入而收敛。
        // attach 也会同步触发一次 onChange（目录未就绪，fix 空转无害）；启动的有效填充由 effort 负责
        onChange: () => {
            void selfHealConfig(ctx)
                .catch((error: unknown) => {
                    ctx.logger.warn(`${PLUGIN_NAME}: 排除列表自愈失败（不影响后续填充）：${error instanceof Error ? error.message : String(error)}`)
                })
                .then(() => fix(ctx))
                .catch(swallowFixError)
        },
    })
    // llm-pi-ai 模型配置变更后重新填充；距上次成功拉取超过保鲜窗口（如长期不重启）时
    // 拉取最新数据（结算后再填充一次）——事件驱动刷新，无常驻定时器
    ctx.on('settings/updated', (ns) => {
        if (ns !== API_NS) return
        fix(ctx)
            .finally(() => {
                if (disposed) return
                refreshIfStale(ctx, () => disposed)
            })
            .catch(swallowFixError)
    })
    // 浏览器半「强制更新」RPC channel（结果经 RpcResult 回传卡片）
    installRpc(ctx)
    // 首轮：配置迁移 → 缓存读取 → 填充 → 异步刷新，统一由 effect 管理
    // （命名空间注册与文档装载都在本插件可注入 settings 之前完成，故可直接迁移，无需等待就绪）
    // 卸载时置位，在途结果不触碰已卸载的上下文；迁移失败仅告警、按当前生效配置继续。
    // 刷新统一走 refreshIfStale（ts 初始 0 必过期 ⇒ 启动必拉取），与事件路径共用同一入口与守卫
    ctx.effect(() => {
        void migrateConfig(ctx)
            .catch((error) => {
                if (disposed) return
                ctx.logger.warn(`${PLUGIN_NAME}: 配置迁移失败，使用当前生效配置继续：${error instanceof Error ? error.message : String(error)}`)
            })
            .then(() => {
                // 卸载后不再发起无人消费的缓存文件读取
                if (disposed) return
                return readCache()
            })
            .then((cached) => {
                if (disposed) return
                if (cached) setCatalog(cached)
                // 先用缓存（若有）填充，让配置即刻生效；完成后再拉取最新数据，避免两次写入并发冲突。
                // 与事件路径同构：fix → refreshIfStale →（拉取结算后）fix
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
