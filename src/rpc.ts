/**
 * Connection RPC 端点（前后端通信通道）：
 * - 「强制更新」→ fix(ctx, true) 单次绕过 allowUpdate 填充（不重新拉取 models.dev，用当前内存目录）；
 * - 「重置推理级别」→ resetModels(ctx) 仅剔除模型上的推理级别字段（reasoningEfforts），
 *   最大上下文 / 输出上限 / 图片模态可在模型页自行设置故不清除；配置段原样保留
 *   （开关不变，重置后修改配置仍按原开关触发填充），事件流守卫全程打开，
 *   写回触发的 settings/document-updated 一律短路，避免把刚删掉的字段重新填回。
 * - 「恢复备份」→ restoreModels(ctx) 把启动时备份（交集：备份与当前都存在的 provider+model）回退，
 *   事件流守卫全程打开，避免写回触发填充。
 * - 「验证模型」不在此列：它要回一个持续多帧的进度流，走独立的 `connection.fetch` 路由（见文末）。
 *   只读、不写 settings，故**不占事件流守卫**，也不与写回端点互斥。
 * - 「探测式填充」同样走独立流路由，但它**要写 settings**：一轮之内先把候选档位临时预声明进配置
 *   （宿主按配置里的声明校验档位，不先声明就出不了网）、跑完再收敛写回，故与写回端点同样以守卫互斥，
 *   且守卫持有整轮（理由见 `src/probe.ts`）。因此它入口也要先查守卫：别在别的写回在途时插进来，
 *   那样对方的 finally 会提前解掉它的守卫。
 * - 「剔除推理级别」→ pruneUnsupportedEfforts(ctx, targets) 按验证明细给出的档位清单剔除，
 *   同样经守卫与 `queueTask` 写回。守卫在这里不可省：浏览器半直写绕不过去，
 *   守卫一开，写回触发的 settings 事件就不会让事件链的 `fix` 把刚剔掉的档位又填回来。
 * 各写回端点共用同一守卫做互斥：入口一律先查，守卫已开（另一写回在途）即拒——后到者的 finally 会
 * 提前解除守卫，令先到者的写回失去保护；填充与写回语义也相互冲突。置位分工：forceUpdate 在本
 * handler 层置位（finally 解除），reset / restore / prune 由各自写回内部置位，探测式填充持有整轮。
 * 守卫互斥只覆盖查守卫的路径：
 * 事件链的 fix 只查不置位，在途窗口内本层入口仍可进入，该并发由 fix 自身的 revision 冲突重试兜底。
 * channel 为插件自有命名空间拼成的绝对前缀，浏览器半以 `/${PLUGIN_NS}` 配对（两侧同取 src/shared/constants.ts 的 `PLUGIN_NS`，改常量即两侧同步）。
 * connection / webServer 服务经 ctx.get 断言取得宿主真类型（type-only 导入 devDep 的
 * dsh-client-connection / dsh-host-webserver；断言范式与宿主内置插件 ui-settings-general 一致），信任围栏由宿主 connection 统一施加。
 * 路由由本插件自注册而不走宿主 `connection.rpc.handle`：后者在**服务自己的 ctx** 上求值
 * `owner.webServer`，而 connection 插件自 0.1.5 起不再注入 webServer，故它必然抛错（详见 rpc-route.ts）。
 *
 * 验证与探测式填充的进度各开一条 `connection.fetch` 的 exact 路由（`VERIFY_STREAM_ROUTE` / `PROBE_STREAM_ROUTE`）：
 * 一次调用要回一个持续多帧的响应，而 RPC 的「一次调用 = 一个 JSON 结果」形状装不下。走 Connection 的
 * Fetch 面还白拿信任围栏、浏览器认证与「客户端断开 → `request.signal`」——据此中止执行，
 * 不在用户已经离开之后继续烧他的额度。
 * 两条流共用同一份 Fetch 实现：线上形状逐字段同形，差别的只有执行器与措辞。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcResult, HostConnectionService } from '@deepseek-ai/dsh-client-connection'
// ctx.llm 服务面声明合并（仅 type-only，不引运行期依赖；LLM 服务是插件 inject 依赖，装载即在）
import type {} from '@deepseek-ai/dsh-llm'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { PLUGIN_NAME, PLUGIN_NS, PROBE_STREAM_ROUTE, VERIFY_STREAM_ROUTE } from '@/shared/constants'
import { errorText } from '@/shared/errors'
import { encodeProgressFrame } from '@/shared/verify-progress'
import type { VerifySummary } from '@/shared/verify-progress'
import type { ProbeRunOptions } from '@/probe-engine'
import { fix } from '@/fix'
import { endIgnoreAll, isIgnoreAll, startIgnoreAll } from '@/guard'
import { parsePruneTargets, pruneUnsupportedEfforts } from '@/prune'
import { probeAndFill } from '@/probe'
import { resetModels } from '@/reset'
import { restoreModels } from '@/restore'
import { verifyModels } from '@/verify'
import { createChannelRoute } from '@/rpc-route'
import type { EndpointHandler } from '@/rpc-route'

/** 一轮执行的入口：载荷 → 进度帧 → 终帧。验证与探测式填充同型，只有执行器与措辞不同 */
type ProgressRunner = (payload: unknown, options: ProbeRunOptions) => Promise<VerifySummary>

/** 卡片「强制更新」按钮调用的 endpoint 名 */
const ENDPOINT_FORCE_UPDATE = 'forceUpdate'
/** 卡片「重置推理级别」按钮调用的 endpoint 名 */
const ENDPOINT_RESET_MODELS = 'resetModels'
/** 卡片「恢复备份」按钮调用的 endpoint 名 */
const ENDPOINT_RESTORE_MODELS = 'restoreModels'
/** 剔除不被支持的推理级别时调用的 endpoint 名（由验证结果确认框发起，携带档位明细） */
const ENDPOINT_PRUNE_EFFORTS = 'pruneEfforts'

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
        const connection = rpcCtx.get('connection') as Pick<HostConnectionService, 'requestRejection' | 'fetch'>
        const webServer = rpcCtx.get('webServer') as WebServer
        rpcCtx.effect(() => {
            const channel = `/${PLUGIN_NS}`
            // 强制更新与恢复备份各按整份配置重算、不读载荷；重置也不读，但剔除要按调用方给的档位明细动手
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
                                message: errorText(error),
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
                                message: errorText(error),
                                details: {},
                            },
                        }
                    }
                }
                if (endpoint === ENDPOINT_PRUNE_EFFORTS) {
                    // 剔除也是写回：守卫已开（另一写回在途）即拒，否则两个 finally 抢着解守卫
                    if (isIgnoreAll()) return writeInProgress()
                    const targets = parsePruneTargets(payload)
                    if (targets === undefined) {
                        return {
                            ok: false,
                            error: { code: 'model-fix/prune-efforts-invalid', message: '剔除请求不合法（提供方 / 模型 / 推理级别缺失或越界）', details: {} },
                        }
                    }
                    try {
                        return { ok: true, value: { pruned: await pruneUnsupportedEfforts(ctx, targets) } }
                    } catch (error) {
                        return {
                            ok: false,
                            error: {
                                code: 'model-fix/prune-efforts-failed',
                                message: errorText(error),
                                details: {},
                            },
                        }
                    }
                }
                return { ok: false, error: { code: 'model-fix/unknown-endpoint', message: `未知端点：${endpoint}`, details: {} } }
            }
            const disposeChannel = webServer.register({ kind: 'prefix', path: channel, handler: createChannelRoute(connection, channel, handler) })
            // 两条进度流走 connection.fetch 的 exact 路由而非 channel：它们要的是一个持续多帧的响应，
            // 而 RPC 的一次调用只对应一个 JSON 结果
            const disposeStream = connection.fetch.register({
                path: VERIFY_STREAM_ROUTE,
                methods: ['POST'],
                requestBody: 'buffered',
                fetch: progressStreamFetch((payload, options) => verifyModels(ctx.llm, payload, options), '验证'),
            })
            // 探测式填充的流多带一个 ctx：它一轮之内要写两次配置（预声明 + 收敛），都在守卫内完成
            const disposeProbe = connection.fetch.register({
                path: PROBE_STREAM_ROUTE,
                methods: ['POST'],
                requestBody: 'buffered',
                fetch: progressStreamFetch((payload, options) => probeAndFill(ctx, ctx.llm, payload, options), '探测', true),
            })
            return () => {
                disposeChannel()
                // fetch.register 的 disposer 是异步的；effect 只负责同步调用它
                void disposeStream()
                void disposeProbe()
            }
        }, `${PLUGIN_NAME}: rpc`)
    })
}

/**
 * 进度流的 Fetch 实现：请求体是模型清单，响应是以 SSE 分帧的进度。
 *
 * 走 `connection.fetch.register` 而非 `webServer.register` 是刻意的：前者由 Connection 代管信任围栏、
 * 浏览器认证与**客户端断开 → `request.signal`**，后者这些都得自己再搭一遍（见本文件头记的
 * connection 自 0.1.5 起不再注入 webServer 那个坑）。
 *
 * 验证与探测式填充共用这一份实现：两者的线上形状逐字段同形（同一批帧类型、同一编解码），
 * 差别的只有执行器与报错措辞，故那两样由调用方给。
 *
 * `needsIdleGuard` 只给会写配置的那条流用：它与写回端点共用事件流守卫做互斥，
 * 故入口先查守卫，已开即拒（409，文案即给前端展示，故不是裸状态码）。
 */
function progressStreamFetch(
    run: ProgressRunner,
    label: string,
    needsIdleGuard = false,
): (request: Request) => Promise<Response> {
    const encoder = new TextEncoder()
    return async (request) => {
        // 写配置的流（探测式填充）入口先查守卫：别在别的写回在途时插进来，
        // 那样对方的 finally 会提前解掉本轮的守卫，预声明写回就失去事件链的短路保护
        if (needsIdleGuard && isIgnoreAll()) return new Response('另一操作进行中，请稍后重试', { status: 409 })
        let payload: unknown
        try {
            payload = await request.json()
        } catch {
            return new Response('invalid json body', { status: 400 })
        }
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                const settle = (): void => {
                    try {
                        controller.close()
                    } catch {
                        // 客户端已断开，控制器随之失效；无可挽回，也不必上报
                    }
                }
                run(payload, {
                    // 客户端断开时 request.signal 会中止，据此让执行循环早停——
                    // 这一轮是即用即弃的诊断，用户已经不在之后继续跑等于白烧他的额度
                    signal: request.signal,
                    onProgress: (frame) => {
                        try {
                            controller.enqueue(encoder.encode(encodeProgressFrame(frame)))
                        } catch {
                            // 同上：流已不可写。执行器随即随 signal 停下，不会再压更多帧
                        }
                    },
                }).then(settle, (error: unknown) => {
                    // 入参非法之类跑不到一帧的情形：只收尾，消费方见「流结束却没等到 done」即知没跑完
                    console.error(`[${PLUGIN_NAME}] ${label}流异常终止`, error)
                    settle()
                })
            },
        })
        return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
    }
}
