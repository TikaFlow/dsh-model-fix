/**
 * 浏览器半入口（dsh.client 声明的 web 侧 cordis 插件）。
 * 职责：注册卡片词典（effect disposer 化，词典重复注册会抛错，HMR 安全）
 * → 绑定 tikaflow-model-fix 命名空间 scope（自带 decode，杜绝宿主 schema rehydrate 挂死）
 * → 绑定宿主 llm-pi-ai 命名空间 scope（只取其 user 层的提供方 id，供「排除提供方」瓦片判定命中；
 *   与 Node 半 fix 遍历的是同一份数据，故零漂移。读全部走宿主共享 describe mirror，本绑定不新增 wire 读）
 * → 取宿主 connection 服务的 RPC 载体（「强制更新」按钮触发 Node 半 force 填充，通道 /tikaflow-model-fix）
 * → 注册卡片到**两个**席位（同一组件、同一 scope，宿主 settings 页同时只挂载一个 section，故不会双实例并存）：
 *   ① 「模型」选项卡底部 list 席位 settings.models.footer（与提供方列表同页）；
 *   ② 「插件」→「插件配置」选项卡的 keyed 席位 settings.plugin.item（与终端 / Agent 循环 / Subagent /
 *      网页搜索等官方卡并列，key 即本插件配置命名空间——该席位按命名空间分发，宿主只把「已服务的命名空间」
 *      与「已注册的卡」求交后渲染，本插件的命名空间由 Node 半 installSection 提供）。
 *   两处注册在宿主 peerDependencies 声明的下限版本上均已存在；更旧宿主无该席位、卡片不出现，属预期不支持。
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
// SlotMap 的 'settings.plugin.item' 键声明合并（keyed：注册用 key 而非 id）
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
// Connection RPC call 切片的结构复制（宿主包未装依赖；取服务沿用宿主 ui-settings-general 的 ctx.get 断言范式）
import type { ClientRpcCall } from '../types'
import { Card } from './card'
import { CARD_NS, en, zh } from './locales'
import { MODEL_FIX_NS, PI_AI_NS, decodeSection } from './model'
import type { Flags } from './model'

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
    // 强制更新 RPC：channel 用浏览器半 NS 字面量拼（禁值导入 Node 半 constants），
    // 与 src/rpc.ts 的 `/${PLUGIN_NS}` 配对，改动须两侧同步
    const rpc = (ctx.get('connection') as { rpc: { call: ClientRpcCall } }).rpc
    const forceUpdate = () => rpc.call(`/${MODEL_FIX_NS}`, 'forceUpdate', {})
    // 两个席位都只在对应 section 挂载期间存在，须经 slots.inject 等待声明后再 register；
    // 单元格标识各按其 kind 的字段：list 席位用 id、keyed 席位用 key（= 本插件配置命名空间）。
    // 两处都以 -999999 排到各自列表最前（宿主对 priority/order 一律"越小越靠前"，官方卡都是默认 0），
    // 但各按自己 kind 的主键声明：list 席位的账本按 priority→order 排完，渲染器又按 order 单键稳定重排一次
    // ⇒ 起作用的是 order（priority 只在同 order 时当平手判据，碰撞概率极低，不抢）；
    // keyed 席位渲染器不排序、直接用账本序 ⇒ 只有 priority 参与。
    ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
        name: 'settings.models.footer',
        id: MODEL_FIX_NS,
        order: -999999,
        locale: CARD_NS,
    }, (props) => <Card {...props} scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} />))
    // 插件配置页把卡片渲在 <ul> 内（官方 PluginCard 即 <li>），故该席位的根元素须为 li。
    // 本 key 独占单元格，priority 的"同格遮蔽"语义在此不参与，只借它的排序效果
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
        name: 'settings.plugin.item',
        key: MODEL_FIX_NS,
        priority: -999999,
        locale: CARD_NS,
    }, (props) => <Card {...props} as="li" scope={scope} providersScope={providersScope} forceUpdate={forceUpdate} />))
}
