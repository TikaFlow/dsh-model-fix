// guard.ts 测试：事件流守卫的开关语义
import { startIgnoreAll, endIgnoreAll, isIgnoreAll } from '../src/guard'
import { check } from './helper'

/** 执行本文件的全部用例 */
export function run(): void {
    check('守卫初始为 false', isIgnoreAll() === false)
    startIgnoreAll()
    check('startIgnoreAll 后为 true', isIgnoreAll() === true)
    endIgnoreAll()
    check('endIgnoreAll 后为 false', isIgnoreAll() === false)
}
