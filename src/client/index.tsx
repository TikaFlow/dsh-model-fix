/**
 * 浏览器半入口（dsh.client 声明的 web 侧 cordis 插件）。宿主 settings 面两代互斥——
 * 0.1.6 及更早的 ctx.settingsScope 与 0.1.7+ 的 ctx.configForms，恰有一个存在 ⇒
 * 两个 ctx.inject 子 fiber 各挂一代（缺席者永久 PENDING 空转，无报错）。
 * 编排体 boot 两代共用：0.1.7 路径经 makeScope 把 ConfigForm 适配为 SettingsScope，
 * 0.1.6 路径原栈 bind；卡片 / 排除命中判定 / 记忆监听两代零差别。
 * 席位按代际取子集（SEATS_NEW / SEATS_ALL）：0.1.7+ 不注册 settings.plugin.item
 * （该键自 0.1.6 起无宿主声明者，注册了也空转）。SlotMap 键经 models 包 declaration
 * merging 与本地 slot-contract.ts 提供；类型边全部 type-only（构建期擦除）。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// ctx.slots 服务面（SlotRegistry）
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// ctx.locale 服务面
import type {} from '@deepseek-ai/dsh-client-locale/client'
// ctx.settingsScope 服务面（0.1.6 及更早）
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// SlotMap 的 'settings.models.footer' 键声明合并
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
// SlotMap 的 'plugins.bundle.config'（0.1.6+）与 'settings.plugin.item'（0.1.2 系列）键声明（本地结构复制）
import type {} from '@/client/slot-contract'
// Connection RPC call 切片的结构复制（宿主包未装依赖；取服务沿用宿主 ui-settings-general 的 ctx.get 断言范式）
import type { ClientRpcCall } from '@/shared/types'
import { Card } from '@/client/card'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CARD_NS, en, zh } from '@/client/locales'
import { API_NS as PI_AI_NS, PLUGIN_NAME, PLUGIN_NS as MODEL_FIX_NS } from '@/shared/constants'
import { VERSION_KEY, decodeSection } from '@/client/model'
import type { Flags } from '@/client/model'
import { applyEffort, classifyTransition, sameSelection } from '@/client/effort'
import type { ModelDirectoriesLike, SelectionLike, SessionsLike } from '@/client/effort'
import { makeScope, type ConfigFormLike } from '@/client/scope.new'

/** 提供方 scope 的解码占位值：本卡只消费 snapshot.user（原始用户层），value 无用途；decode 必须永不返回 undefined */
const PROVIDERS_VIEW: readonly unknown[] = []

/** 席位名：0.1.7+ 注册的两个（settings.plugin.item 自 0.1.6 起无宿主声明者，不注册） */
const SEATS_NEW: readonly string[] = ['settings.models.footer', 'plugins.bundle.config']
/** 席位名：0.1.6 及更早的全量（「插件」选项卡的卡 0.1.5 及更早宿主继续可出现，0.1.6 上该席位空转） */
const SEATS_ALL: readonly string[] = ['settings.models.footer', 'settings.plugin.item', 'plugins.bundle.config']

export const name = PLUGIN_NAME
// 标记服务不进父级 inject：父 fiber 在缺席代际上会永久 PENDING，卡死整条插件链
export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: ClientContext): void {
    // 0.1.7+：configForms 存在 ⇒ 本 fiber 激活，新代 scope 适配后走 boot
    ctx.inject(['configForms'], (child) => {
        // 宿主 get 只收一个 entryId 参数（无 decode spec），段值解码由 makeScope 的 decode 完成
        const configForms = child.get('configForms') as {
            get: (ns: string) => ConfigFormLike
        }
        boot(ctx,
            makeScope(configForms.get(MODEL_FIX_NS), decodeSection),
            makeScope(configForms.get(PI_AI_NS), () => PROVIDERS_VIEW),
            SEATS_NEW,
        )
    })
    // 0.1.6 及更早：settingsScope 存在 ⇒ 本 fiber 激活，原栈 scope 直绑后走 boot
    ctx.inject(['settingsScope'], (child) => {
        const settingsScope = child.settingsScope
        boot(ctx,
            settingsScope.bind<Flags>({ namespace: MODEL_FIX_NS, decode: decodeSection }),
            settingsScope.bind<readonly unknown[]>({ namespace: PI_AI_NS, decode: () => PROVIDERS_VIEW }),
            SEATS_ALL,
        )
    })
}

/**
 * 两代宿主共用的编排体：词典注册、RPC 载体、席位注册、记忆监听子 fiber。
 * @param ctx - 父 fiber 的 ctx：共享编排一律在其上执行（ctx.<name> 属性读要求本 fiber
 *   声明过 inject，子 fiber 只声明了标记服务；子 ctx 只用于构造 scope）
 * @param scope - 本插件命名空间的 SettingsScope（卡片与记忆监听消费）
 * @param providersScope - llm-pi-ai 命名空间的 SettingsScope（只消费 user 层的提供方 id）
 * @param seats - 本宿主代际要注册的席位集合（缺声明者 slots.inject 空转）
 */
function boot(
    ctx: ClientContext,
    scope: SettingsScope<Flags> & { dispose?: () => void },
    providersScope: SettingsScope<readonly unknown[]> & { dispose?: () => void },
    seats: readonly string[],
): void {
    // 词典注册返回 disposer；经 effect 挂载，卸载/HMR 时自动撤销
    ctx.effect(() => ctx.locale.register(CARD_NS, { zh, en }), `${name}: card dictionaries`)
    // 适配器 scope（0.1.7 路径）的 form 订阅释放挂入本 fiber；0.1.6 宿主 scope 无 dispose（可选链跳过）
    const disposables = [scope.dispose?.bind(scope), providersScope.dispose?.bind(providersScope)].filter(Boolean) as Array<() => void>
    if (disposables.length) ctx.effect(() => () => { for (const dispose of disposables.splice(0)) dispose() }, `${name}: scope disposal`)
    // RPC channel 与 src/rpc.ts 的 `/${PLUGIN_NS}` 同源（同取 PLUGIN_NS 常量）；endpoint 名须与 rpc.ts 两侧同步
    const rpc = (ctx.get('connection') as { rpc: { call: ClientRpcCall } }).rpc
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
    // 席位先有声明方才能占格：无声明者时注册静默不发生 ⇒ 卡片/配置段不出现。
    // 单元格标识按 kind：list 席位用 id、keyed 席位用 key（footer/bundle 分别是配置 NS 与 npm 包名，
    // 不同 slot 即不同账本，无需后缀区分）；footer 以 order 排最前（list 渲染器按 order 单键重排）
    if (seats.includes('settings.models.footer')) {
        ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
            name: 'settings.models.footer',
            id: MODEL_FIX_NS,
            order: -999999,
            locale: CARD_NS,
        }, (props) => <Card {...props} scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))
    }
    if (seats.includes('settings.plugin.item')) {
        // 插件配置页把卡片渲在 <ul> 内（官方 PluginCard 即 <li>），故该席位的根元素须为 li
        ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
            name: 'settings.plugin.item',
            key: MODEL_FIX_NS,
            priority: -999999,
            locale: CARD_NS,
        }, (props) => <Card {...props} as="li" scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))
    }
    if (seats.includes('plugins.bundle.config')) {
        // 插件详情页的配置段：keyed 按 entryKey 分发，key 是 npm 包名（不是 patch 条目 id）
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
            name: 'plugins.bundle.config',
            key: name,
            locale: CARD_NS,
        }, (props) => <Card {...props} scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))
    }

    // 记忆监听子 fiber（宿主无 sessions/modelDirectories 时静默不启用）：纯监听，只订阅会话投影；
    // 自动设置经宿主公开 directory.select，保存经自有 NS 的 settings scope 直写
    ctx.inject(['sessions', 'modelDirectories'], (subCtx) => {
        const sessions = subCtx.get('sessions') as SessionsLike
        const modelDirectories = subCtx.get('modelDirectories') as ModelDirectoriesLike

        subCtx.effect(() => {
            /** 每会话的追踪状态 */
            interface Tracked {
                retainUnsub: (() => void) | null
                projectionUnsub: (() => void) | null
                lastNext: SelectionLike | null
                pendingAutoSet: SelectionLike | null
            }
            const tracked = new Map<string, Tracked>()

            /** 处理一次投影变化 */
            function handleProjection(id: string, entry: Tracked, next: SelectionLike | null): void {
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

                let dir: ReturnType<ModelDirectoriesLike['directoryFor']>
                try {
                    dir = modelDirectories.directoryFor(id)
                } catch {
                    // 宿主对未知/未保留会话 fail loud（显式抛错），此处跳过本次变化即可
                    return
                }
                const dirState = dir.store.getSnapshot()
                // 开关仅门控「保存」；恢复用的记忆始终取真实 efforts（是否清空由卡片交互决定）
                const rememberEfforts = scope.getSnapshot().value?.userExperience.rememberEfforts ?? true
                const memory = scope.getSnapshot().value?.efforts ?? {}
                const transition = classifyTransition(prev, next, memory, dirState.groups)

                if (transition.kind === 'model-change') {
                    if (transition.resolved.reasoningEffort !== next.reasoningEffort) {
                        entry.pendingAutoSet = transition.resolved
                        void dir.select(transition.resolved)
                    }
                } else if (transition.kind === 'effort-change' && rememberEfforts) {
                    void rememberEffort(next.provider, next.model, next.reasoningEffort ?? null)
                }
            }

            /** 对一个会话建立保留态 + 投影订阅 */
            function trackRetain(id: string): void {
                let entry = tracked.get(id)
                if (!entry) {
                    entry = { retainUnsub: null, projectionUnsub: null, lastNext: null, pendingAutoSet: null }
                    tracked.set(id, entry)
                }
                const retainInfo = sessions.retainInfo(id)
                entry.retainUnsub = retainInfo.subscribe(() => {
                    if (retainInfo.getSnapshot().referenceCount <= 0 || entry.projectionUnsub) return
                    const binding = sessions.binding(id)
                    if (!binding) return
                    const projection = binding.session.projections.faceOf('modelSelection')
                    const readNext = (): SelectionLike | null => (projection.getSnapshot() as { next?: SelectionLike | null } | null)?.next ?? null
                    entry.projectionUnsub = projection.subscribe(() => handleProjection(id, entry, readNext()))
                    // 订阅时先按当前值跑一次，避免已选模型要等下一次变化才恢复记忆
                    handleProjection(id, entry, readNext())
                })
            }

            /** 解绑一个会话的所有订阅 */
            function untrack(id: string): void {
                const entry = tracked.get(id)
                if (!entry) return
                entry.retainUnsub?.()
                entry.projectionUnsub?.()
                tracked.delete(id)
            }

            const listUnsub = sessions.list.subscribe(() => {
                const ids = new Set(sessions.list.getSnapshot().ids)
                for (const id of [...tracked.keys()]) {
                    if (!ids.has(id)) untrack(id)
                }
                for (const id of ids) {
                    if (!tracked.has(id)) trackRetain(id)
                }
            })

            return () => {
                listUnsub()
                for (const id of [...tracked.keys()]) untrack(id)
                tracked.clear()
            }
        }, `${name}: effort memory listener`)
    })
}
