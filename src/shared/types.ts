/**
 * 跨半共享的类型声明与纯类型守卫（零 Node 依赖、零 schemastery、零非基线 `@deepseek-ai/*`）。
 * 两半均**直连**本层（统一经 `@/shared/types` 别名导入），不经任何 facade 中转；
 * Node 专属类型（`ModelEntry` / `CacheRecord` / 冻结历史 v1–v4 / `isCapacity` 等）留在 `src/types.ts`。
 *
 * `isPlainObject` / `providersOf` 是值导出（两半均用），必须保持纯函数。Connection RPC 契约类型是宿主
 * `@deepseek-ai/dsh-client-connection` / `dsh-host-webserver` 的**结构本地复制**而非依赖：
 * 仅 type-only 使用（运行期服务经 `ctx` 注入取得，不 import 宿主值），宿主契约变化时须同步本段。
 */

/** 判断是否为普通数据对象（非数组、非 null、非类实例） */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const proto: unknown = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

/**
 * 从 `llm-pi-ai` 的 user 层收窄取 `providers` 段（Node 半 restore 的捕获/恢复与浏览器半 `providerIdsOf`
 * 的命中判定共用同一口径，杜绝两处形状错配）。user 非纯对象、无 providers 或 providers 非纯对象一律返回 undefined。
 */
export function providersOf(user: unknown): Record<string, unknown> | undefined {
    if (!isPlainObject(user)) return undefined
    const providers = user.providers
    return isPlainObject(providers) ? providers : undefined
}

/** 按字段分别控制的规则开关 */
export interface FieldRules {
    /** 推理级别字段 */
    reasoning: boolean
    /** 上下文窗口与输出上限，二者一体受此开关控制 */
    context: boolean
    /** 图片/多模态（input 模态声明） */
    image: boolean
}

/**
 * 兼容性规则：每条对应宿主 provider 路由 compat 下的一个字段（当前仅 supportsDeveloperRole）。
 * 同组新增键对既有形态只是「多一个可选字段」，向后兼容，因此不需要递增 CONFIG_VERSION。
 */
export interface CompatRules {
    /**
     * 为 true 时给该 provider 的路由写入 `compat.supportsDeveloperRole: false`（不使用 developer 角色，
     * 退回旧版 API 兼容的 system 角色）；为 false 时**移除**该字段（而非保留不管）。
     * 仅作用于 `api === 'openai-completions'` 的路由，且只写路由级、不写模型级。
     */
    disableDeveloper: boolean
}

/**
 * 用户体验规则：纯前端行为开关（不写入提供方/模型数据）。
 * 与填充规则不同，该组作用于会话侧操作、对所有提供方一致，**不支持按提供方排除**（见卡片释义）。
 */
export interface UserExperienceRules {
    /**
     * 记住每模型上次手动选择的推理级别并在切换模型时自动恢复；
     * 为 false 时前端不再保存新的记忆，但已记住的仍会自动恢复（关闭开关时卡片会询问是否清空，清空后即无记忆可恢复）。
     */
    rememberEfforts: boolean
    /**
     * 切换模型时若未设置推理级别、也无记住的级别、且目标模型公告 `high` 档位，则自动把推理级别设为 `high`。
     * 仅在「model-change」分支生效，不干预同模型切换级别（effort-change，含手动选「default」）。
     * 默认 false。
     */
    defaultHigh: boolean
}

/** 每模型推理级别记忆：provider id → model id → harness ModelThinkingLevel 字符串 */
export type EffortMemory = Record<string, Record<string, string>>

/** 当前运行时配置（仅对象写法） */
export interface PluginConfig {
    /** 开启后以 models.dev 最新数据为准更新已有配置 */
    allowUpdate: FieldRules
    /** 开启后自动填充缺失的推理级别/容量/图片字段 */
    autoFill: FieldRules
    /** 兼容性规则，作用于 provider 路由的 compat（与模型参数填充无关，不受 allowUpdate/autoFill 影响） */
    compat: CompatRules
    /**
     * 排除的提供方 id：命中的提供方本插件**不做任何操作**（填充、覆盖、compat 增删、强制更新一律跳过），
     * 等效于对该提供方关闭插件。语义是**预防性**的：只影响本值生效之后的行为，
     * 此前已写入的模型参数与路由 compat 一律保留、不撤销（插件无字段来源记录，无从区分插件写入与用户手写）。
     */
    excludes: string[]
    /**
     * 每模型推理级别记忆：provider → model → 级别。运行时记忆而非用户配置，
     * 结构非法时解析侧宽松回落 {}（不让记忆坏值连累配置自愈重写丢配置）。
     */
    efforts: EffortMemory
    /** 用户体验规则（前端行为开关，不支持按提供方排除） */
    userExperience: UserExperienceRules
}

/** 当前版本的存储快照：运行时配置字段 + 显式版本号 */
export interface PluginConfigSnapshot {
    configVersion: number
    allowUpdate: FieldRules
    autoFill: FieldRules
    compat: CompatRules
    excludes: string[]
    efforts: EffortMemory
    userExperience: UserExperienceRules
}

/** 命名空间下的整段配置：version-N -> 对应版本的配置快照（保留低版本历史与更高新版本，便于无损回退） */
export type VersionedSection = Record<string, unknown>

// ---------- Connection RPC（强制更新通道）：宿主 @deepseek-ai/dsh-client-connection / dsh-host-webserver 契约的结构本地复制。 ----------
// ---------- 仅 type-only 使用：运行期服务全部经 ctx 注入取得，无须 import 宿主值（浏览器半亦同，构建期擦除）。宿主契约变化时须同步本段。 ----------

/** Connection RPC 端点返回值（对应宿主 ConnectionRpcResult） */
export type RpcResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { code: string; message: string; details: object } }

/** Node 半使用的 ctx.connection.requestRejection 切片（宿主 HostConnectionService.requestRejection） */
export type HostRequestRejection = (request: { headers: unknown }) => 401 | 403 | undefined

/** Node 半使用的 ctx.webServer.register 切片（宿主 WebServer.register，仅前缀路由） */
export type HostWebServerRegister = (route: {
    kind: 'prefix'
    path: string
    handler: (req: HostHttpRequest, res: HostHttpResponse) => Promise<void>
}) => () => void

/** 宿主 webServer 路由拿到的 node:http 请求（本插件只消费方法、URL、请求头与请求体） */
export interface HostHttpRequest {
    method?: string
    url?: string
    headers: Record<string, string | string[] | undefined>
    on(event: 'data', listener: (chunk: Buffer) => void): unknown
    on(event: 'end', listener: () => void): unknown
    on(event: 'error', listener: (error: unknown) => void): unknown
}

/** 宿主 webServer 路由拿到的 node:http 响应（本插件只写 JSON 响应） */
export interface HostHttpResponse {
    writeHead(status: number, headers?: Record<string, string>): unknown
    end(body?: string): unknown
}

/** 浏览器半使用的 connection.rpc.call 切片（宿主 ClientConnectionRpc.call，仅一元调用） */
export type ClientRpcCall = (
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
) => Promise<RpcResult<unknown>>
