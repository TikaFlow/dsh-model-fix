/**
 * Connection RPC 端点（前后端通信通道）：浏览器半卡片「强制更新」→ fix(ctx, true) 单次
 * 绕过 allowUpdate 填充（不重新拉取 models.dev，用当前内存目录）。channel 为插件自有命名空间
 * 拼成的绝对前缀，浏览器半以 `/${MODEL_FIX_NS}` 字面量配对（跨半禁值导入，改动须两侧同步）。
 * connection 服务经 ctx.get 断言取得（宿主包未安装为依赖，类型用 src/types 的结构复制；
 * 断言范式与宿主内置插件 ui-settings-general 一致），信任围栏由宿主 connection 统一施加。
 */

import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_NAME, PLUGIN_NS } from './constants'
import { fix } from './fix'
import type { HostRpcHandle } from './types'

/** 卡片「强制更新」按钮调用的 endpoint 名 */
const ENDPOINT_FORCE_UPDATE = 'forceUpdate'

/** 注册强制更新 channel（handle 返回 async disposer，经 ctx.effect 挂卸载自动回收） */
export function installRpc(ctx: Context): void {
    // dsh-client-connection ≥0.1.5 的 rpc.handle 在调用方 fiber 上求值 owner.webServer，
    // 未注入 webServer 的上下文注册会抛 "cannot get property" 错误；
    // 故经 ctx.inject 子 fiber 声明 connection+webServer（范式同宿主内置 api-gateway），
    // 无 webServer 的 profile（如 headless）下子 fiber 不启动，插件其余功能不受影响。
    ctx.inject(['connection', 'webServer'], (rpcCtx) => {
        const connection = rpcCtx.get('connection') as { rpc: { handle: HostRpcHandle } }
        rpcCtx.effect(() => connection.rpc.handle(`/${PLUGIN_NS}`, async (endpoint) => {
            if (endpoint !== ENDPOINT_FORCE_UPDATE) {
                return { ok: false, error: { code: 'model-fix/unknown-endpoint', message: `未知端点：${endpoint}`, details: {} } }
            }
            try {
                return { ok: true, value: { changed: await fix(ctx, true) } }
            } catch (error) {
                // fix 内部已告警；此处转成 RPC 失败结果回传前端展示
                return {
                    ok: false,
                    error: {
                        code: 'model-fix/force-update-failed',
                        message: error instanceof Error ? error.message : String(error),
                        details: {},
                    },
                }
            }
        }), `${PLUGIN_NAME}: rpc channel`)
    })
}
