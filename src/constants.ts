import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件名，同时用作日志前缀 */
export const PLUGIN_NAME = 'dsh-model-fix'

/**
 * 模型配置读写目标命名空间（harness 的 llm-pi-ai）。
 * 宿主 0.1.2 起命名空间即小写连字符字面量（由 settings 服务在注册/读写时校验），不再有包装函数。
 */
export const API_NS = 'llm-pi-ai'
/** 自有配置命名空间（带发布者前缀，避免与其他插件抢占通用名字；fix 即填充/修复），由 ctx.settings.installSection 注册 */
export const PLUGIN_NS = 'tikaflow-model-fix'

/** 当前代码支持的配置版本（新 NS 内的快照版本）；配置 schema 变化时递增，并在 migrate.ts 中追加升级步骤 */
export const CONFIG_VERSION = 4
/** 最低支持（可升级读取）的版本；低于此值的版本快照视为已失效（运行时不读取、迁移时清理） */
export const MIN_SUPPORTED_VERSION = 1
/**
 * 低于当前版本的旧快照保留上限，超出在启动时从最低版本清理（等于或高于当前版本的快照始终保留，供无损回退）。
 * 当前版本为 4 时段内 olds = {1,2,3} 恰等于本上限，故一轮不清理；升到 5 时 v1 才被淘汰。
 */
export const MAX_OLD_SNAPSHOTS = 3
/** 版本快照键前缀，段内键形如 version-N */
export const VERSION_PREFIX = 'version-'

/** models.dev 容量字段对"无限/未公布"的哨兵建模值，视为无数据 */
export const CAPACITY_UNLIMITED = 99_999_999

export const API_URL = 'https://models.dev/api.json'
/** 拉取超时（毫秒） */
export const FETCH_MS = 10_000
/** 拉取、缓存写入与填充冲突共用的总尝试次数 */
export const MAX_ATTEMPTS = 3
/** 拉取与缓存写入失败后的固定重试间隔（毫秒） */
export const RETRY_DELAY_MS = 5_000

/** 缓存文件路径（基于模块路径定位，构建时复制；网络拉取成功后覆盖） */
export const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'public', 'models-cache.json')

/** 推理级别取值，与 harness 的 ModelThinkingLevel 一致 */
export const LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/**
 * compat.disableDeveloper 管辖的协议：只作用于 OpenAI Chat Completions 风格的路由（自定义端点的主流形态）。
 * 宿主也会在其他 OpenAI 系协议（如 openai-responses）消费 supportsDeveloperRole，但本插件不替它们接管该字段；
 * 对不消费该字段的协议写入更是无意义（宿主按协议 gate 静默跳过）。
 */
export const DEVELOPER_COMPAT_APIS = new Set(['openai-completions'])
/** disableDeveloper 对应的 provider 路由 compat 字段名（开启写 false，关闭删键） */
export const DEVELOPER_COMPAT_FIELD = 'supportsDeveloperRole'

/** 模型名前缀 -> 官方提供商，用于跨提供商匹配同源模型 */
export const HINTS: ReadonlyArray<readonly [string, string]> = [
    ['deepseek', 'deepseek'],
    ['claude', 'anthropic'],
    ['kimi', 'moonshotai'],
    ['grok', 'xai'],
    ['gpt', 'openai'],
]
