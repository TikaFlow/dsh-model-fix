import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, LlmCallConfigAdapterDefaults, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { getConfig } from '@/config'
import { errorText } from '@/shared/errors'
import { PLUGIN_NAME } from '@/shared/constants'

/**
 * 子智能体推理级别的注入面：在宿主 `agent/request` 瀑布里改写子 Agent 本次请求的调用配置。
 *
 * 宿主只为**主** Agent 提供推理级别入口，子 Agent 没有同类设置面；而每次委派真正落地的那份
 * 调用配置就流经这道瀑布——本模块按 `userExperience.followParent` 开关在 `next()` 之后
 * 改写它，等价于替子 Agent 选定档位，宿主随后照常做适配器元数据校验（不支持的档位由宿主抛
 * `UNSUPPORTED_REASONING_EFFORT`，不在这里预检、不静默降级）。
 *
 * 每请求现算、不缓存结果：父 Agent 的档位与子智能体实际拿到的模型都可能在本会话内变动。
 */

/**
 * 本模块用到的两项宿主契约——`Agent` 的只读面与「允许 Agent 为子智能体选择模型」设置服务，
 * **均按契约复制，不引宿主包类型**。
 *
 * 原因：宿主富面 `Agent` 只在 `@deepseek-ai/dsh-agent` **包根**导出（`/types` 子路径只有 `{ id }`），
 * 「允许选择模型」设置住在 `@deepseek-ai/dsh-tool-subagent/model-selection-settings`；而这两个包
 * 都会把 `@deepseek-ai/dsh-session` 的**包根**类型拉进程序（如 `dsh-tool-subagent/lib/types/index.d.ts:13`
 * 的 `import type { Session } from '@deepseek-ai/dsh-session'`），该包根对 `Context` 的
 * `sessions: SessionStore` 增补会顶掉 `@deepseek-ai/dsh-api-session-controller/client` 的同名增补，
 * 浏览器半的 `ctx.sessions` 于是由 `ISessions` 退化成 Node 侧的 `SessionStore`，
 * `src/client/memory-listener.ts` 整片打出类型错误。故本模块只声明实际读取的成员，
 * 升级宿主时按 [`docs/host-api.md`](docs/host-api.md) 的对应条目复核。
 */
interface SubagentHost {
    readonly session: {
        readonly header: { readonly origin?: string; readonly parentSession?: SessionId }
        requestHeader(): { readonly config: LlmCallConfig; readonly adapterDefaults?: LlmCallConfigAdapterDefaults } | undefined
    }
    /** 宿主 `AgentOptions` 的路由四项（provider/model 可缺，故逐项判后再用） */
    readonly options: { readonly provider?: string; readonly model?: string; readonly reasoningEffort?: ReasoningEffortId; readonly maxTokens?: number }
}

/** 宿主 `AgentRegistry` 的只读面（按契约复制） */
interface HostAgentRegistry { get(id: SessionId): SubagentHost | undefined }

/** 宿主「允许 Agent 为子智能体选择模型」设置服务的只读面（只用到 `current().enabled`） */
interface HostSelectionService { current(): { enabled: boolean } }

/** `agent/request` 瀑布监听签名（与宿主 `AgentEvents` 一致，见 [`docs/host-api.md`](docs/host-api.md)） */
type SubagentRequestListener = (
    payload: { agent: SubagentHost },
    next: () => Promise<LlmCallConfig>,
) => Promise<LlmCallConfig>

/**
 * 装上「跟随父智能体」：单个 `agent/request` 监听覆盖全部 Agent（含 fork/workflow 等
 * 一并归入 `origin === 'subagent'` 的会话），作用域随插件 ctx 销毁而自动卸载。
 *
 * 本文件只服务 `userExperience.followParent` 这一个开关——它没有独立的配置组，判定读的就是
 * 该键；文件名沿用「子智能体」这一话题域。
 *
 * 监听用 `prepend` 钉成最外层：`agent/request` 的监听者由外而内依次执行，最外层 `next()`
 * 拿到的即宿主（含会话级模型切换）全部改写完成后的最终配置，父 Agent 的档位因此是「当前
 * 生效值」而非某个中间态。
 */
export function installSubagentFollowParent(ctx: Context): void {
    // 事件名与监听签名随 `SubagentHost` 一并按契约本地声明（引宿主包根会把 dsh-session 包根类型
    // 拉进 typecheck 程序、顶掉浏览器半的 ctx.sessions），故此处对 `ctx.on` 做一次收窄断言；
    // `this` 仍须是插件 ctx，故走 `.call` 而非裸调。
    const on = ctx.on as unknown as (
        this: Context,
        name: string,
        listener: SubagentRequestListener,
        options?: { prepend?: boolean },
    ) => unknown
    on.call(ctx, 'agent/request', async (payload, next) => {
        const config = await next()
        try {
            return resolveRequest(ctx, payload.agent, config)
        } catch (error) {
            // 读宿主设置/父 Agent 失败都不该拖垮子智能体的这一次请求：原样放行，交由宿主自身校验
            ctx.logger.warn(`${PLUGIN_NAME}: 子智能体推理级别未生效：${errorText(error)}`)
            return config
        }
    }, { prepend: true })
}

/** 按配置算出本次请求该用的调用配置；非子智能体 Agent 或开关不适用时原样返回入参 */
function resolveRequest(ctx: Context, agent: SubagentHost | undefined, config: LlmCallConfig): LlmCallConfig {
    if (agent?.session.header.origin !== 'subagent') return config
    // 宿主开着「允许 Agent 为子智能体选择模型」时，路由由模型自己在授权范围内挑，不该由插件覆盖
    if (hostSelectionEnabled(ctx)) return config
    if (!getConfig().userExperience.followParent) return config
    const follow = resolveFollow(ctx, agent)
    return follow === undefined ? config : applyFollow(config, follow)
}

/**
 * 宿主是否开着「允许 Agent 为子智能体选择模型」——跟着关时跟随才生效。
 * 服务缺席（非 Web 组合）或 `current()` 因「已开启但授权表为空」抛错时，一律按关闭处理。
 */
function hostSelectionEnabled(ctx: Context): boolean {
    const service = (ctx.get as (name: string) => HostSelectionService | undefined)('subagentModelSelection')
    try {
        return service?.current().enabled === true
    } catch {
        return false
    }
}

/**
 * 父 Agent 当前生效的路由四件套：先取会话日志的请求头（最新一次请求的配置即当前生效值，
 * 也是宿主委派时读取的那一份），无请求头则回落 Agent 自身的 options。取不到即 undefined。
 *
 * 请求头里被 `adapterDefaults.reasoningEffort` 标记的档位是适配器兜底值而非用户所选，
 * 视作「父当前未选档位」而丢弃，避免把兜底值当作父的选择复制给子智能体。`maxTokens`
 * 只作为「更小者的候选」带回（见 `applyFollow`），不是覆盖值。
 */
function resolveFollow(ctx: Context, agent: SubagentHost): FollowRoute | undefined {
    const parentId = agent.session.header.parentSession
    if (parentId === undefined) return undefined
    const parent = (ctx.get as (name: string) => HostAgentRegistry | undefined)('agents')?.get(parentId)
    if (!parent) return undefined
    const header = parent.session.requestHeader()
    const source = header?.config ?? parent.options
    if (typeof source.provider !== 'string' || source.provider === '') return undefined
    if (typeof source.model !== 'string' || source.model === '') return undefined
    const effort = header?.adapterDefaults?.reasoningEffort === true ? undefined : source.reasoningEffort
    return {
        provider: source.provider,
        model: source.model,
        ...effort === undefined ? {} : { reasoningEffort: effort },
        ...typeof source.maxTokens === 'number' ? { maxTokens: source.maxTokens } : {},
    }
}

/** 跟随父 Agent 时取到的路由四件套（`reasoningEffort` / `maxTokens` 缺项表示父当前没有该值） */
interface FollowRoute {
    provider: string
    model: string
    reasoningEffort?: ReasoningEffortId
    maxTokens?: number
}

/**
 * 两处输出预算取更小的一个：跟随是把父会话的收缩带给子智能体，不是把子智能体的上限抬到父的
 * 水平——子智能体那一份可能来自工具侧声明的更小预算（它本来就是有意压低的一次性委派）。
 * 缺项视作不限，故只有一方给出时即取那一方，两方都没有则不写该键。
 */
function smallerBudget(current: number | undefined, inherited: number | undefined): number | undefined {
    if (current === undefined) return inherited
    if (inherited === undefined) return current
    return Math.min(current, inherited)
}

/** 整条覆盖为父的路由：provider / model / 档位照父的来，输出预算取两者更小的一个 */
function applyFollow(config: LlmCallConfig, follow: FollowRoute): LlmCallConfig {
    const budget = smallerBudget(config.maxTokens, follow.maxTokens)
    const next = { ...config }
    delete next.reasoningEffort
    delete next.maxTokens
    return {
        ...next,
        provider: follow.provider,
        model: follow.model,
        ...follow.reasoningEffort === undefined ? {} : { reasoningEffort: follow.reasoningEffort },
        ...budget === undefined ? {} : { maxTokens: budget },
    }
}