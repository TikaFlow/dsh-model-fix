/**
 * 浏览器↔宿主 channel 路由：由本插件自注册前缀路由，而不是用宿主 `connection.rpc.handle`。
 *
 * 不用宿主通道的原因：`handle` 在**服务自己的 ctx** 上求值 `owner.webServer`
 * （`get rpc() { const owner = this.ctx }`，与调用方 fiber 无关），而 connection 插件的
 * `inject` 自 0.1.5 起不再含 webServer（0.1.2-rc.1 时含），故 `owner.webServer` 必抛
 * `cannot get property "webServer" without inject`，通道无从挂上。
 *
 * 与宿主通道逐项等价：同一把信任围栏（`connection.requestRejection`）+ 同一套信封与状态码
 * （宿主 `rpcFetchHandler` 的字面复制），故浏览器半的 `connection.rpc.call` 无需感知。
 * 该契约跨宿主版本稳定（0.1.2-rc.1 与 0.1.6-alpha.2 的 `rpcFetchHandler` / 两个信封 schema /
 * `ENDPOINT_SEGMENT_PATTERN` / `webServer.register` / `match` 逐字一致），故单一路径即覆盖全支持范围。
 */

import type { HostHttpRequest, HostHttpResponse, HostRequestRejection, RpcResult } from '@/shared/types'

/** endpoint 段名允许的字符（宿主 ENDPOINT_SEGMENT_PATTERN 的字面复制） */
const ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/
/** 信封不合法且回显不出 rpcId 时的占位（宿主 INVALID_REQUEST_RPC_ID 的字面复制） */
const INVALID_RPC_ID = 'invalid-request'
/** 请求体上限：三个端点的 payload 都是小对象，设上限防无界缓冲 */
const MAX_BODY_BYTES = 64 * 1024

/** 端点处理函数（与宿主 ConnectionRpcHandler 同形） */
export type EndpointHandler = (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>

/** 从 channel 前缀路由的 pathname 切出 endpoint；越界、空段或非法字符返回 undefined */
export function endpointOf(pathname: string, channel: string): string | undefined {
    if (!pathname.startsWith(`${channel}/`)) return undefined
    const endpoint = pathname.slice(channel.length + 1)
    if (endpoint.split('/').some((segment) => segment === '' || segment === '.' || segment === '..' || !ENDPOINT_SEGMENT.test(segment))) return undefined
    return endpoint
}

/** 解析客户端请求信封；形状不符返回 undefined */
export function parseClientRequest(value: unknown): { rpcId: string; method: string; payload: unknown } | undefined {
    if (typeof value !== 'object' || value === null) return undefined
    const { type, rpcId, method, payload } = value as Record<string, unknown>
    if (type !== 'client-request' || typeof rpcId !== 'string' || typeof method !== 'string') return undefined
    return { rpcId, method, payload }
}

/** 构造服务端响应信封 */
export function serverResponse(rpcId: string, result: RpcResult<unknown>): Record<string, unknown> {
    return { type: 'server-response', rpcId, result }
}

/** 信封不合法时的回执 id：能回显字符串 rpcId 就回显，否则用占位 */
export function envelopeRpcId(value: unknown): string {
    const rpcId = (value as { rpcId?: unknown } | null)?.rpcId
    return typeof rpcId === 'string' ? rpcId : INVALID_RPC_ID
}

/** 构造本 channel 的前缀路由处理器（围栏 → 读体 → 解信封 → 调 handler → 回信封） */
export function createChannelRoute(
    connection: { requestRejection: HostRequestRejection },
    channel: string,
    handler: EndpointHandler,
): (req: HostHttpRequest, res: HostHttpResponse) => Promise<void> {
    const respond = (res: HostHttpResponse, status: number, body: string): void => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(body)
    }
    const badRequest = (res: HostHttpResponse, rpcId: string, message: string): void => {
        respond(res, 200, JSON.stringify(serverResponse(rpcId, { ok: false, error: { code: 'gateway/bad-request', message, details: {} } })))
    }
    return async (req, res) => {
        // 与宿主 /api 路由同一把围栏：非受信来源 403、浏览器会话未认证 401
        const rejection = connection.requestRejection(req)
        if (rejection !== undefined) {
            res.writeHead(rejection)
            res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
            return
        }
        if (req.method !== 'POST') {
            res.writeHead(404)
            res.end()
            return
        }
        const rawContentType = req.headers['content-type']
        const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType) ?? ''
        if (contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
            res.writeHead(415)
            res.end()
            return
        }
        let raw: string
        try {
            raw = await readBody(req)
        } catch {
            res.writeHead(413)
            res.end()
            return
        }
        let body: unknown
        try {
            body = JSON.parse(raw)
        } catch {
            res.writeHead(400)
            res.end()
            return
        }
        const endpoint = endpointOf(new URL(req.url ?? '/', 'http://dsh.internal').pathname, channel)
        if (endpoint === undefined) {
            res.writeHead(404)
            res.end()
            return
        }
        const request = parseClientRequest(body)
        if (request === undefined) {
            badRequest(res, envelopeRpcId(body), 'invalid client-request message')
            return
        }
        if (request.method !== endpoint) {
            badRequest(res, request.rpcId, `method ${JSON.stringify(request.method)} does not match endpoint ${JSON.stringify(endpoint)}`)
            return
        }
        try {
            respond(res, 200, JSON.stringify(serverResponse(request.rpcId, await handler(endpoint, request.payload, new AbortController().signal))))
        } catch (error) {
            res.writeHead(500)
            res.end(`handler failure: ${String(error)}`)
        }
    }
}

/** 读完请求体；超上限即拒绝 */
function readBody(req: HostHttpRequest): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let size = 0
        req.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > MAX_BODY_BYTES) {
                reject(new Error('request body too large'))
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
    })
}
