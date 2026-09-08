/**
 * 浏览器半入口（dsh.client 声明的 web 侧 cordis 插件）。
 * 职责：注册卡片词典（effect disposer 化，词典重复注册会抛错，HMR 安全）
 * → 绑定 tikaflow-model-fix 命名空间 scope（自带 decode，杜绝宿主 schema rehydrate 挂死）
 * → 取宿主 connection 服务的 RPC 载体（「强制更新」按钮触发 Node 半 force 填充，通道 /tikaflow-model-fix）
 * → 向「模型」选项卡底部槽 settings.models.footer 注册卡片（宿主依赖跟随宿主 latest，
 *   该槽在 peerDependencies 声明的下限版本上已存在；更旧宿主无此槽、卡片不出现，属预期不支持）。
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
// Connection RPC call 切片的结构复制（宿主包未装依赖；取服务沿用宿主 ui-settings-general 的 ctx.get 断言范式）
import type { ClientRpcCall } from '../types'
import { Card } from './card'
import { CARD_NS, en, zh } from './locales'
import { MODEL_FIX_NS, decodeSection } from './model'
import type { Flags } from './model'

export const name = 'dsh-model-fix'
export const inject = ['slots', 'locale', 'settingsScope', 'connection']

export function apply(ctx: ClientContext): void {
    // 词典注册返回 disposer；经 effect 挂载，卸载/HMR 时自动撤销
    ctx.effect(() => ctx.locale.register(CARD_NS, { zh, en }), `${name}: card dictionaries`)
    const scope = ctx.settingsScope.bind<Flags>({ namespace: MODEL_FIX_NS, decode: decodeSection })
    // 强制更新 RPC：channel 用浏览器半 NS 字面量拼（禁值导入 Node 半 constants），
    // 与 src/rpc.ts 的 `/${PLUGIN_NS}` 配对，改动须两侧同步
    const rpc = (ctx.get('connection') as { rpc: { call: ClientRpcCall } }).rpc
    const forceUpdate = () => rpc.call(`/${MODEL_FIX_NS}`, 'forceUpdate', {})
    // 槽仅在 ModelsSection 挂载期间存在，须经 slots.inject 等待声明后再 register；
    // list 槽 id 取本插件配置命名空间（新 NS），保证单元格唯一
    ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
        name: 'settings.models.footer',
        id: MODEL_FIX_NS,
        order: 100,
        locale: CARD_NS,
    }, (props) => <Card {...props} scope={scope} forceUpdate={forceUpdate} />))
}
