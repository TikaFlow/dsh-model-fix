/** 可见性开关的执行面：按本机开关把四个部件真正挂载 / 卸载。
 * 必须装卸而非组件内显隐：宿主 tab 头按注册账本画出，返回 `null` 只会空内容、tab 头照旧（见 docs/decisions-ui.md「卡片与编排」）。 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { DecodedScope } from '@/client/scope'
import { CARD_NS } from '@/client/locale-keys'
import { PLUGIN_NS as MODEL_FIX_NS } from '@/shared/constants'
import { ComposerEntry, FollowLamp, type ComposerProps } from '@/client/composer'
import { Card, type CardProps } from '@/client/card'
import type { Flags } from '@/client/model'
import type { LocalFlagId, LocalSettings } from '@/client/local-settings'

type ManagedSlot = 'settings.models.footer' | 'settings.plugins.tab' | 'conversation.input.left'

interface Part {
    slot: ManagedSlot
    /** 同时用作 mounted 账本的键 */
    key: string
    flag: LocalFlagId
    mount: () => () => void
}

type SharedCardProps = Omit<CardProps, 't' | 'scope' | 'local' | 'providersScope'>

/** 足够小以排在全部既有条目之前 */
const FOOTER_ORDER = -999999
const TAB_ORDER = 20
const COMPOSER_ORDER = 5
const FOLLOW_ORDER = 6

/** `ctx` 是子 fiber ctx：注册与订阅都挂它，卸载即级联撤销 */
export function applySlotVisibility(
    ctx: ClientContext,
    scope: DecodedScope<Flags>,
    local: LocalSettings,
    shared: SharedCardProps,
    composerProps: Omit<ComposerProps, 'cardProps'>,
): void {
    const t = ctx.locale.bind(CARD_NS)
    const card = { ...shared, scope, local, providersScope: composerProps.providersScope }
    // 当前挂载着的 disposer；undefined 即未挂载
    const mounted = new Map<string, (() => void) | undefined>()

    const parts: readonly Part[] = [
        {
            slot: 'settings.models.footer',
            key: 'modelsFooter',
            flag: 'showInModels',
            mount: () => ctx.slots.register({
                name: 'settings.models.footer',
                id: MODEL_FIX_NS,
                order: FOOTER_ORDER,
                locale: CARD_NS,
            }, (props) => <Card {...card} {...props} />),
        },
        {
            slot: 'settings.plugins.tab',
            key: 'builtinPluginsTab',
            flag: 'showInBuiltinPlugins',
            mount: () => ctx.slots.register({
                name: 'settings.plugins.tab',
                id: MODEL_FIX_NS,
                order: TAB_ORDER,
                // thunk：section 每次读账本时求值，切语言即跟随
                label: () => t('tabLabel'),
                locale: CARD_NS,
            }, (props) => <Card {...card} defaultOpen {...props} />),
        },
        {
            slot: 'conversation.input.left',
            key: 'composerEntry',
            flag: 'showInComposer',
            mount: () => ctx.slots.register({
                name: 'conversation.input.left',
                id: `${MODEL_FIX_NS}-entry`,
                order: COMPOSER_ORDER,
                locale: CARD_NS,
            }, (props) => <ComposerEntry {...props} {...composerProps} cardProps={card} />),
        },
        {
            slot: 'conversation.input.left',
            key: 'followLamp',
            flag: 'showFollowStatus',
            mount: () => ctx.slots.register({
                name: 'conversation.input.left',
                id: `${MODEL_FIX_NS}-follow`,
                order: FOLLOW_ORDER,
                locale: CARD_NS,
            }, (props) => <FollowLamp {...props} {...composerProps} cardProps={card} />),
        },
    ]

    const reconcileOne = (key: string): void => {
        const part = parts.find((p) => p.key === key)
        // 编排表是本文件的字面量，key 必在其中；缺失即内部错误
        if (part === undefined) return
        const dispose = mounted.get(key)
        if (local.getSnapshot()[part.flag]) {
            if (dispose === undefined) mounted.set(key, part.mount())
        } else if (dispose !== undefined) {
            dispose()
            mounted.set(key, undefined)
        }
    }

    for (const slot of new Set(parts.map((p) => p.slot))) {
        const keys = parts.filter((p) => p.slot === slot).map((p) => p.key)
        ctx.slots.inject(slot, () => {
            for (const key of keys) reconcileOne(key)
            // subscribe 只推失效通知、不推首值，故上面已按当前快照补跑一遍
            const unsubscribe = local.subscribe(() => { for (const key of keys) reconcileOne(key) })
            return () => {
                unsubscribe()
                for (const key of keys) {
                    mounted.get(key)?.()
                    mounted.set(key, undefined)
                }
            }
        })
    }
}
