/**
 * Node 半类型定义与纯类型守卫。
 *
 * 本文件只保留 Node 专属：models.dev 目录类型（`ModelEntry`/`CacheRecord`/…）、`isCapacity`、
 * 冻结历史版本（v1–v4）快照形态。跨半共享类型与守卫单一来源在 `src/shared/types.ts`，两半均直连。
 */

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
