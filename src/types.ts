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

/** 缓存条目：已拍平并过滤，仅保留填充所需字段 */
export interface CacheEntry {
    provider: string
    id: string
    /** 可选推理级别，'none' 表示可关闭推理；无可选档位时为空数组 */
    efforts: string[]
    /** 最大上下文窗口（tokens），仅当 models.dev 提供 */
    contextWindow?: number
    /** 最大输出 tokens，仅当 models.dev 提供 */
    maxTokens?: number
    /** 支持图片输入时为 true；纯文本模型省略此字段（不缓存 false，控制体积） */
    image?: boolean
}

/** 拍平缓存：每条为 provider/id/efforts 及可选的容量与图片字段 */
export type Catalog = CacheEntry[]

/** 按 provider 分组的内存索引，供 lookup 复用 */
export interface ProviderGroup {
    ids: string[]
    entries: CacheEntry[]
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
// ---------- 定义不随代码演进，MIN_SUPPORTED_VERSION 超过 1 时本段与 migrate.ts 的 upgrade1To2 一并移除 ----------

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

/** 当前运行时配置（仅对象写法） */
export interface PluginConfig {
    /** 开启后以 models.dev 最新数据为准更新已有配置 */
    allowUpdate: FieldRules
    /** 开启后自动填充缺失的推理级别/容量/图片字段 */
    autoFill: FieldRules
}

/** 当前版本的存储快照：运行时配置字段 + 显式版本号 */
export interface PluginConfigSnapshot {
    configVersion: number
    allowUpdate: FieldRules
    autoFill: FieldRules
}

/** 命名空间下的整段配置：version-N -> 对应版本的配置快照（保留低版本历史与更高新版本，便于无损回退） */
export type VersionedSection = Record<string, unknown>

// ---------- Connection RPC（强制更新通道）：宿主 @deepseek-ai/dsh-client-connection 契约的结构本地复制。 ----------
// ---------- 该包依赖链在 npm 上不可解析（transitive 范围仅存在于宿主 monorepo），故不装依赖、仅按结构使用； ----------
// ---------- 浏览器半仅 type-only 引用（构建期擦除）。宿主契约变化时须同步本段。 ----------

/** Connection RPC 端点返回值（对应宿主 ConnectionRpcResult） */
export type RpcResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { code: string; message: string; details: object } }

/** Node 半使用的 ctx.connection.rpc.handle 切片（宿主 HostConnectionRpc.handle） */
export type HostRpcHandle = (
    channel: string,
    handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<RpcResult<unknown>>,
) => () => Promise<void>

/** 浏览器半使用的 connection.rpc.call 切片（宿主 ClientConnectionRpc.call，仅一元调用） */
export type ClientRpcCall = (
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
) => Promise<RpcResult<unknown>>
