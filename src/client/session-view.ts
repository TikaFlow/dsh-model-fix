/** 当前会话状态的共享投影，判定与宿主工作区会话行一致（契约见 docs/host/client.md「uiSession」）。 */

import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UiSession } from '@deepseek-ai/dsh-client-ui-session/client'
import type { ISessions, SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CardKey } from '@/client/locale-keys'

/** 返回目标：子智能体视图取直接父，否则当前会话自己 */
export interface BackTarget {
    readonly id: SessionId
    readonly isChild: boolean
}

export interface SessionView {
    state: StateDotState
    titleKey: CardKey
    params?: Record<string, unknown>
    sessionTitle?: string
}

/** 复制契约：宿主 subagent 类型面会把 Node 侧 session 增补带进来 */
interface SubagentCatalogValues {
    readonly subagentCatalog?: readonly { readonly id: SessionId }[]
}

/** 找宿主的「对话」页签按钮（页签条内首枚即「对话」） */
export function findChatTab(): HTMLButtonElement | null {
    if (typeof document === 'undefined') return null
    const strip = document.querySelector('[data-conversation-tabs]')
    if (strip === null) return null
    return strip.querySelector<HTMLButtonElement>('button[role="tab"]')
}

/** 读某 session 持久化的 view 偏好（宿主持有的真实 view id） */
export function readStoredViewId(sessionId: SessionId): string | null {
    if (typeof localStorage === 'undefined') return null
    try {
        const raw = localStorage.getItem(`dsh.conversation.${sessionId}`)
        if (raw === null) return null
        const stored: unknown = JSON.parse(raw)
        if (typeof stored !== 'object' || stored === null) return null
        const view = (stored as { view?: unknown }).view
        return typeof view === 'string' ? view : null
    } catch {
        return null
    }
}

/** 宿主工作区只认这三种待交互 */
function pendingTitleKey(kind: string | undefined): CardKey | undefined {
    switch (kind) {
        case 'approval': return 'backToChatWaitingApproval'
        case 'plan-review': return 'backToChatPlanReview'
        case 'question': return 'backToChatWaitingAnswer'
        default: return undefined
    }
}

/** 进行中的提示：子智能体在跑时点态同为 ongoing，靠文案区分 */
function runningTitle(subagents: number): { titleKey: CardKey; params?: Record<string, unknown> } {
    if (subagents <= 0) return { titleKey: 'backToChatRunning' }
    return {
        titleKey: subagents === 1 ? 'backToChatSubagentsOne' : 'backToChatSubagentsOther',
        params: { n: subagents },
    }
}

/** fork 子会话也带 parentId 但 origin 不是 'subagent' */
function backTarget(list: SessionListState, currentId: SessionId): BackTarget {
    const row = list.byId[currentId]
    const parentId = row?.origin === 'subagent' ? row.parentId : undefined
    return parentId === undefined ? { id: currentId, isChild: false } : { id: parentId, isChild: true }
}

/** 服务缺席 / 无当前会话时的展示 */
export const IDLE_VIEW: SessionView = { state: 'idle', titleKey: 'backToChat' }

/** 返回目标及其状态：判定与宿主工作区会话行一致 */
export function inspect(uiSession: UiSession, sessions: ISessions): { target: BackTarget | null; view: SessionView } {
    const currentId = uiSession.adapter.current.getSnapshot().props.sessionId as SessionId | undefined
    const list = sessions.list.getSnapshot()
    if (currentId === undefined) return { target: null, view: IDLE_VIEW }
    const target = backTarget(list, currentId)
    const statuses = uiSession.sessionStatus.getSnapshot()
    const status = statuses.get(target.id)
    const values = list.projectionsBySession[target.id]?.values as SubagentCatalogValues | undefined
    const subagents = (values?.subagentCatalog ?? []).filter(
        (child) => (statuses.get(child.id)?.running ?? list.byId[child.id]?.running) === true,
    ).length
    const pending = pendingTitleKey(status?.pendingInteraction?.kind)
    const sessionTitle = list.byId[target.id]?.displayTitle
    if (pending !== undefined) return { target, view: { state: 'warning', titleKey: pending, sessionTitle } }
    if (status?.running === true) return { target, view: { state: 'ongoing', ...runningTitle(subagents), sessionTitle } }
    if (subagents > 0) return { target, view: { state: 'ongoing', ...runningTitle(subagents), sessionTitle } }
    // 目标非主视图会话时宿主才置 completionUnread
    if (status?.completionUnread === true) {
        return { target, view: { state: 'done', titleKey: 'backToChatCompleted', sessionTitle } }
    }
    return { target, view: { state: 'idle', titleKey: 'backToChat', sessionTitle } }
}
