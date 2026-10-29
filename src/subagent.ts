import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, LlmCallConfigAdapterDefaults, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { getConfig } from '@/config'
import { hostVersionNow } from '@/shared/version'
import { errorText } from '@/shared/errors'
import { compareHostVersion } from '@/shared/version'
import { HOST_MODEL_SELECT_SINCE, PLUGIN_NAME } from '@/shared/constants'

/** 子智能体跟随父智能体的注入面。
 * 子 Agent 无推理级别设置面，委派调用流经 `agent/pre-step`（新宿主）/`agent/request`（旧宿主）与 `agent/request` 预算侧；每步现算不缓存。
 * 裁决见 docs/decisions-session.md「子智能体」 */

/** 宿主契约（`Agent` 只读面、子智能体选模型设置服务、会话投影服务）——按契约复制，不引宿主包类型。
 * 原因：宿主富面 `Agent` 只在 `@deepseek-ai/dsh-agent` 包根导出，「允许选择模型」设置住在 `@deepseek-ai/dsh-tool-subagent/model-selection-settings`；这两个包都会把 `@deepseek-ai/dsh-session` 包根类型拉进程序，顶掉浏览器半 `ctx.sessions` 的增补（`ISessions` → `SessionStore`）。
 * 故只声明实际读取的成员；升级宿主按 `docs/host/` 对应条目复核 */
interface SubagentHost {
    readonly session: {
        readonly header: { readonly origin?: string; readonly parentSession?: SessionId }
        requestHeader(): { readonly config: LlmCallConfig; readonly adapterDefaults?: LlmCallConfigAdapterDefaults } | undefined
    }
    /** 宿主 `AgentOptions` 的路由四项（provider/model 可缺，故逐项判后再用） */
    readonly options: { readonly provider?: string; readonly model?: string; readonly reasoningEffort?: ReasoningEffortId; readonly maxTokens?: number }
    readonly model: {
        select(selection: { provider: string; model: string; reasoningEffort?: ReasoningEffortId }): void
    }
}

/** 宿主 `AgentRegistry` 的只读面（按契约复制） */
interface HostAgentRegistry { get(id: SessionId): SubagentHost | undefined }

/** 宿主「允许 Agent 为子智能体选择模型」设置服务的只读面（只用到 `current().enabled`） */
interface HostSelectionService { current(): { enabled: boolean } }

/** 宿主 `ModelSelection` 投影状态的只读面（按契约复制）。`pending` 是 UI 换模型/换档位后、尚未被任何一次请求消费掉的选择 */
interface HostModelSelectionState {
    readonly pending: { readonly provider: string; readonly model: string; readonly reasoningEffort?: string } | null
}

/** 宿主会话投影服务的只读面（只用到 `stateOf`）。`modelSelection` 投影未注册时该键返回 `undefined` */
interface HostSessionProjections {
    stateOf(session: SubagentHost['session'], key: 'modelSelection'): HostModelSelectionState | undefined
}

/** 宿主 `agent/pre-step` 瀑布的 `ModelSelection` */
interface HostModelSelection {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
}

/** 宿主 `agent/pre-step` 瀑布的裁决 */
type HostPreStepDecision =
    | { readonly kind: 'reject' }
    | { readonly kind: 'enter'; readonly messages: unknown[]; readonly startsRequestSeries?: true }

/** `agent/pre-step` 瀑布监听签名 */
type SubagentPreStepListener = (
    payload: { agent: SubagentHost; messages: unknown[]; turn: number; step: number; signal: AbortSignal; modelSelection: HostModelSelection },
    next: () => Promise<HostPreStepDecision>,
) => Promise<HostPreStepDecision>

/** `agent/request` 瀑布监听签名 */
type SubagentRequestListener = (
    payload: { agent: SubagentHost },
    next: () => Promise<LlmCallConfig>,
) => Promise<LlmCallConfig>

/** 装上「跟随父智能体」，监听用 `prepend` 钉成最外层
 * 两步：切路由 + 并输出预算（`mergedBudget`）。
 * 分支由注入时读一次的宿主版本决定，此后每步只读这个 flag。 */
export function installSubagentFollowParent(ctx: Context): void {
    ctx.inject(['agents', 'sessionProjections', 'subagentModelSelection'], (child) => {
        const agents = child.get('agents') as HostAgentRegistry
        const projections = child.get('sessionProjections') as HostSessionProjections
        const selectionService = child.get('subagentModelSelection') as HostSelectionService
        const canSelect = selectsSince(ctx, HOST_MODEL_SELECT_SINCE)
        // 事件名与监听签名随 SubagentHost 一并按契约本地声明，故对 child.on 收窄断言；`this` 须是插件 ctx，故走 `.call`
        const on = child.on as unknown as (
            this: Context,
            name: string,
            listener: SubagentRequestListener | SubagentPreStepListener,
            options?: { prepend?: boolean },
        ) => () => boolean

        const onRequest: SubagentRequestListener = async (payload, next) => {
            const config = await next()
            try {
                return canSelect
                    ? mergeBudgetOnly(agents, projections, selectionService, payload.agent, config)
                    : applyFollowRoute(agents, projections, selectionService, payload.agent, config)
            } catch (error) {
                ctx.logger.warn(`${PLUGIN_NAME}: 子智能体跟随未生效：${errorText(error)}`)
                return config
            }
        }

        const onPreStep: SubagentPreStepListener = async (payload, next) => {
            const decision = await next()
            if (decision.kind === 'reject' || payload.signal.aborted) return decision
            try {
                selectFollow(agents, projections, selectionService, payload.agent, payload.modelSelection)
            } catch (error) {
                ctx.logger.warn(`${PLUGIN_NAME}: 子智能体跟随未生效：${errorText(error)}`)
            }
            return decision
        }

        on.call(child, 'agent/request', onRequest, { prepend: true })
        if (canSelect) on.call(child, 'agent/pre-step', onPreStep, { prepend: true })
    })
}

/** 宿主版本是否已达某个起点；版本未知按未达处理（不空转） */
function selectsSince(ctx: Context, since: string): boolean {
    const version = hostVersionNow(ctx)
    if (version === undefined) return false
    return (compareHostVersion(version, since) ?? -1) >= 0
}

/** 门控链：不跟随则返回 undefined */
function followRoute(agents: HostAgentRegistry, projections: HostSessionProjections, selectionService: HostSelectionService, agent: SubagentHost | undefined): FollowRoute | undefined {
    if (agent?.session.header.origin !== 'subagent') return undefined
    // 宿主开着「允许 Agent 为子智能体选择模型」时，路由由模型自己在授权范围内挑，不该由插件覆盖
    if (hostSelectionEnabled(selectionService)) return undefined
    if (!getConfig().userExperience.followParent) return undefined
    return resolveFollow(agents, projections, agent)
}

/** `agent/pre-step` 层：本步选择与父的路由有差异时，用宿主命令面 `agent.model.select()` 切过去。 */
function selectFollow(agents: HostAgentRegistry, projections: HostSessionProjections, selectionService: HostSelectionService, agent: SubagentHost | undefined, selection: HostModelSelection): void {
    const follow = followRoute(agents, projections, selectionService, agent)
    if (follow === undefined) return
    const differs = follow.provider !== selection.provider
        || follow.model !== selection.model
        || (follow.reasoningEffort ?? '') !== (selection.reasoningEffort ?? '')
    if (!differs) return
    agent?.model.select({
        provider: follow.provider,
        model: follow.model,
        ...follow.reasoningEffort === undefined ? {} : { reasoningEffort: follow.reasoningEffort },
    })
}

/** `agent/request` 旧宿主：整条覆盖为父的路由 */
function applyFollowRoute(agents: HostAgentRegistry, projections: HostSessionProjections, selectionService: HostSelectionService, agent: SubagentHost | undefined, config: LlmCallConfig): LlmCallConfig {
    const follow = followRoute(agents, projections, selectionService, agent)
    return follow === undefined ? config : applyFollow(config, follow)
}

/** `agent/request` 新宿主：只并输出预算 */
function mergeBudgetOnly(agents: HostAgentRegistry, projections: HostSessionProjections, selectionService: HostSelectionService, agent: SubagentHost | undefined, config: LlmCallConfig): LlmCallConfig {
    const follow = followRoute(agents, projections, selectionService, agent)
    if (follow === undefined) return config
    const budget = mergedBudget(config.maxTokens, follow.maxTokens)
    const next = { ...config }
    delete next.maxTokens
    return { ...next, ...budget === undefined ? {} : { maxTokens: budget } }
}

/** 宿主是否开着「允许 Agent 为子智能体选择模型」——跟着关时跟随才生效。`current()` 因「已开启但授权表为空」抛错时一律按关闭处理 */
function hostSelectionEnabled(service: HostSelectionService): boolean {
    try {
        return service.current().enabled === true
    } catch {
        return false
    }
}

/** 父 Agent 下一次请求该用的路由：先取父会话「待生效的选择」，没有才取会话日志的请求头，再无则回落 Agent 自身 options。裁决见 docs/decisions-session.md「子智能体」 */
function resolveFollow(agents: HostAgentRegistry, projections: HostSessionProjections, agent: SubagentHost): FollowRoute | undefined {
    const parentId = agent.session.header.parentSession
    if (parentId === undefined) return undefined
    const parent = agents.get(parentId)
    if (!parent) return undefined
    return pendingFollow(projections, parent.session) ?? headerFollow(parent)
}

/** 父会话待生效的选择：UI 的每次切换都落一条 `model/selection` 事件，投影据此置 `pending`，直到匹配的那次请求把它消费掉。该投影未注册时读不到，按「没有待生效选择」处理 */
function pendingFollow(projections: HostSessionProjections, session: SubagentHost['session']): FollowRoute | undefined {
    const pending = projections.stateOf(session, 'modelSelection')?.pending
    if (pending === undefined || pending === null) return undefined
    if (typeof pending.provider !== 'string' || pending.provider === '') return undefined
    if (typeof pending.model !== 'string' || pending.model === '') return undefined
    return {
        provider: pending.provider,
        model: pending.model,
        ...pending.reasoningEffort === undefined ? {} : { reasoningEffort: pending.reasoningEffort as ReasoningEffortId },
    }
}

/** 父会话最近一次请求的配置；无请求头时回落 Agent 自身的 options。取不到即 undefined。 */
function headerFollow(parent: SubagentHost): FollowRoute | undefined {
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

/** 继承值更大时只抬升差值的八成：既不被旧的小预算卡死，也不一步顶到新值 */
const BUDGET_SCALE = 0.8

/** 输出预算合并：继承值不大于现值取继承值；更大时只抬升差值八成（直接顶到新值部分端点拒绝）；缺项视作不限，只有一方给出即取那一方，两方都没有不写该键 */
function mergedBudget(current: number | undefined, inherited: number | undefined): number | undefined {
    if (current === undefined) return inherited
    if (inherited === undefined) return current
    if (inherited <= current) return inherited
    return Math.floor(current + (inherited - current) * BUDGET_SCALE)
}

/** 整条覆盖为父的路由：provider / model / 档位照父的来，输出预算按 `mergedBudget` 合并 */
function applyFollow(config: LlmCallConfig, follow: FollowRoute): LlmCallConfig {
    const budget = mergedBudget(config.maxTokens, follow.maxTokens)
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
