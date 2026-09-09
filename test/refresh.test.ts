// refresh.ts 纯函数测试：保鲜窗口判定（事件驱动刷新是否需要拉取）
import { isStaleRefresh } from '../src/refresh'
import { REFRESH_INTERVAL_MS } from '../src/constants'
import { check } from './helper'

/** 执行本文件的全部用例 */
export function run(): void {
    const now = 1_000_000_000
    // 尚未成功拉取过（时间戳为 0）视为过期：启动后的首次事件即触发自愈拉取
    check('时间戳为 0 视为过期', isStaleRefresh(0, now) === true)
    // 恰好达到窗口视为过期（>= 语义），差一毫秒仍在保鲜期内
    check('达到窗口即过期', isStaleRefresh(now - REFRESH_INTERVAL_MS, now) === true)
    check('未达窗口不拉取', isStaleRefresh(now - REFRESH_INTERVAL_MS + 1, now) === false)
    // 时钟回拨（now 小于时间戳）差值为负，不满足 >= 窗口 ⇒ 不拉取（宁少拉不多拉）
    check('时钟回拨不触发拉取', isStaleRefresh(now + 1000, now) === false)
}
