/**
 * 异常文案的通用取法。
 *
 * 报错文案要进日志与状态行，而 `catch` 拿到的抛值类型是 `unknown`、不保证是 `Error`，
 * 故收口成一处：`Error` 取 `message`，其余退化为 `String()`。
 * 收在 shared 是因为两个半都要——Node 半记日志，浏览器半把失败原因写进弹层记录区。
 */

/** 取异常的展示文案：`Error` 取 `message`，其余退化为 `String(error)` */
export function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
