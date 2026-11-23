/** 「返回对话」悬浮按钮：点击回到主视图会话 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { IconChevronLeftOutlineRegular, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { UiSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { CARD_NS } from '@/client/locale-keys'
import type { LocalSettings } from '@/client/local-settings'
import { createFloatingButton } from '@/client/floating-button'
import type { FloatingButton } from '@/client/floating-button'
import { PLUGIN_NAME } from '@/shared/constants'
import { findChatTab, inspect, readStoredViewId, type BackTarget, IDLE_VIEW } from '@/client/session-view'
import { sessionStatusInject } from '@/client/session-status-inject'

const CHAT_VIEW_ID = 'chat'

/** uiWorkspace 服务的最小面 */
interface UiWorkspaceNav {
    openSession(sessionId: SessionId): void
}

function BackToChatIcon(props: { base: ReactNode }): ReactNode {
    const [hovered, setHovered] = useState(false)
    return (
        <span
            style={{ width: '100%', alignSelf: 'stretch', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
        >
            {hovered ? IconChevronLeftOutlineRegular({ size: 14 }) : props.base}
        </span>
    )
}

export function applyBackToChat(ctx: ClientContext, local: LocalSettings): FloatingButton {
    const t = ctx.locale.bind(CARD_NS)
    let selectPanel: ((panelId: string | null) => void) | null = null
    let openSession: ((sessionId: SessionId) => void) | null = null
    let isMainView: (() => boolean) | null = null
    let target: BackTarget | null = null
    let uiSession: UiSession | null = null
    let sessions: ISessions | null = null

    const button = createFloatingButton('back-to-chat', {
        icon: <BackToChatIcon base={IconChevronLeftOutlineRegular({ size: 14 })} />,
        title: t('backToChat'),
        active: false,
        onClick: () => {
            // 1) 子智能体视图 → 回到父会话（切 workspace 选择）
            if (target !== null && target.isChild && openSession !== null) {
                openSession(target.id)
                return
            }
            // 2) 主视图 + 根智能体 + 当前不在对话页签 → 切到对话页签
            if (target !== null && !target.isChild
                && isMainView?.() === true
                && readStoredViewId(target.id) !== CHAT_VIEW_ID) {
                findChatTab()?.click()
                return
            }
            // 3) 其余情况 → 宿主面板 null（从插件管理器等全局面板回到会话主视图）
            selectPanel?.(null)
        },
    })

    const syncActive = (): void => {
        button.set({
            active: selectPanel !== null && local.getSnapshot().backToChat,
        })
    }

    const syncStatus = (): void => {
        const { target: next, view } = uiSession === null || sessions === null
            ? { target: null, view: IDLE_VIEW }
            : inspect(uiSession, sessions)
        target = next
        const label = t(view.titleKey, view.params)
        const title = view.sessionTitle === undefined ? label : `${label} · ${view.sessionTitle}`
        if (view.state === 'idle') {
            button.set({ icon: <BackToChatIcon base={IconChevronLeftOutlineRegular({ size: 14 })} />, title })
            return
        }
        button.set({ icon: <BackToChatIcon base={<StateDot state={view.state} />} />, title })
    }


    ctx.effect(function* () {
        // subscribe 不推首值，先按当前快照补跑一次
        const unsubscribeLocal = local.subscribe(syncActive)
        yield unsubscribeLocal
        const unsubscribeLocale = ctx.locale.subscribe(syncStatus)
        yield unsubscribeLocale
        syncStatus()
    }, `${PLUGIN_NAME}: 返回对话 订阅`)

    ctx.inject(['layout'], (child) => {
        const layout = child.get('layout')
        selectPanel = (panelId) => { layout.selectPanel(panelId) }
        isMainView = () => layout.panelInfo.getSnapshot().activePanelId === null
        syncActive()
    })
    syncActive()
    ctx.inject(['uiWorkspace'], (child) => {
        openSession = (sessionId) => { (child.get('uiWorkspace') as UiWorkspaceNav).openSession(sessionId) }
    })
    ctx.inject(sessionStatusInject(['uiSession', 'sessions']), (child) => {
        child.effect(function* () {
            uiSession = child.get('uiSession') as UiSession
            sessions = child.get('sessions') as ISessions
            const offCurrent = uiSession.adapter.current.subscribe(syncStatus)
            yield offCurrent
            const offStatus = uiSession.sessionStatus.subscribe(syncStatus)
            yield offStatus
            const offList = sessions.list.subscribe(syncStatus)
            yield offList
            syncStatus()
        }, `${PLUGIN_NAME}: 返回对话 会话状态订阅`)
    })

    return button
}
