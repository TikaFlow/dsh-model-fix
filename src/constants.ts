import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** 插件名，同时用作日志前缀 */
export const PLUGIN_NAME = 'dsh-model-fix'

/** 模型配置读写目标命名空间（harness 的 llm-pi-ai） */
export const API_NS = settingsNamespace('llm-pi-ai')
/** 自有配置命名空间（带发布者前缀，避免与其他插件抢占通用名字；fix 即填充/修复），由 installSettingsSection 注册 */
export const PLUGIN_NS = settingsNamespace('tikaflow-model-fix')
/** 旧版自有配置命名空间：启动时读取并升级；迁移后其配置段保留，供回滚旧版插件继续读取 */
export const LEGACY_NS = settingsNamespace('model-reasoning')

/** 当前代码支持的配置版本（新 NS 内的快照版本）；配置 schema 变化时递增，并在 migrate.ts 中追加升级步骤 */
export const CONFIG_VERSION = 2
/** 最低支持（可升级读取）的版本，0 为旧命名空间的统一形态（无版本号字段）；低于此值的版本快照视为已失效（运行时不读取、迁移时清理） */
export const MIN_SUPPORTED_VERSION = 0
/** 低于当前版本的旧快照保留上限，超出在启动时从最低版本清理（等于或高于当前版本的快照始终保留，供无损回退） */
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

/** 启动等待自有命名空间注册完成的最大轮询次数（每次让出一个宏任务，正常一两次即命中） */
export const REGISTER_WAIT_MAX = 50

/** 缓存文件路径（基于模块路径定位，构建时复制；网络拉取成功后覆盖） */
export const CACHE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'public', 'models-cache.json')

/** 推理级别取值，与 harness 的 ModelThinkingLevel 一致 */
export const LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

/** 模型名前缀 -> 官方提供商，用于跨提供商匹配同源模型 */
export const HINTS: ReadonlyArray<readonly [string, string]> = [
    ['deepseek', 'deepseek'],
    ['claude', 'anthropic'],
    ['kimi', 'moonshotai'],
    ['grok', 'xai'],
    ['gpt', 'openai'],
]
