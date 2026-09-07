import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { readCache, setCatalog } from './catalog'
import { PLUGIN_NS, API_NS, PLUGIN_NAME } from './constants'
import { DEFAULT_SECTION, SectionSchema, resolveConfig, setConfigSource } from './config'
import { migrateConfig, waitForSettingsReady } from './migrate'
import { refresh } from './refresh'
import { installRpc } from './rpc'
import { fix } from './fix'

export const name = PLUGIN_NAME
export const inject = ['settings', 'connection']

/** 吞掉 fix 写回失败的 rejection（失败日志已在 fix 内告警，避免未处理拒绝） */
const swallowFixError = (): void => {}

export function apply(ctx: Context) {
    // 注册自有配置命名空间：段为版本快照容器，setSource 解析出运行时配置，onChange 响应配置变更
    installSettingsSection(ctx, PLUGIN_NS, SectionSchema, DEFAULT_SECTION, {
        setSource: (current) => { setConfigSource(() => resolveConfig(current())) },
        // 插件配置变化时重新填充（fix 内部对无变更字段自然跳过）
        onChange: () => { fix(ctx).catch(swallowFixError) },
    })
    // llm-pi-ai 模型配置变更后重新填充
    ctx.on('settings/updated', (ns) => {
        if (ns !== API_NS) return
        fix(ctx).catch(swallowFixError)
    })
    // 浏览器半「强制更新」RPC channel（结果经 RpcResult 回传卡片）
    installRpc(ctx)
    // 首轮：等待自有命名空间注册完成 → 配置迁移 → 缓存读取 → 填充 → 异步刷新，统一由 effect 管理
    // （注册经 installSettingsSection 的子 fiber 延迟到微任务，必须等其完成后再迁移，否则 describe() 读空）
    // 卸载时置位，在途结果不触碰已卸载的上下文；迁移失败仅告警、按当前生效配置继续
    ctx.effect(() => {
        let disposed = false
        void waitForSettingsReady(ctx, () => disposed)
            .then((ready) => {
                if (disposed) return
                // 命名空间迟迟未注册（如服务缺席）时跳过迁移，不阻塞后续按生效配置的填充
                if (!ready) {
                    ctx.logger.warn(`${PLUGIN_NAME}: 未检测到自有配置命名空间注册，跳过配置迁移`)
                    return
                }
                return migrateConfig(ctx)
            })
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
