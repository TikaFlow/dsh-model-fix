// subagent.ts 纯逻辑测试：agent/request 注入的跟随父路由、父档位可得不与异常兜底
import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, LlmCallConfigAdapterDefaults, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { check, stable } from '@test/helper'
import { installSubagentFollowParent } from '@/subagent'
import { setConfigSource } from '@/config'
import { DEFAULT_CONFIG } from '@/shared/parse'
import type { PluginConfig, UserExperienceRules } from '@/shared/types'

/**
 * 最小 Agent 桩类型——与 `src/subagent.ts` 里那份契约复制同形。
 * 不引宿主 `@deepseek-ai/dsh-agent` 包根类型：它会把 `@deepseek-ai/dsh-session` 包根类型拉进
 * 整个 typecheck 程序，顶掉浏览器半 `ctx.sessions` 的 `ISessions` 增补（详见 `docs/host-api.md`）。
 */
interface Agent {
    readonly session: {
        readonly header: { readonly origin?: string; readonly parentSession?: SessionId }
        requestHeader(): { readonly config: LlmCallConfig; readonly adapterDefaults?: LlmCallConfigAdapterDefaults } | undefined
    }
    readonly options: { readonly provider?: string; readonly model?: string; readonly reasoningEffort?: ReasoningEffortId }
}

/** 瀑布监听签名（与宿主 `agent/request` 一致） */
type RequestListener = (payload: { agent: Agent }, next: () => Promise<LlmCallConfig>) => Promise<LlmCallConfig>

/** 最小 Agent 桩：中间件只读 `session.header`（origin / parentSession）、`session.requestHeader()` 与 `options` */
function makeAgent(init: {
    origin?: string
    parentSession?: string
    options?: { provider: string; model: string; reasoningEffort?: string }
    header?: unknown
}): Agent {
    return {
        session: {
            header: { origin: init.origin, parentSession: init.parentSession },
            requestHeader: () => init.header,
        },
        options: init.options ?? { provider: 'p', model: 'm' },
    } as unknown as Agent
}

/** 最小 ctx 桩：只补中间件真正消费的三个面——`on` 注册、`get`（两个服务）、`logger.warn` */
function makeCtx(init: {
    selection?: SelectionStub
    parentOf?: (id: string) => Agent | undefined
    getThrows?: boolean
}) {
    const warns: string[] = []
    let listener: RequestListener | undefined
    let options: unknown
    const ctx = {
        on(name: string, fn: RequestListener, opts?: unknown) {
            if (name === 'agent/request') {
                listener = fn
                options = opts
            }
            return () => {}
        },
        get(name: string) {
            if (init.getThrows === true) throw new Error('服务不可用')
            if (name === 'subagentModelSelection') return init.selection
            if (name === 'agents') return { get: (id: string) => init.parentOf?.(id) }
            return undefined
        },
        logger: { info() {}, warn(msg: string) { warns.push(msg) }, error() {} },
    }
    return {
        ctx: ctx as unknown as Context,
        warns,
        /** 取注册到的瀑布监听（未注册即 undefined，注册面本身的断言用） */
        listenerOf: () => listener,
        optionsOf: () => options,
    }
}

/** 宿主「允许 Agent 为子智能体选择模型」服务桩 */
interface SelectionStub {
    current(): { enabled: boolean }
}

interface RunInit {
    /** 只覆盖「用户体验」组（本测试的判据只有 followParent 一项） */
    config?: Partial<UserExperienceRules>
    agent: Agent
    host?: LlmCallConfig
    selection?: SelectionStub
    parentOf?: (id: string) => Agent | undefined
    getThrows?: boolean
}

/** 以指定配置装载插件并跑一次请求：返回宿主原始配置经中间件改写后的结果 */
async function runOnce(init: RunInit): Promise<{ result: LlmCallConfig; warns: string[]; listener: RequestListener | undefined; options: unknown }> {
    const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        userExperience: { ...DEFAULT_CONFIG.userExperience, ...init.config },
    }
    setConfigSource(() => config)
    const stub = makeCtx({ selection: init.selection, parentOf: init.parentOf, getThrows: init.getThrows })
    installSubagentFollowParent(stub.ctx)
    const listener = stub.listenerOf()
    const host: LlmCallConfig = init.host ?? { provider: 'pi', model: 'dsr' }
    const result = listener === undefined ? host : await listener({ agent: init.agent }, () => Promise.resolve(host))
    return { result, warns: stub.warns, listener, options: stub.optionsOf() }
}

/** 关着「允许 Agent 为子智能体选择模型」的宿主服务 */
const OFF: SelectionStub = { current: () => ({ enabled: false }) }

export async function run(): Promise<void> {
    // ---------- installSubagentFollowParent：注册面与作用域 ----------
    const subagent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
    const mounted = await runOnce({ agent: subagent })
    check('installSubagentFollowParent: 监听注册在 agent/request 且 prepend 为真',
        mounted.listener !== undefined && stable(mounted.options) === stable({ prepend: true }))

    // ---------- 非子智能体会话原样放行 ----------
    const top = await runOnce({
        agent: makeAgent({ origin: undefined, parentSession: 'p1' }),
        config: { followParent: true },
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } }),
    })
    check('resolveRequest: 非子智能体会话原样放行（跟随开关不碰主 Agent）',
        stable(top.result) === stable({ provider: 'pi', model: 'dsr' }))

    // ---------- 宿主开关关闭：跟随父 Agent 的路由三件套 ----------
    const offIdle = await runOnce({
        agent: subagent,
        config: { followParent: false },
        selection: OFF,
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model' } }),
    })
    check('resolveRequest: 宿主开关关闭且未开跟随 → 原样',
        stable(offIdle.result) === stable({ provider: 'pi', model: 'dsr' }))

    const offFollow = await runOnce({
        agent: subagent,
        config: { followParent: true },
        selection: OFF,
        parentOf: () => makeAgent({
            header: { config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } },
        }),
        host: { provider: 'pi', model: 'dsr', reasoningEffort: 'low', maxTokens: 4096 } as LlmCallConfig,
    })
    check('resolveRequest: 开跟随 → 整条覆盖为父当前生效的路由三件套（其余字段原样保留）',
        stable(offFollow.result) === stable({ provider: 'pi', model: 'parent-model', reasoningEffort: 'high', maxTokens: 4096 }))

    const offAdapterDefault = await runOnce({
        agent: subagent,
        config: { followParent: true },
        selection: OFF,
        parentOf: () => makeAgent({
            header: {
                config: { provider: 'pi', model: 'parent-model', reasoningEffort: 'low' },
                adapterDefaults: { reasoningEffort: true },
            },
        }),
    })
    check('resolveRequest: 父的档位被 adapterDefaults 标为兜底 → 当作未选档位而丢弃该键',
        stable(offAdapterDefault.result) === stable({ provider: 'pi', model: 'parent-model' }))

    const offNoHeader = await runOnce({
        agent: subagent,
        config: { followParent: true },
        selection: OFF,
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model', reasoningEffort: 'medium' } }),
    })
    check('resolveRequest: 父尚无请求头 → 回落父 Agent 自身的 options',
        stable(offNoHeader.result) === stable({ provider: 'pi', model: 'parent-model', reasoningEffort: 'medium' }))

    const noParentId = await runOnce({ agent: subagent, config: { followParent: true }, selection: OFF })
    const orphan = await runOnce({
        agent: makeAgent({ origin: 'subagent' }),
        config: { followParent: true },
        selection: OFF,
    })
    const missingParent = await runOnce({
        agent: subagent,
        config: { followParent: true },
        selection: OFF,
        parentOf: () => undefined,
    })
    check('resolveRequest: 父不可得（无 parentSession / 查不到该会话）→ 原样',
        stable(noParentId.result) === stable({ provider: 'pi', model: 'dsr' })
        && stable(orphan.result) === stable({ provider: 'pi', model: 'dsr' })
        && stable(missingParent.result) === stable({ provider: 'pi', model: 'dsr' }))

    // ---------- 宿主服务缺席或抛错 ----------
    const noService = await runOnce({
        agent: subagent,
        config: { followParent: true },
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model' } }),
    })
    check('hostSelectionEnabled: 服务缺席（CLI/TUI 组合）按关闭处理，跟随分支照常生效',
        stable(noService.result) === stable({ provider: 'pi', model: 'parent-model' }))

    const throwing: SelectionStub = {
        current() { throw new Error('已开启但授权表为空') },
    }
    const onThrow = await runOnce({
        agent: subagent,
        config: { followParent: true },
        selection: throwing,
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model' } }),
    })
    check('hostSelectionEnabled: current() 抛错（已开启但授权表为空）按关闭处理',
        stable(onThrow.result) === stable({ provider: 'pi', model: 'parent-model' }) && onThrow.warns.length === 0)

    // ---------- 异常兜底：取父 Agent 抛错时记一条 warn 并原样放行，不拖垮子智能体这一请求 ----------
    const broken = await runOnce({
        agent: subagent,
        config: { followParent: true },
        selection: OFF,
        getThrows: true,
    })
    check('installSubagentFollowParent: 取父 Agent 失败 → 记一条 warn 并原样放行，不拖垮子智能体这一请求',
        stable(broken.result) === stable({ provider: 'pi', model: 'dsr' })
        && broken.warns.length === 1
        && broken.warns[0].includes('子智能体推理级别未生效'))

    // 收尾把配置源放回默认，避免影响其余模块
    setConfigSource(() => DEFAULT_CONFIG)
}