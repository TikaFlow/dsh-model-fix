/** 共享类型定义与纯类型守卫 */

import { CAPACITY_UNLIMITED } from './constants'

/** models.dev 单条条目的推理、容量与模态解析结果 */
export interface ModelEntry {
    reasoning: boolean
    toggle: boolean
    efforts: string[]
    /** 最大上下文窗口（tokens），models.dev 未提供时为 undefined */
    contextWindow?: number
    /** 最大输出 tokens，models.dev 未提供时为 undefined */
    maxTokens?: number
    /** 支持图片输入（modalities.input 含 'image'）时为 true；纯文本或未提供模态信息均为 undefined */
    image?: boolean
}

/**
 * 磁盘缓存条目：缓存条目去 provider/id 两字段（分组键与嵌套键已承担），体积更小。
 * 内存索引（IndexEntry）为补全分组键的完整条目，供 lookup/fix 消费。
 */
export interface CacheRecord {
    /** 可选推理级别，'none' 表示可关闭推理；无可选档位时为空数组 */
    efforts: string[]
    /** 最大上下文窗口（tokens），仅当 models.dev 提供 */
    contextWindow?: number
    /** 最大输出 tokens，仅当 models.dev 提供 */
    maxTokens?: number
    /** 支持图片输入时为 true；纯文本模型省略此字段（不缓存 false，控制体积） */
    image?: boolean
}

/** 磁盘缓存：{ provider-id: { model-id: 缓存条目 } }，provider 只作外层键，消除逐条重复 */
export type Catalog = Record<string, Record<string, CacheRecord>>

/** 内存索引条目：缓存条目（CacheRecord）补上分组键下的 model id，供 lookup/fix 按 provider+id 消费 */
export interface IndexEntry {
    id: string
    efforts: string[]
    contextWindow?: number
    maxTokens?: number
    image?: boolean
}

/** 按 provider 分组的内存索引，供 lookup 复用 */
export interface ProviderGroup {
    ids: string[]
    entries: IndexEntry[]
}

/** 目录及其预构建的 provider 分组索引 */
export interface IndexedCatalog {
    catalog: Catalog
    groups: Map<string, ProviderGroup>
}

/** 判断是否为普通数据对象（非数组、非 null、非类实例） */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const proto: unknown = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
}

/** 判断是否为可写回的容量值：正整数且非哨兵（harness schema 要求 step(1).min(1)；0 与 99999999 均视为无数据） */
export function isCapacity(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value !== CAPACITY_UNLIMITED
}

// ---------- 历史版本（v1）：新命名空间（tikaflow-model-fix）版本快照体系内 v1 快照的冻结形态（引入 image 前的配置）。 ----------
// ---------- 定义不随代码演进，MIN_SUPPORTED_VERSION 超过 1 时本段与 upgradeTo2 的 v1 解析一并移除 ----------

/** 历史版本(v1)：按字段分别控制的规则（无 image 字段） */
export interface V1FieldRules {
    /** 推理级别字段 */
    reasoning: boolean
    /** 上下文窗口与输出上限，二者一体受此开关控制 */
    context: boolean
}

/** 历史版本(v1)：version-1 快照的完整形态 */
export interface V1PluginConfigSnapshot {
    configVersion: number
    allowUpdate: V1FieldRules
    autoFill: V1FieldRules
}

// ---------- 历史版本（v2）：版本快照体系内 v2 快照的冻结形态（引入 compat 前的配置）。 ----------
// ---------- 定义不随代码演进，MIN_SUPPORTED_VERSION 超过 2 时本段与 upgradeTo3 的 v2 接力一并移除 ----------

/** 历史版本(v2)：按字段分别控制的规则开关（与 v1 相比多出 image 字段） */
export interface V2FieldRules {
    /** 推理级别字段 */
    reasoning: boolean
    /** 上下文窗口与输出上限，二者一体受此开关控制 */
    context: boolean
    /** 图片/多模态（input 模态声明） */
    image: boolean
}

/** 历史版本(v2)：version-2 快照的完整形态（无 compat 对象） */
export interface V2PluginConfigSnapshot {
    configVersion: number
    allowUpdate: V2FieldRules
    autoFill: V2FieldRules
}

// ---------- 历史版本（v3）：版本快照体系内 v3 快照的冻结形态（引入 excludes 前的配置）。 ----------
// ---------- 定义不随代码演进，MIN_SUPPORTED_VERSION 超过 3 时本段与 upgradeTo4 的 v3 接力一并移除 ----------

/** 历史版本(v3)：按字段分别控制的规则开关（与 v2 同形，独立声明以冻结形态） */
export interface V3FieldRules {
    /** 推理级别字段 */
    reasoning: boolean
    /** 上下文窗口与输出上限，二者一体受此开关控制 */
    context: boolean
    /** 图片/多模态（input 模态声明） */
    image: boolean
}

/** 历史版本(v3)：兼容性规则（与当前 CompatRules 同形，独立声明以冻结形态） */
export interface V3CompatRules {
    /** 是否接管路由的 developer 角色兼容字段 */
    disableDeveloper: boolean
}

/** 历史版本(v3)：version-3 快照的完整形态（无 excludes 数组） */
export interface V3PluginConfigSnapshot {
    configVersion: number
    allowUpdate: V3FieldRules
    autoFill: V3FieldRules
    compat: V3CompatRules
}

// ---------- 当前版本随升级链持续演进 ----------

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
     * 为 false 时前端既不保存、也不用旧记忆恢复（已有记忆保留在配置里，重新打开即恢复生效）。
     */
    rememberEfforts: boolean
}

// ---------- 历史版本（v4）冻结形态：引入 efforts 之前的快照（三组布尔 + compat + excludes）；与当前 FieldRules / CompatRules 同形，独立声明以冻结形态，不引用当前版本的可演进定义。 ----------

/** 历史版本(v4)：字段规则 schema（与当前 FieldRules 同形，独立声明以冻结形态） */
export interface V4FieldRules {
    reasoning: boolean
    context: boolean
    image: boolean
}

/** 历史版本(v4)：兼容性规则 schema（与当前 CompatRules 同形，独立声明以冻结形态） */
export interface V4CompatRules {
    disableDeveloper: boolean
}

/** 历史版本(v4)：配置快照（freeze；不引用当前版本的可演进定义） */
export interface V4PluginConfigSnapshot {
    configVersion: number
    allowUpdate: V4FieldRules
    autoFill: V4FieldRules
    compat: V4CompatRules
    excludes: string[]
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
