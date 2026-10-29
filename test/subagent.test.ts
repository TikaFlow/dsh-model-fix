// subagent.ts 纯逻辑测试：pre-step 切路由、request 并预算、旧宿主兜底、卸载
import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, LlmCallConfigAdapterDefaults, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { check, stable } from '@test/helper'
import { installSubagentFollowParent } from '@/subagent'
import { setConfigSource } from '@/config'
import { DEFAULT_CONFIG } from '@/shared/config-schema'
import type { PluginConfig, UserExperienceRules } from '@/shared/types'

/** 最小 Agent 桩——与 `src/subagent.ts` 契约复制同形。不引 `@deepseek-ai/dsh-agent` 包根类型：它会拉进 `@deepseek-ai/dsh-session` 包根类型，顶掉浏览器半 `ctx.sessions` 的 `ISessions` 增补 */
interface Agent {
    readonly session: {
        readonly header: { readonly origin?: string; readonly parentSession?: SessionId }
        requestHeader(): { readonly config: LlmCallConfig; readonly adapterDefaults?: LlmCallConfigAdapterDefaults } | undefined
    }
    readonly options: { readonly provider?: string; readonly model?: string; readonly reasoningEffort?: ReasoningEffortId; readonly maxTokens?: number }
    readonly model: SelectRecorder
}

/** 宿主 `ModelSelection`（按契约复制：路由层不带预算） */
interface HostModelSelection {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
}

/** 宿主 `agent/pre-step` 裁决（本仓只读 `kind`） */
type PreStepDecision =
    | { readonly kind: 'reject' }
    | { readonly kind: 'enter'; readonly messages: unknown[]; readonly startsRequestSeries?: true }

/** 一次 `agent.model.select()` 的入参 */
interface SelectedCall {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
}

/** `agent.model.select()` 调用记录面 */
interface SelectRecorder {
    readonly calls: SelectedCall[]
    select(selection: SelectedCall): void
}

/** 瀑布监听通用形（两条签名只差 `next` 产出，换轨/卸载引用断言用） */
type AnyListener = (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>

/** 最小 Agent 桩：只读 `session.header`、`session.requestHeader()` 与 `options`；`model.select` 只记录不执行 */
function makeAgent(init: {
    origin?: string
    parentSession?: string
    options?: { provider: string; model: string; reasoningEffort?: string; maxTokens?: number }
    header?: unknown
}): Agent {
    const calls: SelectedCall[] = []
    return {
        session: {
            header: { origin: init.origin, parentSession: init.parentSession },
            requestHeader: () => init.header,
        },
        options: init.options ?? { provider: 'p', model: 'm' },
        model: {
            calls,
            select(selection: SelectedCall) { calls.push({ ...selection }) },
        },
    } as unknown as Agent
}

/** 最小 ctx 桩：支持 `inject` 子 fiber（deps 全就绪才激活，缺席静默）、`on`（按引用比对、幂等的 disposer）与 `effect` */
function makeCtx(init: {
    selection?: SelectionStub
    parentOf?: (id: string) => Agent | undefined
    projections?: ProjectionStub
    getThrows?: boolean
    /** 宿主版本；undefined 表示读不到 */
    hostVersion?: string
}) {
    const warns: string[] = []
    const listeners = new Map<string, unknown>()
    const options = new Map<string, unknown>()
    const effects: (() => void)[] = []
    const get = (name: string) => {
        if (init.getThrows === true) throw new Error('服务不可用')
        if (name === 'subagentModelSelection') return init.selection ?? { current: () => ({ enabled: false }) }
        if (name === 'agents') return { get: (id: string) => init.parentOf?.(id) }
        if (name === 'sessionProjections') return init.projections ?? { stateOf: () => undefined }
        if (name === 'pluginPackages') {
            if (init.hostVersion === undefined) return undefined
            return { packageOf: () => ({ version: init.hostVersion }) }
        }
        return undefined
    }
    const ctx = {
        on(name: string, fn: unknown, opts?: unknown) {
            listeners.set(name, fn)
            options.set(name, opts)
            return () => {
                // 只摘「当时在册的那一个」：已被换掉的监听调 disposer 是空操作（与宿主 disposer 语义一致）
                if (listeners.get(name) === fn) {
                    listeners.delete(name)
                    return true
                }
                return false
            }
        },
        effect(execute: () => unknown, _label?: string) {
            const dispose = execute()
            if (typeof dispose === 'function') effects.push(dispose as () => void)
            return () => {}
        },
        inject(deps: readonly string[], callback: (child: Context) => void) {
            try {
                if (deps.every((name) => get(name) !== undefined)) callback(ctx as unknown as Context)
            } catch {
                // deps unavailable, fiber stays PENDING
            }
            return () => {}
        },
        get,
        logger: { info() {}, warn(msg: string) { warns.push(msg) }, error() {} },
    }
    return {
        ctx: ctx as unknown as Context,
        warns,
        /** 取某事件名当前在册监听（未注册即 undefined） */
        listenerOf: (name: string) => listeners.get(name) as AnyListener | undefined,
        optionsOf: (name: string) => options.get(name),
        /** 在册监听条数（注册形态与卸载判据） */
        sizeOf: () => listeners.size,
        /** 跑 effect 卸载逻辑（固定读两个 disposer 变量） */
        disposeEffects: () => {
            for (const dispose of effects.splice(0)) dispose()
        },
    }
}

/** 宿主「允许 Agent 为子智能体选择模型」服务桩 */
interface SelectionStub {
    current(): { enabled: boolean }
}

/** 宿主 `modelSelection` 投影的待生效选择（用户切换后、未被请求消费的那份） */
interface PendingSelection {
    readonly provider: string
    readonly model: string
    readonly reasoningEffort?: string
}

/** 宿主会话投影服务桩（只实现 `stateOf`） */
interface ProjectionStub {
    stateOf(session: Agent['session'], key: 'modelSelection'): { readonly pending: PendingSelection | null } | undefined
}

/** 投影桩：`pending` 传 undefined 表示该键未注册 */
function projectionsOf(pending: PendingSelection | null | undefined): ProjectionStub {
    return { stateOf: () => (pending === undefined ? undefined : { pending }) }
}

interface RunInit {
    /** 只覆盖「用户体验」组（判据仅 followParent） */
    config?: Partial<UserExperienceRules>
    agent: Agent
    /** 宿主 `agent/request` 种子配置 */
    host?: LlmCallConfig
    /** 宿主 `agent/pre-step` 落出的本步选择 */
    hostModel?: HostModelSelection
    /** 宿主 `agent/pre-step` 裁决（默认 `enter`） */
    hostDecision?: PreStepDecision
    /** 前置已 aborted（宿主拒绝本步的另一种形态） */
    aborted?: boolean
    selection?: SelectionStub
    parentOf?: (id: string) => Agent | undefined
    projections?: ProjectionStub
    getThrows?: boolean
    /** 宿主版本；不传默认新宿主（≥ HOST_MODEL_SELECT_SINCE） */
    hostVersion?: string
}

/** 宿主侧默认值：本步选择 `dsr`（无档位），请求种子 `dsr`（无预算），裁决 `enter` */
const HOST_MODEL: HostModelSelection = { provider: 'pi', model: 'dsr' }
const HOST_CONFIG: LlmCallConfig = { provider: 'pi', model: 'dsr' }
const HOST_DECISION: PreStepDecision = { kind: 'enter', messages: [] }

/** 新宿主（≥ 起点）：走「pre-step 切路由 + request 只并预算」 */
const NEW_HOST = '0.2.2-alpha.2'
/** 旧宿主（< 起点）：走「request 内覆盖路由 + 并预算」 */
const OLD_HOST = '0.2.1-rc.3'

/** 以指定配置装载插件，返回两个注入面的派发器 */
function mount(init: RunInit) {
    const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        userExperience: { ...DEFAULT_CONFIG.userExperience, ...init.config },
    }
    setConfigSource(() => config)
    const stub = makeCtx({
        selection: init.selection,
        parentOf: init.parentOf,
        projections: init.projections,
        getThrows: init.getThrows,
        hostVersion: 'hostVersion' in init ? init.hostVersion : NEW_HOST,
    })
    installSubagentFollowParent(stub.ctx)
    const hostModel = init.hostModel ?? HOST_MODEL
    const hostConfig = init.host ?? HOST_CONFIG
    const hostDecision = init.hostDecision ?? HOST_DECISION
    /** 派发 `agent/pre-step` 并返回裁决（未注册即宿主原裁决）；路由切换判据是 `agent.model.select` 调用记录 */
    const dispatchPreStep = async (): Promise<PreStepDecision> => {
        const listener = stub.listenerOf('agent/pre-step')
        if (listener === undefined) return hostDecision
        const signal = new AbortController().signal
        const aborted = init.aborted === true ? { get aborted() { return true } } as unknown as AbortSignal : signal
        const result = await listener({
            agent: init.agent,
            messages: [],
            turn: 1,
            step: 1,
            signal: aborted,
            modelSelection: hostModel,
        }, () => Promise.resolve(hostDecision))
        return result as PreStepDecision
    }
    /** 派发 `agent/request` 并返回本次请求配置（未注册即宿主原值） */
    const dispatchRequest = async (): Promise<LlmCallConfig> => {
        const listener = stub.listenerOf('agent/request')
        const result = listener === undefined ? hostConfig : await listener({ agent: init.agent }, () => Promise.resolve(hostConfig))
        return result as LlmCallConfig
    }
    return {
        stub,
        warns: stub.warns,
        dispatchPreStep,
        dispatchRequest,
        /** 本步被切过去的路由（跟随判据：宿主命令面调用记录） */
        selectsOf: () => init.agent.model.calls,
        /** 新宿主一步：`agent/pre-step` 严格先于 `agent/request` */
        step: async () => ({ decision: await dispatchPreStep(), request: await dispatchRequest() }),
    }
}

/** 关着子智能体选模型的宿主服务 */
const OFF: SelectionStub = { current: () => ({ enabled: false }) }

export async function run(): Promise<void> {
    const subagent = makeAgent({ origin: 'subagent', parentSession: 'p1' })

    // ---------- 注册面：按宿主版本决定注册形态 ----------
    const mounted = mount({ agent: subagent })
    check('installSubagentFollowParent: 新宿主注册 agent/request + agent/pre-step，且都 prepend 为真',
        mounted.stub.listenerOf('agent/request') !== undefined
        && mounted.stub.listenerOf('agent/pre-step') !== undefined
        && mounted.stub.sizeOf() === 2
        && stable(mounted.stub.optionsOf('agent/request')) === stable({ prepend: true })
        && stable(mounted.stub.optionsOf('agent/pre-step')) === stable({ prepend: true }))

    const mountedOld = mount({ agent: subagent, hostVersion: OLD_HOST })
    check('installSubagentFollowParent: 旧宿主只注册 agent/request（不注册 agent/pre-step）',
        mountedOld.stub.listenerOf('agent/request') !== undefined
        && mountedOld.stub.listenerOf('agent/pre-step') === undefined
        && mountedOld.stub.sizeOf() === 1
        && stable(mountedOld.stub.optionsOf('agent/request')) === stable({ prepend: true }))

    const mountedUnknown = mount({ agent: subagent, hostVersion: undefined })
    const mountedBad = mount({ agent: subagent, hostVersion: 'not-a-version' })
    check('installSubagentFollowParent: 宿主版本未知或非法 → 按旧宿主注册（不空转新面）',
        mountedUnknown.stub.listenerOf('agent/pre-step') === undefined
        && mountedBad.stub.listenerOf('agent/pre-step') === undefined
        && mountedUnknown.stub.listenerOf('agent/request') !== undefined
        && mountedBad.stub.listenerOf('agent/request') !== undefined)

    const mountedEdge = mount({ agent: subagent, hostVersion: '0.2.2-alpha.1' })
    const mountedSince = mount({ agent: subagent, hostVersion: '0.2.2-alpha.2' })
    const mountedStable = mount({ agent: subagent, hostVersion: '0.3.0' })
    check('installSubagentFollowParent: 版本阈值取 ≥ HOST_MODEL_SELECT_SINCE（差一个修订号即换形态）',
        mountedEdge.stub.listenerOf('agent/pre-step') === undefined
        && mountedSince.stub.listenerOf('agent/pre-step') !== undefined
        && mountedStable.stub.listenerOf('agent/pre-step') !== undefined)

    // ---------- 新宿主一步：路由经 agent.model.select() 切换，预算在 agent/request ----------
    {
        const agent = makeAgent({ origin: undefined, parentSession: 'p1' })
        const top = await mount({
            agent,
            config: { followParent: true },
            parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } }),
        }).step()
        check('跟随：非子智能体会话原样放行（跟随开关不碰主 Agent，也不 select）',
            stable(top.request) === stable({ provider: 'pi', model: 'dsr' })
            && agent.model.calls.length === 0)
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: false },
            selection: OFF,
            parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model' } }),
        }).step()
        check('跟随：宿主开关关闭且未开跟随 → 不 select',
            agent.model.calls.length === 0)
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        const follow = await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } } }),
            host: { provider: 'pi', model: 'dsr', reasoningEffort: 'low', maxTokens: 4096 } as LlmCallConfig,
            hostModel: { provider: 'pi', model: 'dsr', reasoningEffort: 'low' },
        }).step()
        check('跟随：本步选择与父路由有差异 → agent.model.select() 切过去；裁决原样透传，request 不碰路由项（新宿主校验要求）',
            stable(agent.model.calls) === stable([{ provider: 'pi', model: 'parent-model', reasoningEffort: 'high' }])
            && follow.decision.kind === 'enter'
            && stable(follow.request) === stable({ provider: 'pi', model: 'dsr', reasoningEffort: 'low', maxTokens: 4096 }))
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'dsr', reasoningEffort: 'high' } } }),
            hostModel: { provider: 'pi', model: 'dsr', reasoningEffort: 'high' },
        }).step()
        check('跟随：本步选择已与父一致 → 不重复 select',
            agent.model.calls.length === 0)
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            hostDecision: { kind: 'reject' },
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model' } } }),
        }).step()
        check('跟随：宿主裁决 reject → 不再 select',
            agent.model.calls.length === 0)
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            aborted: true,
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model' } } }),
        }).step()
        check('跟随：本步信号已 abort → 不 select',
            agent.model.calls.length === 0)
    }

    const tighter = await mount({
        agent: subagent,
        config: { followParent: true },
        selection: OFF,
        parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high', maxTokens: 2048 } } }),
        host: { provider: 'pi', model: 'dsr', maxTokens: 4096 } as LlmCallConfig,
    }).step()
    check('预算：父预算比子自带的小 → 取父的（跟随即收缩）',
        stable(tighter.request) === stable({ provider: 'pi', model: 'dsr', maxTokens: 2048 }))

    const looser = await mount({
        agent: subagent,
        config: { followParent: true },
        selection: OFF,
        parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high', maxTokens: 8192 } } }),
        host: { provider: 'pi', model: 'dsr', maxTokens: 4096 } as LlmCallConfig,
    }).step()
    check('预算：父预算比子自带的大 → 抬升差值八成（4096 + 4096×0.8 = 7372.8 取整 7372）',
        stable(looser.request) === stable({ provider: 'pi', model: 'dsr', maxTokens: 7372 }))

    const noBudget = await mount({
        agent: subagent,
        config: { followParent: true },
        selection: OFF,
        parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } } }),
    }).step()
    check('预算：父与子都无输出预算 → 不写该键',
        stable(noBudget.request) === stable({ provider: 'pi', model: 'dsr' }))

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            parentOf: () => makeAgent({
                header: {
                    config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'low' },
                    adapterDefaults: { reasoningEffort: true },
                },
            }),
            hostModel: { provider: 'pi', model: 'dsr', reasoningEffort: 'medium' },
        }).step()
        check('跟随：父档位被 adapterDefaults 标为兜底 → 当作未选档位，select 不带 reasoningEffort',
            stable(agent.model.calls) === stable([{ provider: 'pi', model: 'parent-model' }]))
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model', reasoningEffort: 'medium', maxTokens: 2048 } }),
        }).step()
        check('跟随：父无请求头 → 回落父 Agent 自身 options（预算同样跟过来）',
            stable(agent.model.calls) === stable([{ provider: 'pi', model: 'parent-model', reasoningEffort: 'medium' }]))
    }

    // ---------- 父会话待生效选择优先 ----------
    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        const pending = await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            projections: projectionsOf({ provider: 'pi', model: 'switched', reasoningEffort: 'high' }),
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'low', maxTokens: 2048 } } }),
            host: { provider: 'pi', model: 'dsr', maxTokens: 4096 } as LlmCallConfig,
        }).step()
        check('跟随：父有待生效选择 → 用它而非请求头旧路由（待生效选择无预算，保持子自带那份）',
            stable(agent.model.calls) === stable([{ provider: 'pi', model: 'switched', reasoningEffort: 'high' }])
            && stable(pending.request) === stable({ provider: 'pi', model: 'dsr', maxTokens: 4096 }))
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            projections: projectionsOf({ provider: 'pi', model: 'switched' }),
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'low' } } }),
            hostModel: { provider: 'pi', model: 'dsr', reasoningEffort: 'medium' },
        }).step()
        check('跟随：待生效选择无档位 → select 不带 reasoningEffort',
            stable(agent.model.calls) === stable([{ provider: 'pi', model: 'switched' }]))
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            projections: projectionsOf(null),
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } } }),
        }).step()
        const agent2 = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent: agent2,
            config: { followParent: true },
            selection: OFF,
            projections: projectionsOf(undefined),
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } } }),
        }).step()
        check('跟随：待生效选择已消费，或未注册投影 → 回落请求头',
            stable(agent.model.calls) === stable([{ provider: 'pi', model: 'parent-model', reasoningEffort: 'high' }])
            && stable(agent2.model.calls) === stable([{ provider: 'pi', model: 'parent-model', reasoningEffort: 'high' }]))
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: true },
            selection: OFF,
            projections: projectionsOf({ provider: '', model: 'switched' }),
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } } }),
        }).step()
        const agent2 = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent: agent2,
            config: { followParent: true },
            selection: OFF,
            projections: projectionsOf({ provider: 'pi', model: '' }),
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } } }),
        }).step()
        check('跟随：待生效选择缺 provider 或 model → 当作没有，回落请求头',
            stable(agent.model.calls) === stable([{ provider: 'pi', model: 'parent-model', reasoningEffort: 'high' }])
            && stable(agent2.model.calls) === stable([{ provider: 'pi', model: 'parent-model', reasoningEffort: 'high' }]))
    }

    // ---------- 旧宿主：同一份 agent/request 里覆盖路由 + 并预算 ----------
    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        const legacy = mount({
            agent,
            hostVersion: OLD_HOST,
            config: { followParent: true },
            selection: OFF,
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high', maxTokens: 8192 } } }),
            host: { provider: 'pi', model: 'dsr', reasoningEffort: 'low', maxTokens: 4096 } as LlmCallConfig,
        })
        const result = await legacy.dispatchRequest()
        check('旧宿主：agent/request 一步完成「覆盖路由三项 + 并预算」（无 select 面可用）',
            stable(result) === stable({ provider: 'pi', model: 'parent-model', reasoningEffort: 'high', maxTokens: 7372 })
            && agent.model.calls.length === 0
            && legacy.warns.length === 0)
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        const legacy = mount({
            agent,
            hostVersion: OLD_HOST,
            config: { followParent: true },
            selection: OFF,
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high', maxTokens: 2048 } } }),
            host: { provider: 'pi', model: 'dsr', maxTokens: 4096 } as LlmCallConfig,
        })
        const result = await legacy.dispatchRequest()
        check('旧宿主：预算规则与新宿主同源（父预算更小则取父的）',
            stable(result) === stable({ provider: 'pi', model: 'parent-model', reasoningEffort: 'high', maxTokens: 2048 }))
    }

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        const legacy = mount({
            agent,
            hostVersion: OLD_HOST,
            config: { followParent: false },
            selection: OFF,
            parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model' } } }),
        })
        const result = await legacy.dispatchRequest()
        check('旧宿主：未开跟随 → 原样放行',
            stable(result) === stable({ provider: 'pi', model: 'dsr' }))
    }

    // ---------- 异常兜底 ----------
    const projThrowsAgent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
    const projThrows = mount({
        agent: projThrowsAgent,
        config: { followParent: true },
        selection: OFF,
        projections: { stateOf() { throw new Error('投影未初始化') } },
        parentOf: () => makeAgent({ header: { config: { provider: 'pi', model: 'parent-model' } } }),
    })
    const thrown = await projThrows.step()
    check('异常兜底：读投影抛错 → 两个注入面各记一条 warn 且不 select，不拖垮子智能体这一步',
        thrown.decision.kind === 'enter'
        && stable(thrown.request) === stable({ provider: 'pi', model: 'dsr' })
        && projThrowsAgent.model.calls.length === 0
        && projThrows.warns.length === 2
        && projThrows.warns.every((msg) => msg.includes('子智能体跟随未生效')))

    const noParentIdAgent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
    const missingAgent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
    const noParentId = mount({ agent: noParentIdAgent, config: { followParent: true }, selection: OFF })
    const orphan = mount({ agent: makeAgent({ origin: 'subagent' }), config: { followParent: true }, selection: OFF })
    const missingParent = mount({ agent: missingAgent, config: { followParent: true }, selection: OFF, parentOf: () => undefined })
    const noParent = await noParentId.step()
    const orphanStep = await orphan.step()
    const missingStep = await missingParent.step()
    check('异常兜底：父不可得（无 parentSession / 查不到该会话）→ 不 select 且不记 warn',
        noParent.decision.kind === 'enter' && orphanStep.decision.kind === 'enter'
        && stable(missingStep.request) === stable({ provider: 'pi', model: 'dsr' })
        && noParentIdAgent.model.calls.length === 0
        && missingAgent.model.calls.length === 0
        && noParentId.warns.length === 0 && orphan.warns.length === 0 && missingParent.warns.length === 0)

    {
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        await mount({
            agent,
            config: { followParent: true },
            parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model' } }),
        }).step()
        check('hostSelectionEnabled: 宿主开关关闭 → 跟随父当前路由',
            stable(agent.model.calls) === stable([{ provider: 'pi', model: 'parent-model' }]))
    }

    {
        const throwing: SelectionStub = { current() { throw new Error('已开启但授权表为空') } }
        const agent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
        const onThrowCtx = mount({
            agent,
            config: { followParent: true },
            selection: throwing,
            parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model' } }),
        })
        const onThrow = await onThrowCtx.step()
        check('hostSelectionEnabled: current() 抛错（已开启但授权表为空）按关闭处理',
            onThrow.decision.kind === 'enter'
            && stable(agent.model.calls) === stable([{ provider: 'pi', model: 'parent-model' }])
            && onThrowCtx.warns.length === 0)
    }

    // ---------- 服务不可得：fiber 静默不激活，监听不注册 ----------
    const broken = mount({ agent: subagent, config: { followParent: true }, selection: OFF, getThrows: true })
    check('installSubagentFollowParent: 宿主服务不可得 → 子 fiber PENDING 静默（监听不注册，不拖垮子智能体）',
        broken.stub.listenerOf('agent/request') === undefined
        && broken.stub.listenerOf('agent/pre-step') === undefined
        && broken.warns.length === 0)

    // ---------- 卸载：effect 的固定闭包摘掉在册的两条监听 ----------
    const unloadLegacy = mount({ agent: subagent, config: { followParent: true }, selection: OFF })
    unloadLegacy.stub.disposeEffects()
    const unloadSwappedAgent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
    const unloadSwapped = mount({ agent: unloadSwappedAgent, config: { followParent: true }, selection: OFF })
    await unloadSwapped.step()
    unloadSwapped.stub.disposeEffects()
    check('卸载：effect 的 disposer 在旧轨与换轨后都能摘净两条监听',
        unloadLegacy.stub.sizeOf() === 0 && unloadSwapped.stub.sizeOf() === 0)

    // 收尾把配置源放回默认，避免影响其余模块
    setConfigSource(() => DEFAULT_CONFIG)
}
