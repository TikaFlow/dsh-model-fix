/**
 * 跨半共享的纯常量（零 Node 依赖、零 schemastery、零非基线 `@deepseek-ai/*`）。
 * 两半均**直连**本层（统一经 `@/shared/constants` 别名导入），不经任何 facade 中转；
 * Node 专属常量（含 `node:path` 的 `CACHE_FILE`、拉取参数等）仍留 `src/constants.ts`。
 *
 * 本文件是浏览器半能安全值导入的唯一跨半来源（`tsdown.config.ts` 的 client 纯度门禁在 @/ 值导入里只放行 `@/shared`）。
 * 往本文件加任何 `node:`、`schemastery` 或非基线 `@deepseek-ai/*` 的值导入都会破坏浏览器半产物——勿加。
 */

/** 模型配置读写目标命名空间（harness 的 llm-pi-ai）：小写连字符字面量，由 settings 服务在注册/读写时校验 */
export const API_NS = 'llm-pi-ai'
/** 自有配置命名空间（带发布者前缀，避免与其他插件抢占通用名字；fix 即填充/修复），由 ctx.settings.installSection 注册 */
export const PLUGIN_NS = 'tikaflow-model-fix'

/** 插件名（= npm 包名）：Node 半日志前缀与 User-Agent、浏览器半 `export const name` 与样式标签 HMR 标记共用 */
export const PLUGIN_NAME = 'dsh-model-fix'

/** 当前代码支持的配置版本（新 NS 内的快照版本）；配置 schema 变化时递增，并在 migrate.ts 中追加升级步骤 */
export const CONFIG_VERSION = 6

/** 版本快照键前缀，段内键形如 version-N */
export const VERSION_PREFIX = 'version-'
