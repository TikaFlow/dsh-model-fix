/** 卡片内联状态行助手：Notice 形状、全卡共用占用态 CardBusy、文案截断与写回超时判定。 */

/** 全部写操作共用的占用态 */
export type CardBusy = 'save' | 'force' | 'restore' | 'clear' | 'verify' | 'probe' | null

/** 内联状态行：文本 + 色调（success 映射宿主 .savedNotice 绿，error 映射 .error 红） */
export interface Notice {
    text: string
    tone: 'success' | 'error'
}

const NOTICE_MAX_CHARS = 120

/** 超长截断到上限并补省略号 */
export function truncateMessage(value: string): string {
    return value.length > NOTICE_MAX_CHARS ? `${value.slice(0, NOTICE_MAX_CHARS - 1)}…` : value
}

/** DOMException 不继承 Error，写回超时只能按 DOMException 判 */
export function isWritebackTimeout(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'TimeoutError'
}

/** 目录新鲜度提示文案：有效时间戳 → 前缀 + 本地时间 */
export function catalogFreshnessText(value: unknown, prefix: string): string | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return
    const pad = (part: number): string => String(part).padStart(2, '0')
    return `${prefix}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
