/** 在宿主写入的 `<title>` 前叠一枚状态 emoji。宿主 DocumentTitle 独占 title 且无插槽，故用 MutationObserver 捕获后再叠加；判定见 `session-view.ts`。 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { UiSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { CardKey } from '@/client/locale-keys'
import type { LocalSettings } from '@/client/local-settings'
import { IDLE_VIEW, inspect, type SessionView } from '@/client/session-view'
import { sessionStatusInject } from '@/client/session-status-inject'
import { PLUGIN_NAME } from '@/shared/constants'

const STATUS_EMOJI: Partial<Record<CardKey, string>> = {
    backToChatRunning: '⏳',
    backToChatSubagentsOne: '⚙️',
    backToChatSubagentsOther: '⚙️',
    backToChatWaitingApproval: '🔔',
    backToChatPlanReview: '✋',
    backToChatWaitingAnswer: '❓',
    backToChatCompleted: '✅',
}

const IDLE_EMOJI = '👀'

export function applyTitleIndicator(ctx: ClientContext, local: LocalSettings): void {
    let base = typeof document === 'undefined' ? '' : document.title
    /** 跳过自身 mutation，防回环 */
    let lastWritten: string | null = null
    let view: SessionView = IDLE_VIEW
    let enabled = local.getSnapshot().showTitleIndicator

    const apply = (): void => {
        if (typeof document === 'undefined') return
        if (!enabled) {
            if (lastWritten !== null) {
                document.title = base
                lastWritten = null
            }
            return
        }
        const emoji = view.state === 'idle' ? IDLE_EMOJI : (STATUS_EMOJI[view.titleKey] ?? IDLE_EMOJI)
        document.title = `${emoji} · ${base}`
        lastWritten = document.title
    }

    let observer: MutationObserver | null = null
    const readStatus = (): void => {
        view = uiSession === null || sessions === null ? IDLE_VIEW : inspect(uiSession, sessions).view
        apply()
    }

    let uiSession: UiSession | null = null
    let sessions: ISessions | null = null

    ctx.effect(function* () {
        const offLocal = local.subscribe(() => {
            enabled = local.getSnapshot().showTitleIndicator
            apply()
        })
        yield offLocal
        observer = new MutationObserver(() => {
            if (document.title === lastWritten) return
            base = document.title
            apply()
        })
        observer.observe(document.head, { childList: true, subtree: true, characterData: true })
        yield () => {
            observer?.disconnect()
            observer = null
            if (typeof document !== 'undefined' && lastWritten !== null) document.title = base
            lastWritten = null
        }
    }, `${PLUGIN_NAME}: 浏览器标题前缀 observer`)

    ctx.inject(sessionStatusInject(['uiSession', 'sessions']), (child) => {
        child.effect(function* () {
            uiSession = child.get('uiSession') as UiSession
            sessions = child.get('sessions') as ISessions
            const offCurrent = uiSession.adapter.current.subscribe(readStatus)
            yield offCurrent
            const offStatus = uiSession.sessionStatus.subscribe(readStatus)
            yield offStatus
            const offList = sessions.list.subscribe(readStatus)
            yield offList
            readStatus()
        }, `${PLUGIN_NAME}: 浏览器标题前缀 会话状态订阅`)
    })
}
