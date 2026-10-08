// subagent.ts 纯逻辑测试：策略定档 resolvePolicy / agent/request 注入的宿主开关互斥、跟随父路由、父档位可得不与异常兜底
import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, LlmCallConfigAdapterDefaults, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { check, stable } from '@test/helper'
import { installSubagentEffort, resolvePolicy } from '@/subagent'
import { setConfigSource } from '@/config'
import { API_NS } from '@/shared/constants'
import { DEFAULT_CONFIG } from '@/shared/parse'
import type { PluginConfig } from '@/shared/types'

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

/** 宿主声明档位表按设置文档 revision 做模块级缓存，故每个桩给一份递增值，避免用例间共用同一份声明 */
let revisionSeq = 0

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

/** 宿主「允许 Agent 为子智能体选择模型」服务桩 */
interface SelectionStub {
    current(): { enabled: boolean }
}

/** 最小 ctx 桩：只补中间件真正消费的四个面——`on` 注册、`get`（两个服务）、`settings.describe`、`logger.warn` */
function makeCtx(init: {
    selection?: SelectionStub
    parentOf?: (id: string) => Agent | undefined
    api?: Record<string, unknown>
    describeThrows?: boolean
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
            if (name === 'subagentModelSelection') return init.selection
            if (name === 'agents') return { get: (id: string) => init.parentOf?.(id) }
            return undefined
        },
        settings: {
            describe() {
                if (init.describeThrows === true) throw new Error('settings 不可读')
                return [{ ns: API_NS, user: init.api ?? {}, revision: ++revisionSeq }]
            },
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

interface RunInit {
    config?: Partial<PluginConfig['subagent']>
    memory?: Record<string, Record<string, string>>
    agent: Agent
    host?: LlmCallConfig
    selection?: SelectionStub
    parentOf?: (id: string) => Agent | undefined
    api?: Record<string, unknown>
    describeThrows?: boolean
}

/** 以指定配置装载插件并跑一次请求：返回宿主原始配置经中间件改写后的结果 */
async function runOnce(init: RunInit): Promise<{ result: LlmCallConfig; warns: string[]; listener: RequestListener | undefined; options: unknown }> {
    const config: PluginConfig = {
        ...DEFAULT_CONFIG,
        subagent: { ...DEFAULT_CONFIG.subagent, ...init.config },
        efforts: init.memory ?? DEFAULT_CONFIG.efforts,
    }
    setConfigSource(() => config)
    const stub = makeCtx(init)
    installSubagentEffort(stub.ctx)
    const listener = stub.listenerOf()
    const host: LlmCallConfig = init.host ?? { provider: 'pi', model: 'dsr' }
    const result = listener === undefined ? host : await listener({ agent: init.agent }, () => Promise.resolve(host))
    return { result, warns: stub.warns, listener, options: stub.optionsOf() }
}

/** 声明了 low/high/max 三个档位的 llm-pi-ai 段（声明键刻意乱序，用例据此断言归一升序） */
const DECLARED_API = {
    providers: {
        pi: {
            models: [
                { id: 'dsr', reasoningEfforts: { max: {}, high: {}, low: {}, off: {} } },
                { id: 'bare', reasoningEfforts: false },
                { id: 'unknown' },
                { id: 'weird', reasoningEfforts: { turbo: {}, high: {} } },
            ],
        },
        empty: { models: [] },
        broken: 'not-an-object',
    },
}

/** 关着「允许 Agent 为子智能体选择模型」的宿主服务 */
const OFF: SelectionStub = { current: () => ({ enabled: false }) }
/** 开着的宿主服务 */
const ON: SelectionStub = { current: () => ({ enabled: true }) }

export async function run(): Promise<void> {
    // ---------- resolvePolicy：纯函数，四种策略各自的取值口径 ----------
    check('resolvePolicy: none 一律不干预（即便有记忆与声明档位）',
        resolvePolicy('none', ['low', 'high'], 'high') === undefined)
    check('resolvePolicy: min 取声明档位首项',
        resolvePolicy('min', ['low', 'high', 'max'], undefined) === 'low')
    check('resolvePolicy: max 取声明档位末项',
        resolvePolicy('max', ['low', 'high', 'max'], undefined) === 'max')
    check('resolvePolicy: 声明档位为空时 min/max 都取不到值即不干预',
        resolvePolicy('min', [], 'high') === undefined
        && resolvePolicy('max', [], 'high') === undefined)
    check('resolvePolicy: memory 命中且该模型已声明则用它',
        resolvePolicy('memory', ['low', 'medium'], 'medium') === 'medium')
    check('resolvePolicy: memory 命中但该模型未声明、且未声明 high 则不干预',
        resolvePolicy('memory', ['low', 'medium'], 'xhigh') === undefined)
    check('resolvePolicy: memory 未命中且未声明 high 则不干预',
        resolvePolicy('memory', ['low', 'medium'], undefined) === undefined)
    check('resolvePolicy: memory 命中且已声明时不因表内缺 high 而改判',
        resolvePolicy('memory', ['low'], 'low') === 'low')

    // ---------- installSubagentEffort：注册面与作用域 ----------
    const subagent = makeAgent({ origin: 'subagent', parentSession: 'p1' })
    const mounted = await runOnce({ agent: subagent })
    check('installSubagentEffort: 监听注册在 agent/request 且 prepend 为真',
        mounted.listener !== undefined && stable(mounted.options) === stable({ prepend: true }))

    const top = await runOnce({
        agent: makeAgent({ origin: undefined, parentSession: 'p1' }),
        config: { follow: true, effort: 'max' },
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model', reasoningEffort: 'high' } }),
        api: DECLARED_API,
        selection: ON,
    })
    check('resolveRequest: 非子智能体会话原样放行（两条策略都不碰主 Agent）',
        stable(top.result) === stable({ provider: 'pi', model: 'dsr' }) && top.warns.length === 0)

    // ---------- 宿主开关关闭：跟随父 Agent 的路由三件套 ----------
    const offIdle = await runOnce({
        agent: subagent,
        config: { follow: false, effort: 'max' },
        selection: OFF,
        api: DECLARED_API,
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model' } }),
    })
    check('resolveRequest: 宿主开关关闭且未开跟随 → 原样（effort 策略在此分支不生效）',
        stable(offIdle.result) === stable({ provider: 'pi', model: 'dsr' }))

    const offFollow = await runOnce({
        agent: subagent,
        config: { follow: true },
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
        config: { follow: true },
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
        config: { follow: true },
        selection: OFF,
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model', reasoningEffort: 'medium' } }),
    })
    check('resolveRequest: 父尚无请求头 → 回落父 Agent 自身的 options',
        stable(offNoHeader.result) === stable({ provider: 'pi', model: 'parent-model', reasoningEffort: 'medium' }))

    const noParentId = await runOnce({ agent: subagent, config: { follow: true }, selection: OFF })
    const orphan = await runOnce({
        agent: makeAgent({ origin: 'subagent' }),
        config: { follow: true },
        selection: OFF,
    })
    const missingParent = await runOnce({
        agent: subagent,
        config: { follow: true },
        selection: OFF,
        parentOf: () => undefined,
    })
    check('resolveRequest: 父不可得（无 parentSession / 查不到该会话）→ 原样',
        stable(noParentId.result) === stable({ provider: 'pi', model: 'dsr' })
        && stable(orphan.result) === stable({ provider: 'pi', model: 'dsr' })
        && stable(missingParent.result) === stable({ provider: 'pi', model: 'dsr' }))

    // ---------- 宿主开关开启：按策略定档 ----------
    const onNone = await runOnce({ agent: subagent, config: { effort: 'none' }, selection: ON, api: DECLARED_API })
    check('resolveRequest: 宿主开关开启且策略 none → 原样（跟随开关在此分支不生效）',
        stable(onNone.result) === stable({ provider: 'pi', model: 'dsr' }))

    const onMax = await runOnce({ agent: subagent, config: { effort: 'max' }, selection: ON, api: DECLARED_API })
    check('resolveRequest: 策略 max → 取该模型声明档位的最高项（声明键乱序亦然，且剔掉 off）',
        stable(onMax.result) === stable({ provider: 'pi', model: 'dsr', reasoningEffort: 'max' }))

    const onMin = await runOnce({ agent: subagent, config: { effort: 'min' }, selection: ON, api: DECLARED_API })
    check('resolveRequest: 策略 min → 取声明档位最低项',
        stable(onMin.result) === stable({ provider: 'pi', model: 'dsr', reasoningEffort: 'low' }))

    const onMemory = await runOnce({
        agent: subagent,
        config: { effort: 'memory' },
        memory: { pi: { dsr: 'low' } },
        selection: ON,
        api: DECLARED_API,
    })
    check('resolveRequest: 策略 memory 且记忆命中 → 用记忆里的档位',
        stable(onMemory.result) === stable({ provider: 'pi', model: 'dsr', reasoningEffort: 'low' }))

    const onMemoryMiss = await runOnce({
        agent: subagent,
        config: { effort: 'memory' },
        memory: { pi: { dsr: 'xhigh' } },
        selection: ON,
        api: DECLARED_API,
    })
    check('resolveRequest: 策略 memory 记忆未命中该模型的声明档位 → 回落 high',
        stable(onMemoryMiss.result) === stable({ provider: 'pi', model: 'dsr', reasoningEffort: 'high' }))

    const onMemoryEmpty = await runOnce({
        agent: subagent,
        config: { effort: 'memory' },
        memory: {},
        selection: ON,
        api: DECLARED_API,
    })
    check('resolveRequest: 策略 memory 完全无记忆 → 回落 high',
        stable(onMemoryEmpty.result) === stable({ provider: 'pi', model: 'dsr', reasoningEffort: 'high' }))

    const onUndeclared = await runOnce({
        agent: subagent,
        config: { effort: 'max' },
        selection: ON,
        api: DECLARED_API,
        host: { provider: 'pi', model: 'bare' },
    })
    const onNoTable = await runOnce({
        agent: subagent,
        config: { effort: 'max' },
        selection: ON,
        api: DECLARED_API,
        host: { provider: 'pi', model: 'unknown' },
    })
    check('resolveRequest: 模型未声明档位（reasoningEfforts:false / 无该字段）→ 原样，交宿主解析其默认档位',
        stable(onUndeclared.result) === stable({ provider: 'pi', model: 'bare' })
        && stable(onNoTable.result) === stable({ provider: 'pi', model: 'unknown' }))

    const onWeird = await runOnce({
        agent: subagent,
        config: { effort: 'max' },
        selection: ON,
        api: DECLARED_API,
        host: { provider: 'pi', model: 'weird' },
    })
    check('declaredLevelsOf: 只认 EFFORT_LEVELS 内的键（turbo 与 off 都被剔）',
        stable(onWeird.result) === stable({ provider: 'pi', model: 'weird', reasoningEffort: 'high' }))

    const onBroken = await runOnce({
        agent: subagent,
        config: { effort: 'max' },
        selection: ON,
        api: DECLARED_API,
        host: { provider: 'empty', model: 'x' },
    })
    check('declaredLevelsOf: 段形状异常（提供方非对象 / models 非数组）不抛错，取不到即原样',
        stable(onBroken.result) === stable({ provider: 'empty', model: 'x' }) && onBroken.warns.length === 0)

    // ---------- 宿主服务缺席或抛错 ----------
    const noService = await runOnce({
        agent: subagent,
        config: { follow: true },
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model' } }),
    })
    check('hostSelectionEnabled: 服务缺席（CLI/TUI 组合）按关闭处理，跟随分支照常生效',
        stable(noService.result) === stable({ provider: 'pi', model: 'parent-model' }))

    const throwing: SelectionStub = {
        current() { throw new Error('已开启但授权表为空') },
    }
    const onThrow = await runOnce({
        agent: subagent,
        config: { follow: true },
        selection: throwing,
        parentOf: () => makeAgent({ options: { provider: 'pi', model: 'parent-model' } }),
    })
    check('hostSelectionEnabled: current() 抛错（已开启但授权表为空）按关闭处理',
        stable(onThrow.result) === stable({ provider: 'pi', model: 'parent-model' }) && onThrow.warns.length === 0)

    // ---------- 异常兜底 ----------
    const broken = await runOnce({
        agent: subagent,
        config: { effort: 'max' },
        selection: ON,
        describeThrows: true,
    })
    check('installSubagentEffort: 读取宿主段失败 → 记一条 warn 并原样放行，不拖垮子智能体这一请求',
        stable(broken.result) === stable({ provider: 'pi', model: 'dsr' })
        && broken.warns.length === 1
        && broken.warns[0].includes('子智能体推理级别未生效'))

    // ---------- 声明表随 revision 重建 ----------
    setConfigSource(() => ({ ...DEFAULT_CONFIG, subagent: { follow: false, effort: 'max' } }))
    const first = makeCtx({ selection: ON, api: DECLARED_API })
    installSubagentEffort(first.ctx)
    const before = first.listenerOf()
    if (before !== undefined) {
        const beforeConfig = await before({ agent: subagent }, () => Promise.resolve({ provider: 'pi', model: 'dsr' }))
        const second = makeCtx({ selection: ON, api: { providers: { pi: { models: [{ id: 'dsr', reasoningEfforts: { minimal: {} } }] } } } })
        installSubagentEffort(second.ctx)
        const after = second.listenerOf()
        const afterConfig = after === undefined
            ? undefined
            : await after({ agent: subagent }, () => Promise.resolve({ provider: 'pi', model: 'dsr' }))
        check('advertisedEfforts: 设置文档 revision 一变即重建声明档位表（同一进程内连读两次得到不同档位）',
            beforeConfig.reasoningEffort === 'max' && afterConfig?.reasoningEffort === 'minimal')
    }

    // 收尾把配置源放回默认，避免影响其余模块
    setConfigSource(() => DEFAULT_CONFIG)
}