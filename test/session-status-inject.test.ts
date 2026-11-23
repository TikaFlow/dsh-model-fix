// client/session-status-inject.ts 纯函数测试（显式传版本，不依赖 window）
import { sessionStatusInject } from '@/client/session-status-inject'
import { check } from '@test/helper'

export function run(): void {
    check('新宿主追加会话状态服务',
        sessionStatusInject(['uiSession', 'sessions'], '0.2.3-alpha.1').join(',')
        === 'uiSession,sessions,uiSession.sessionStatus')
    check('新宿主后续版本同样追加',
        sessionStatusInject(['uiSession', 'sessions'], '0.2.3').join(',')
        === 'uiSession,sessions,uiSession.sessionStatus')
    check('旧宿主维持原列表',
        sessionStatusInject(['uiSession', 'sessions'], '0.2.2-rc.5').join(',')
        === 'uiSession,sessions')
    check('版本未知按未达处理',
        sessionStatusInject(['uiSession', 'sessions'], undefined).join(',')
        === 'uiSession,sessions')
    check('不改传入数组',
        (() => {
            const base = ['uiSession', 'sessions']
            sessionStatusInject(base, '0.2.3-alpha.1')
            return base.length === 2
        })())
}
