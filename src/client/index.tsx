/**
 * 浏览器半入口（dsh.client 声明的 web 侧 cordis 插件）。宿主 settings 面为 0.1.7+ 的
 * ctx.configForms，经 makeScope 包装（decode 缓存语义）后供卡片与记忆监听消费。
 * 四个席位一律注册：`ctx.slots.inject` 对无声明方的席位只挂一个 pending wait（声明到达
 * 才跑回调，fiber 卸载即取消），故缺席者静默不发生（卡片不出现）。SlotMap 键经
 * models 包与本插件包 declaration merging 提供（均 type-only 导入，构建期擦除）。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// ctx.sessions 服务面（ISessions 声明合并）
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// 一次模型选择与会话投影（宿主真类型，type-only）
import type { ModelSelection, ModelSelectionProjection } from '@deepseek-ai/dsh-api-session-controller/types'
// ctx.modelDirectories 服务面（ModelDirectoryResolver 声明合并）+ 目录控制器类型
import type { ModelDirectory } from '@deepseek-ai/dsh-client-ui-model-selection/client'
// SessionId 品牌 id（sessions / modelDirectories 服务的键类型）
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// ctx.slots 服务面（SlotRegistry）
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// ctx.locale 服务面
import type {} from '@deepseek-ai/dsh-client-locale/client'
// ctx.configForms 服务面 + ConfigForm 类型
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
// SlotMap 的 'settings.models.footer' 键声明合并
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
// SlotMap 的 'plugins.bundle.config' / 'plugins.row.config' 键声明合并（宿主 ui-plugin-manager 类型面）
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
// Connection RPC 调用面（宿主真类型，type-only；取服务沿用宿主 ui-settings-general 的 ctx.get 断言范式）
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { Card } from '@/client/card'
import { CARD_NS, en, zh } from '@/client/locales'
import { API_NS as PI_AI_NS, PLUGIN_NAME, PLUGIN_NS as MODEL_FIX_NS } from '@/shared/constants'
import { DEFAULT_CONFIG } from '@/shared/parse'
import { VERSION_KEY, decodeSection } from '@/client/model'
import type { Flags } from '@/client/model'
import { applyEffort, classifyTransition, sameSelection } from '@/client/effort'
import { makeScope, type DecodedScope } from '@/client/scope'

/** 提供方 scope 的解码占位值：本卡只消费 snapshot.user（原始用户层），value 无用途；decode 必须永不返回 undefined */
const PROVIDERS_VIEW: readonly unknown[] = []

export const name = PLUGIN_NAME
export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
    // 宿主 get 只收一个 entryId 参数（无 decode spec），段值解码由 makeScope 的 decode 完成
    ctx.inject(['configForms'], (child) => {
        const configForms = child.get('configForms') as { get: (ns: string) => ConfigForm<unknown> }
        boot(ctx,
            makeScope(configForms.get(MODEL_FIX_NS), decodeSection),
            makeScope(configForms.get(PI_AI_NS), () => PROVIDERS_VIEW),
        )
    })
}

/**
 * 编排体：词典注册、RPC 载体、席位注册、记忆监听子 fiber。
 * @param ctx - 父 fiber 的 ctx：共享编排一律在其上执行（ctx.<name> 属性读要求本 fiber
 *   声明过 inject，子 fiber 只声明了标记服务；子 ctx 只用于构造 scope）
 * @param scope - 本插件命名空间的 decode 后段视图（卡片与记忆监听消费）
 * @param providersScope - llm-pi-ai 命名空间的 decode 后段视图（只消费 user 层的提供方 id）
 */
function boot(
    ctx: ClientContext,
    scope: DecodedScope<Flags>,
    providersScope: DecodedScope<readonly unknown[]>,
): void {
    // 词典注册返回 disposer；经 effect 挂载，卸载/HMR 时自动撤销
    ctx.effect(() => ctx.locale.register(CARD_NS, { zh, en }), `${name}: card dictionaries`)
    // scope 的 form 订阅释放挂入本 fiber
    ctx.effect(() => () => { scope.dispose(); providersScope.dispose() }, `${name}: scope disposal`)
    // RPC channel 与 src/rpc.ts 的 `/${PLUGIN_NS}` 同源（同取 PLUGIN_NS 常量）；endpoint 名须与 rpc.ts 两侧同步。
    // ctx.connection 的声明合并只有宿主 face（HostConnectionHandle），client face 无合并 ⇒ 经 unknown 桥接断言
    const rpc = (ctx.get('connection') as unknown as { rpc: ClientConnectionRpc }).rpc
    const forceUpdate = () => rpc.call(`/${MODEL_FIX_NS}`, 'forceUpdate', {})
    const resetModels = () => rpc.call(`/${MODEL_FIX_NS}`, 'resetModels', {})
    const restoreModels = () => rpc.call(`/${MODEL_FIX_NS}`, 'restoreModels', {})
    // 每模型推理级别记忆经自有 NS 的 settings scope 直写（与「保存」同一条写路径）；
    // 空记忆也写 `{}` 而非删键——字段在文件里恒存在、形态恒定
    const rememberEffort = (provider: string, model: string, effort: string | null): void => {
        const next = applyEffort(scope.getSnapshot().value?.efforts ?? {}, provider, model, effort)
        // 记忆写入失败不影响会话本身（级别已在当前会话生效），故只吞掉 rejection
        void scope.mutate([{ op: 'set', path: [VERSION_KEY, 'efforts'], value: next }]).catch(() => {})
    }
    // 单元格标识按 kind：list 席位用 id、keyed 席位用 key（footer 是配置 NS，bundle 是 npm 包名，
    // row 是「包名#patch 条目 id」；不同 slot 即不同账本，无需后缀区分）；footer 以 order 排最前
    // （list 渲染器按 order 单键重排）
    ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
        name: 'settings.models.footer',
        id: MODEL_FIX_NS,
        order: -999999,
        locale: CARD_NS,
    }, (props) => <Card {...props} scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))
    // 插件详情页的配置段：keyed 按 entryKey 分发，key 是 npm 包名（不是 patch 条目 id）
    // defaultOpen：配置段就是该页主体，默认收起等于让用户多点一次
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: name,
        locale: CARD_NS,
    }, (props) => <Card {...props} defaultOpen scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))
    // patch 声明的组件实例自己的配置页：key = `<npm 包名>#<patch 条目 id>`（宿主 rowConfigKey 拼接，
    // 条目 id 即运行实例 id = MODEL_FIX_NS）。注册后「包含的组件」里该实例的 title 变为可点按钮，
    // 进入组件详情页（返回按钮为插件名、下方不再有组件列表）；不注册则 title 是纯文本、无任何交互。
    // 与 bundle 席位共用同一张卡（单实例 bundle 两层 UI 同体），defaultOpen 同 bundle 席位
    ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
        name: 'plugins.row.config',
        key: `${name}#${MODEL_FIX_NS}`,
        locale: CARD_NS,
    }, (props) => <Card {...props} defaultOpen scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))
    // 「设置 → 内置插件」的 tablist（list 席位，面板即本卡）：与官方「插件列表」tab 同级并排。
    // tab label 走 thunk，section 每次读账本时求值、切语言即跟随
    const t = ctx.locale.bind(CARD_NS)
    ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
        name: 'settings.plugins.tab',
        id: MODEL_FIX_NS,
        order: 20,
        label: () => t('tabLabel'),
        locale: CARD_NS,
    }, (props) => <Card {...props} defaultOpen scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))

    // 记忆监听子 fiber（宿主无 sessions/modelDirectories 时静默不启用）：纯监听，只订阅会话投影；
    // 自动设置经宿主公开 directory.select，保存经自有 NS 的 settings scope 直写
    ctx.inject(['sessions', 'modelDirectories'], (subCtx) => {
        const sessions = subCtx.sessions
        const modelDirectories = subCtx.modelDirectories

        subCtx.effect(() => {
            /** 每会话的追踪状态 */
            interface Tracked {
                retainUnsub: (() => void) | null
                projectionUnsub: (() => void) | null
                lastNext: ModelSelection | null
                pendingAutoSet: ModelSelection | null
            }
            const tracked = new Map<SessionId, Tracked>()

            /** 处理一次投影变化 */
            function handleProjection(id: SessionId, entry: Tracked, next: ModelSelection | null): void {
                // 守卫：跳过本次自动设置反向触发的投影变化（避免重复保存）
                if (entry.pendingAutoSet !== null) {
                    if (next !== null && sameSelection(entry.pendingAutoSet, next)) {
                        entry.pendingAutoSet = null
                        entry.lastNext = next
                        return
                    }
                    entry.pendingAutoSet = null
                }

                const prev = entry.lastNext
                entry.lastNext = next
                if (next === null) return

                let dir: ModelDirectory
                try {
                    dir = modelDirectories.directoryFor(id)
                } catch {
                    // 宿主对未知/未保留会话 fail loud（显式抛错），此处跳过本次变化即可
                    return
                }
                const dirState = dir.store.getSnapshot()
                // 开关仅门控「保存」；恢复用的记忆始终取真实 efforts（是否清空由卡片交互决定）
                // 兜底取共享层默认（单一来源，段值不可用时与「全新用户」行为一致）
                const flags = scope.getSnapshot().value
                const rememberEfforts = flags?.userExperience.rememberEfforts ?? DEFAULT_CONFIG.userExperience.rememberEfforts
                const defaultHigh = flags?.userExperience.defaultHigh ?? DEFAULT_CONFIG.userExperience.defaultHigh
                const memory = flags?.efforts ?? {}
                const transition = classifyTransition(prev, next, memory, dirState.groups, defaultHigh)

                if (transition.kind === 'model-change') {
                    if (transition.resolved.reasoningEffort !== next.reasoningEffort) {
                        entry.pendingAutoSet = transition.resolved
                        // select 拒绝时清掉守卫：残留会让后续恰好同值的投影变化被误吞（跳过记忆保存）；
                        // 与投影守卫竞态两序皆安全（幂等清空），untracked 的 entry 上清空亦无害
                        void dir.select(transition.resolved).catch(() => { entry.pendingAutoSet = null })
                    }
                } else if (transition.kind === 'effort-change' && rememberEfforts) {
                    void rememberEffort(next.provider, next.model, next.reasoningEffort ?? null)
                }
            }

            /** 对一个会话建立保留态 + 投影订阅 */
            function trackRetain(id: SessionId): void {
                let entry = tracked.get(id)
                if (!entry) {
                    entry = { retainUnsub: null, projectionUnsub: null, lastNext: null, pendingAutoSet: null }
                    tracked.set(id, entry)
                }
                const retainInfo = sessions.retainInfo(id)
                const syncRetain = (): void => {
                    if (retainInfo.getSnapshot().referenceCount <= 0) {
                        // retain 归零即解除投影订阅：未保留会话不应触发 handleProjection；
                        // lastNext / pendingAutoSet 保留，重保留时首帧据此正确消化自动设置回声
                        entry.projectionUnsub?.()
                        entry.projectionUnsub = null
                        return
                    }
                    if (entry.projectionUnsub) return
                    const binding = sessions.binding(id)
                    if (!binding) return
                    const projection = binding.session.projections.faceOf('modelSelection')
                    const readNext = (): ModelSelection | null => (projection.getSnapshot() as ModelSelectionProjection | null)?.next ?? null
                    entry.projectionUnsub = projection.subscribe(() => handleProjection(id, entry, readNext()))
                    // 订阅时先按当前值跑一次，避免已选模型要等下一次变化才恢复记忆
                    handleProjection(id, entry, readNext())
                }
                entry.retainUnsub = retainInfo.subscribe(syncRetain)
                // subscribe 只订阅失效通知、不推首值：立即按当前快照补一遍，
                // 已 retain 的会话（track 前就已保留）即刻挂上投影订阅
                syncRetain()
            }

            /** 解绑一个会话的所有订阅 */
            function untrack(id: SessionId): void {
                const entry = tracked.get(id)
                if (!entry) return
                entry.retainUnsub?.()
                entry.projectionUnsub?.()
                tracked.delete(id)
            }

            const syncList = (): void => {
                const ids = new Set(sessions.list.getSnapshot().ids)
                for (const id of [...tracked.keys()]) {
                    if (!ids.has(id)) untrack(id)
                }
                for (const id of ids) {
                    if (!tracked.has(id)) trackRetain(id)
                }
            }
            const listUnsub = sessions.list.subscribe(syncList)
            // subscribe 只订阅失效通知、不推首值：立即按当前快照补一遍，
            // 插件激活时已存在的会话同样进入追踪（否则要等 list 下次变化）
            syncList()

            return () => {
                listUnsub()
                for (const id of [...tracked.keys()]) untrack(id)
                tracked.clear()
            }
        }, `${name}: effort memory listener`)
    })
}
