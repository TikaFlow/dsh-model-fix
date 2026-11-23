/** 按宿主版本二选一：新版必须声明 uiSession.sessionStatus，旧版声明它会永久 PENDING；阈值见 HOST_SESSION_STATUS_SERVICE_SINCE。 */

import { HOST_SESSION_STATUS_SERVICE_SINCE } from '@/shared/constants'
import { clientVersionNow, versionSince } from '@/shared/version'

/** 读取会话状态的 fiber 可用的 inject 列表；hostVersion 省略时现场读宿主版本。 */
export function sessionStatusInject(base: readonly string[], hostVersion?: string): string[] {
    const list = [...base]
    if (versionSince(hostVersion ?? clientVersionNow(), HOST_SESSION_STATUS_SERVICE_SINCE)) {
        list.push('uiSession.sessionStatus')
    }
    return list
}
