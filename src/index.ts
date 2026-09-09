import type { Context } from '@deepseek-ai/cordis'
import { readCache, setCatalog } from './catalog'
import { PLUGIN_NS, API_NS, PLUGIN_NAME } from './constants'
import { DEFAULT_SECTION, SectionSchema, resolveConfig, setConfigSource } from './config'
import { migrateConfig, selfHealConfig } from './migrate'
import { refresh } from './refresh'
import { installRpc } from './rpc'
import { fix } from './fix'

export const name = PLUGIN_NAME
export const inject = ['settings', 'connection']

/** 吞掉 fix 写回失败的 rejection（失败日志已在 fix 内告警，避免未处理拒绝） */
const swallowFixError = (): void => {}

export function apply(ctx: Context) {
    // 注册自有配置命名空间：段为版本快照容器，setSource 解析出运行时配置，onChange 响应配置变更
    ctx.settings.installSection(ctx, PLUGIN_NS, SectionSchema, DEFAULT_SECTION, {
        setSource: (current) => { setConfigSource(() => resolveConfig(current())) },
        // 插件配置变化时先自愈（手改文件里的重复排除项，有重复才写，否则零写入）再重新填充；
        // 自愈写回会再次触发 onChange，此时长度已相等、不再写入，链条在此收敛。
        // attach 时宿主也会同步触发一次 onChange（此时目录未就绪，fix 自然空转，幂等无害）；
        // 启动路径的有效填充由下方 effort 在缓存就绪后负责，二者职责不同，不可互替
        onChange: () => {
            void selfHealConfig(ctx)
                .catch((error: unknown) => {
                    ctx.logger.warn(`${PLUGIN_NAME}: 排除列表自愈失败（不影响后续填充）：${error instanceof Error ? error.message : String(error)}`)
                })
                .then(() => fix(ctx))
                .catch(swallowFixError)
        },
    })
    // llm-pi-ai 模型配置变更后重新填充
    ctx.on('settings/updated', (ns) => {
        if (ns !== API_NS) return
        fix(ctx).catch(swallowFixError)
    })
    // 浏览器半「强制更新」RPC channel（结果经 RpcResult 回传卡片）
    installRpc(ctx)
    // 首轮：配置迁移 → 缓存读取 → 填充 → 异步刷新，统一由 effect 管理
    // （命名空间注册与文档装载都在本插件可注入 settings 之前完成，故可直接迁移，无需等待就绪）
    // 卸载时置位，在途结果不触碰已卸载的上下文；迁移失败仅告警、按当前生效配置继续
    ctx.effect(() => {
        let disposed = false
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
                if (cached) {
                    setCatalog(cached)
                    // 首轮填充完成后才拉取最新数据，避免两次写入并发冲突
                    fix(ctx)
                        .finally(() => {
                            if (disposed) return
                            refresh(ctx, () => disposed)
                        })
                        .catch((error) => {
                            if (disposed) return
                            ctx.logger.warn(`${PLUGIN_NAME}: 填充失败：${error instanceof Error ? error.message : String(error)}`)
                        })
                } else {
                    // 缓存不可用，直接拉取最新数据
                    refresh(ctx, () => disposed)
                }
            })
        return () => {
            disposed = true
        }
    })
}
