/**
 * 事件流守卫：重置/恢复的写回期间为 true。index.ts 的两个事件入口最先判定——
 * `settings/updated`（API_NS）与自身 NS 的 onChange（write 回推）——为 true 时整条事件链短路
 * （selfHeal / fix / refresh 全部跳过），防止写回触发填充把刚改动的字段重新写回。
 * 置位先于 mutate 同步完成（await 前），finally 解除后事件链恢复正常。
 */
let ignoreAll = false

/** 开启事件流守卫（写回前调用） */
export function startIgnoreAll(): void {
    ignoreAll = true
}

/** 解除事件流守卫（写回全部落盘后调用） */
export function endIgnoreAll(): void {
    ignoreAll = false
}

/** 事件流守卫是否生效 */
export function isIgnoreAll(): boolean {
    return ignoreAll
}
