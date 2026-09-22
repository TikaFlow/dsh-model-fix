/**
 * 浏览器半入口（dsh.client 声明的 web 侧 cordis 插件）。
 * 职责：注册卡片词典（effect disposer 化，词典重复注册会抛错，HMR 安全）
 * → 绑定 tikaflow-model-fix 命名空间 scope（自带 decode，杜绝宿主 schema rehydrate 挂死）
 * → 绑定宿主 llm-pi-ai 命名空间 scope（只取其 user 层的提供方 id，供「排除提供方」瓦片判定命中；
 *   与 Node 半 fix 遍历的是同一份数据，故零漂移。读全部走宿主共享 describe mirror，本绑定不新增 wire 读）
 * → 取宿主 connection 服务的 RPC 载体（「强制更新 / 重置模型 / 恢复备份」三按钮共用，通道 /tikaflow-model-fix）
 * → 起一条可选监听子 fiber（宿主有 sessions / modelDirectories 时）：订阅会话的模型选择投影，
 *   模型变化时经 directory.select 恢复该模型的记忆级别，级别变化时把记忆直写进自有 NS 的 efforts 字段
 *   （受配置 userExperience.rememberEfforts 开关：关掉时不再保存新记忆，恢复仍用既有记忆）
 * → 注册卡片到**三个**席位（同一组件、同一 scope）：
 *   ① 「模型」选项卡底部 list 席位 settings.models.footer（与提供方列表同页）；
 *   ② 「插件」→「插件配置」选项卡的 keyed 席位 settings.plugin.item（仅 0.1.2 系列宿主声明；与终端 / Agent 循环 /
 *      Subagent / 网页搜索等官方卡并列，key 即本插件配置命名空间——该席位按命名空间分发，宿主只把「已服务的命名空间」
 *      与「已注册的卡」求交后渲染，本插件的命名空间由 Node 半 installSection 提供）；
 *   ③ 插件管理页（0.1.6+ 与「设置」平行的顶级入口）「已安装」组里本 bundle 详情页的 keyed 席位
 *      plugins.bundle.config：该页已按 npm 包名自动列出本 bundle，本席位把配置体填进其详情页的描述
 *      与 rows 之间（标题 / 简介 / 面包屑 / 开关均由页面自绘）。宿主 settings 页同时只挂载一个
 *      section，故①②不会双实例并存；③与②互斥（0.1.6+ 不再有 settings.plugin.item 的声明方），故亦不并存。
 *   ①②在宿主 peerDependencies 声明的下限版本上即已存在；③需要 0.1.6 起的插件管理页，更旧的宿主上
 *   该席位无声明方、配置段不出现，属预期不支持。
 * 类型边全部 type-only（构建期擦除，不违反跨插件纯度纪律）。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// ctx.slots 服务面（SlotRegistry）
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// ctx.locale 服务面
import type {} from '@deepseek-ai/dsh-client-locale/client'
// ctx.settingsScope 服务面
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// SlotMap 的 'settings.models.footer' 键声明合并
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
// SlotMap 的 'plugins.bundle.config'（0.1.6+）与 'settings.plugin.item'（0.1.2 系列）键声明（本地结构复制）
import type {} from './slot-contract'
// Connection RPC call 切片的结构复制（宿主包未装依赖；取服务沿用宿主 ui-settings-general 的 ctx.get 断言范式）
import type { ClientRpcCall } from '../shared/types'
import { Card } from './card'
import { CARD_NS, en, zh } from './locales'
import { MODEL_FIX_NS, PI_AI_NS, VERSION_KEY, decodeSection } from './model'
import type { Flags } from './model'
import { applyEffort, classifyTransition, sameSelection } from './effort'
import type { ModelDirectoriesLike, SelectionLike, SessionsLike } from './effort'

/** 提供方 scope 的解码占位值：本卡只消费 snapshot.user（原始用户层），value 无用途；decode 必须永不返回 undefined */
const PROVIDERS_VIEW: readonly unknown[] = []

export const name = 'dsh-model-fix'
export const inject = ['slots', 'locale', 'settingsScope', 'connection']

export function apply(ctx: ClientContext): void {
    // 词典注册返回 disposer；经 effect 挂载，卸载/HMR 时自动撤销
    ctx.effect(() => ctx.locale.register(CARD_NS, { zh, en }), `${name}: card dictionaries`)
    const scope = ctx.settingsScope.bind<Flags>({ namespace: MODEL_FIX_NS, decode: decodeSection })
    // 提供方 id 来源：user 层随宿主 settings/invalidation 推送自动更新，卡片订阅即可拿到最新命中状态
    const providersScope = ctx.settingsScope.bind<readonly unknown[]>({ namespace: PI_AI_NS, decode: () => PROVIDERS_VIEW })
    // 强制更新 / 重置模型 / 恢复备份 RPC：channel 用浏览器半 NS 字面量拼（禁值导入 Node 半 constants），
    // 与 src/rpc.ts 的 `/${PLUGIN_NS}` 配对（endpoint 名须与 rpc.ts 两侧同步），改动须两侧同步
    const rpc = (ctx.get('connection') as { rpc: { call: ClientRpcCall } }).rpc
    const forceUpdate = () => rpc.call(`/${MODEL_FIX_NS}`, 'forceUpdate', {})
    const resetModels = () => rpc.call(`/${MODEL_FIX_NS}`, 'resetModels', {})
    const restoreModels = () => rpc.call(`/${MODEL_FIX_NS}`, 'restoreModels', {})
    // 每模型推理级别记忆经自有 NS 的 settings scope 直写：记忆是自有 NS 的一个字段，与卡片「保存」
    // 走同一条已验证的写路径。整段 efforts 重写，且**空记忆也写 `{}` 而非删键**——
    // 与「快照即使是默认值也整份写入」同一原则，保证该字段在文件里恒存在、形态恒定。
    const rememberEffort = (provider: string, model: string, effort: string | null): void => {
        const next = applyEffort(scope.getSnapshot().value?.efforts ?? {}, provider, model, effort)
        // 记忆写入失败不影响会话本身（级别已在当前会话生效），故只吞掉 rejection
        void scope.mutate([{ op: 'set', path: [VERSION_KEY, 'efforts'], value: next }]).catch(() => {})
    }
    // 三个席位都要先有声明方才能占格，故经 slots.inject 等声明后再 register
    //（宿主版本过旧时没有对应声明方，注册静默不发生 ⇒ 卡片/配置段不出现）；
    // 单元格标识各按其 kind 的字段：list 席位用 id、keyed 席位用 key；标识值上 ①②都是本插件配置
    // 命名空间、③是 bundle 的 npm 包名（不同 slot 即不同账本，无需加后缀区分）。
    // ①②都以 -999999 排到各自列表最前（宿主对 priority/order 一律"越小越靠前"，官方卡都是默认 0），
    // 但各按自己 kind 的主键声明：list 席位的账本按 priority→order 排完，渲染器又按 order 单键稳定重排一次
    // ⇒ 起作用的是 order（priority 只在同 order 时当平手判据，碰撞概率极低，不抢）；
    // keyed 席位渲染器不排序、直接用账本序 ⇒ 只有 priority 参与。
    ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
        name: 'settings.models.footer',
        id: MODEL_FIX_NS,
        order: -999999,
        locale: CARD_NS,
    }, (props) => <Card {...props} scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))
    // 插件配置页把卡片渲在 <ul> 内（官方 PluginCard 即 <li>），故该席位的根元素须为 li。
    // 本 key 独占单元格，priority 的"同格遮蔽"语义在此不参与，只借它的排序效果
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: MODEL_FIX_NS,
        priority: -999999,
        locale: CARD_NS,
    }, (props) => <Card {...props} as="li" scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))
    // 插件管理页（0.1.6+）「已安装」组里本 bundle 详情页的配置段：keyed 席位按 entryKey 分发，
    // key 是 bundle 的 npm 包名（profile manifest 的依赖键，不是 patch 里的条目 id）；
    // 页面自绘面包屑 / 标题 / 简介 / 开关且只要 view:'page'，故不声明 label/order/priority。
    // 该席位不与命名空间求交，命名空间未服务时配置段仍在、显示不可用行——发现性优先于隐藏
    ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: name,
        locale: CARD_NS,
    }, (props) => <Card {...props} scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} resetModels={resetModels} restoreModels={restoreModels} />))

    // 每模型推理级别记忆监听器（可选子 fiber：宿主无 sessions / modelDirectories 服务时静默不启用）。
    // 纯监听——不 hook 宿主任何方法，只订阅会话投影可观察值；自动设置经宿主公开 directory.select，
    // 保存经自有 NS 的 settings scope 直写。无 UI。
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
                // 记住推理级别开关：仅门控「保存」——为 false 时 effort-change 跳过写入；
                // 恢复用的记忆始终取真实 efforts（关闭时是否清空由卡片交互决定，见 card.tsx）
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
