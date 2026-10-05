/**
 * Connection RPC 端点（前后端通信通道）：
 * - 「强制更新」→ fix(ctx, true) 单次绕过 allowUpdate 填充（不重新拉取 models.dev，用当前内存目录）；
 * - 「重置推理级别」→ resetModels(ctx) 仅剔除模型上的推理级别字段（reasoningEfforts），
 *   最大上下文 / 输出上限 / 图片模态可在模型页自行设置故不清除；配置段原样保留
 *   （开关不变，重置后修改配置仍按原开关触发填充），事件流守卫全程打开，
 *   写回触发的 settings/document-updated 一律短路，避免把刚删掉的字段重新填回。
 * - 「恢复备份」→ restoreModels(ctx) 把启动时备份（交集：备份与当前都存在的 provider+model）回退，
 *   事件流守卫全程打开，避免写回触发填充。
 * - 「验证模型」→ verifyModels(llm, payload) 对勾选的「模型 × 推理级别」各发一次最小请求，仅以提供方是否受理
 *   判定可用（详见 src/verify.ts）。只读、不写 settings，故**不占事件流守卫**，也不与三个写回端点互斥。
 * 前三个写回端点共用同一守卫做互斥：入口一律先查，守卫已开（另一写回在途）即拒——后到者的 finally 会
 * 提前解除守卫，令先到者的写回失去保护；填充与写回语义也相互冲突。置位分工：forceUpdate 在本
 * handler 层置位（finally 解除），reset / restore 由各自写回内部置位。守卫互斥只覆盖查守卫的路径：
 * 事件链的 fix 只查不置位，在途窗口内本层入口仍可进入，该并发由 fix 自身的 revision 冲突重试兜底。
 * channel 为插件自有命名空间拼成的绝对前缀，浏览器半以 `/${PLUGIN_NS}` 配对（两侧同取 src/shared/constants.ts 的 `PLUGIN_NS`，改常量即两侧同步）。
 * connection / webServer 服务经 ctx.get 断言取得宿主真类型（type-only 导入 devDep 的
 * dsh-client-connection / dsh-host-webserver；断言范式与宿主内置插件 ui-settings-general 一致），信任围栏由宿主 connection 统一施加。
 * 路由由本插件自注册而不走宿主 `connection.rpc.handle`：后者在**服务自己的 ctx** 上求值
 * `owner.webServer`，而 connection 插件自 0.1.5 起不再注入 webServer，故它必然抛错（详见 rpc-route.ts）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult, HostConnectionService } from '@deepseek-ai/dsh-client-connection'
// ctx.llm 服务面声明合并（仅 type-only，不引运行期依赖；LLM 服务是插件 inject 依赖，装载即在）
import type {} from '@deepseek-ai/dsh-llm'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { PLUGIN_NAME, PLUGIN_NS } from '@/shared/constants'
import { fix } from '@/fix'
import { endIgnoreAll, isIgnoreAll, startIgnoreAll } from '@/guard'
import { resetModels } from '@/reset'
import { restoreModels } from '@/restore'
import { verifyModels } from '@/verify'
import { createChannelRoute } from '@/rpc-route'
import type { EndpointHandler } from '@/rpc-route'

/** 卡片「强制更新」按钮调用的 endpoint 名 */
const ENDPOINT_FORCE_UPDATE = 'forceUpdate'
/** 卡片「重置推理级别」按钮调用的 endpoint 名 */
const ENDPOINT_RESET_MODELS = 'resetModels'
/** 卡片「恢复备份」按钮调用的 endpoint 名 */
const ENDPOINT_RESTORE_MODELS = 'restoreModels'
/** 卡片「验证模型」按钮调用的 endpoint 名 */
const ENDPOINT_VERIFY_MODELS = 'verifyModels'

/** 守卫已开（另一写回在途）时的统一拒绝结果 */
const writeInProgress = (): ConnectionRpcResult<unknown> => ({
    ok: false,
    error: { code: 'model-fix/write-in-progress', message: '另一操作进行中，请稍后重试', details: {} },
})

/** 注册一个 channel（四个端点）；register 返回 disposer，经 ctx.effect 挂卸载自动回收 */
export function installRpc(ctx: Context): void {
    // 子 fiber 声明 connection + webServer：webServer 用于注册前缀路由，connection 用于信任围栏。
    // 无 webServer 的 profile（如 headless）下子 fiber 不启动，插件其余功能不受影响。
    ctx.inject(['connection', 'webServer'], (rpcCtx) => {
        const connection = rpcCtx.get('connection') as Pick<HostConnectionService, 'requestRejection'>
        const webServer = rpcCtx.get('webServer') as WebServer
        rpcCtx.effect(() => {
            const channel = `/${PLUGIN_NS}`
            const handler: EndpointHandler = async (endpoint, payload) => {
                if (endpoint === ENDPOINT_FORCE_UPDATE) {
                    // 重置/恢复写回期间拒绝：填充会把刚回退掉的字段重新写回，与写回语义冲突
                    if (isIgnoreAll()) return writeInProgress()
                    // 自身在途同样置守卫：fix 含 await 与冲突重试，不置位的话该窗口内 reset/restore/
                    // forceUpdate 入口查得 false 可进入，两批 mutate 并发互踩。
                    // 置位先于 await 同步完成，finally 解除；守卫是单飞标志，不能收进 fix 自身
                    // （事件链也调 fix，嵌套置位的内层 finally 会提前解除外层守卫）
                    startIgnoreAll()
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
                    } finally {
                        endIgnoreAll()
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
                // 验证：只读，不查也不置事件流守卫（与三个写回端点无冲突），故不参与上方互斥
                if (endpoint === ENDPOINT_VERIFY_MODELS) {
                    try {
                        return { ok: true, value: await verifyModels(ctx.llm, payload) }
                    } catch (error) {
                        return {
                            ok: false,
                            error: {
                                code: 'model-fix/verify-models-failed',
                                message: error instanceof Error ? error.message : String(error),
                                details: {},
                            },
                        }
                    }
                }
                return { ok: false, error: { code: 'model-fix/unknown-endpoint', message: `未知端点：${endpoint}`, details: {} } }
            }
            return webServer.register({ kind: 'prefix', path: channel, handler: createChannelRoute(connection, channel, handler) })
        }, `${PLUGIN_NAME}: rpc channel`)
    })
}
