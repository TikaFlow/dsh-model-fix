/**
 * Connection RPC 端点（前后端通信通道）：
 * - 「强制更新」→ fix(ctx, true) 单次绕过 allowUpdate 填充（不重新拉取 models.dev，用当前内存目录）；
 * - 「重置模型」→ resetModels(ctx) 仅剔除插件填充的模型字段（reasoningEfforts / 容量 / 图片模态），
 *   配置段原样保留（开关不变，重置后修改配置仍按原开关触发填充），事件流守卫全程打开，
 *   写回触发的 settings/updated 一律短路，避免把刚删掉的字段重新填回。
 * - 「恢复备份」→ restoreModels(ctx) 把启动时备份（交集：备份与当前都存在的 provider+model）回退，
 *   事件流守卫全程打开，避免写回触发填充。
 * 三个端点共用同一守卫做互斥：守卫已开（另一写回在途）时一律拒绝——两个写回端点并发时，
 * 后到者的 finally 会提前解除守卫，令先到者的写回失去保护；填充与写回语义也相互冲突。
 * channel 为插件自有命名空间拼成的绝对前缀，浏览器半以 `/${MODEL_FIX_NS}` 字面量配对（跨半禁值导入，改动须两侧同步）。
 * connection 服务经 ctx.get 断言取得（宿主包未安装为依赖，类型用 src/types 的结构复制；
 * 断言范式与宿主内置插件 ui-settings-general 一致），信任围栏由宿主 connection 统一施加。
 */

import type { Context } from '@deepseek-ai/cordis'
import { PLUGIN_NAME, PLUGIN_NS } from './constants'
import { fix } from './fix'
import { isIgnoreAll } from './guard'
import { resetModels } from './reset'
import { restoreModels } from './restore'
import type { HostRpcHandle, RpcResult } from './types'

/** 卡片「强制更新」按钮调用的 endpoint 名 */
const ENDPOINT_FORCE_UPDATE = 'forceUpdate'
/** 卡片「重置模型」按钮调用的 endpoint 名 */
const ENDPOINT_RESET_MODELS = 'resetModels'
/** 卡片「恢复备份」按钮调用的 endpoint 名 */
const ENDPOINT_RESTORE_MODELS = 'restoreModels'

/** 守卫已开（另一写回在途）时的统一拒绝结果 */
const writeInProgress = (): RpcResult<unknown> => ({
    ok: false,
    error: { code: 'model-fix/write-in-progress', message: '另一操作进行中，请稍后重试', details: {} },
})

/** 注册一个 channel（三个端点；handle 返回 async disposer，经 ctx.effect 挂卸载自动回收） */
export function installRpc(ctx: Context): void {
    // dsh-client-connection ≥0.1.5 的 rpc.handle 在调用方 fiber 上求值 owner.webServer，
    // 未注入 webServer 的上下文注册会抛 "cannot get property" 错误；
    // 故经 ctx.inject 子 fiber 声明 connection+webServer（范式同宿主内置 api-gateway），
    // 无 webServer 的 profile（如 headless）下子 fiber 不启动，插件其余功能不受影响。
    ctx.inject(['connection', 'webServer'], (rpcCtx) => {
        const connection = rpcCtx.get('connection') as { rpc: { handle: HostRpcHandle } }
        rpcCtx.effect(() => connection.rpc.handle(`/${PLUGIN_NS}`, async (endpoint) => {
            if (endpoint === ENDPOINT_FORCE_UPDATE) {
                // 重置/恢复写回期间拒绝：填充会把刚回退掉的字段重新写回，与写回语义冲突
                if (isIgnoreAll()) return writeInProgress()
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
            }
            if (endpoint === ENDPOINT_RESET_MODELS || endpoint === ENDPOINT_RESTORE_MODELS) {
                // 两个写回端点互斥：守卫已开时第二个写回的 finally 会提前解除守卫，故一律拒绝
                if (isIgnoreAll()) return writeInProgress()
                try {
                    const changed = endpoint === ENDPOINT_RESET_MODELS ? await resetModels(ctx) : await restoreModels(ctx)
                    return { ok: true, value: { changed } }
                } catch (error) {
                    return {
                        ok: false,
                        error: {
                            code: endpoint === ENDPOINT_RESET_MODELS ? 'model-fix/reset-models-failed' : 'model-fix/restore-models-failed',
                            message: error instanceof Error ? error.message : String(error),
                            details: {},
                        },
                    }
                }
            }
            return { ok: false, error: { code: 'model-fix/unknown-endpoint', message: `未知端点：${endpoint}`, details: {} } }
        }), `${PLUGIN_NAME}: rpc channel`)
    })
}
