/**
 * 「验证模型」的跨半契约：探测明细、逐提供方汇报、进度帧。
 *
 * 放在共享层而非 Node 半，是因为浏览器半要解析回传的结果与进度帧——浏览器半不能反向 import Node 半
 * （`tsdown.config.ts` 的跨半纯度门禁），而复制一份类型必然随演进漂移。
 * 本文件只有类型与纯谓词：零 Node 依赖、零 schemastery、零宿主值导入。
 */

/** 单次探测：一次请求 = 一个「模型 × 推理级别」组合（effort 缺省即不带档位探测） */
export interface VerifyProbe {
    provider: string
    model: string
    effort?: string
}

/**
 * 单次探测的判定结果。分类只依据宿主 `LlmFailure` 的 `code` 与 `status`——宿主明令
 * 「route on `code`, never by parsing `message`」，故两侧都不做文案比对。
 */
export type ProbeOutcome =
    /** 收到 `block-start`：该「模型 × 档位」确实受支持 */
    | 'usable'
    /** 宿主在派发前本地判定该档位不被支持（`UNSUPPORTED_REASONING_EFFORT`，请求根本没发出去） */
    | 'unsupported-effort'
    /** 传输层失败且无 HTTP status：端点不可达（DNS / 拒绝连接） */
    | 'unreachable'
    /** 额度或余额耗尽 */
    | 'quota'
    /** 凭据缺失或无效 */
    | 'credential'
    /** 其它厂商侧拒绝；多与**具体模型**有关（如同名模型不存在），故不参与短路 */
    | 'other'

/** provider 级失败：命中即整组短路——同一提供方共用同一 url 与同一把 key，一次过不了后面同样过不了 */
export type ProviderBlockReason = 'unreachable' | 'quota' | 'credential'

/** 该结果是否构成 provider 级失败（命中即整组短路） */
export function isProviderBlocking(outcome: ProbeOutcome): outcome is ProviderBlockReason {
    return outcome === 'unreachable' || outcome === 'quota' || outcome === 'credential'
}

/** 失败的原始事实（宿主 `LlmFailure` 的可序列化子集）：供调用方做比本插件更细的分类与展示 */
export interface VerifyFailureFacts {
    code: string
    /** HTTP 状态；传输层失败没有它（宿主兜底对象只给 code 与 message） */
    status: number | undefined
    /** 人类可读的失败描述——**仅供展示与诊断，分类绝不可依赖它**（各厂商措辞不同且会变） */
    message: string
}

/**
 * 单条探测明细：一个「提供方 / 模型 / 推理级别」及其结论。调用方可据此做后续操作
 * （只重验某个提供方、只补验某些档位、按 code 细分失败原因等），不必再回解析统计值。
 *
 * 明细只含**实际发出**的探测：被短路掉的从未发出去、没有结论可言。哪几条没跑，
 * 由逐提供方的 `planned` 与 `probed` 之差给出（短路以整组为单位，故按组定位即可）。
 */
export interface VerifyProbeResult {
    provider: string
    model: string
    /** 推理级别；模型未声明档位时为 undefined（不带档位探测），经 JSON 传输后该键缺省 */
    effort: string | undefined
    outcome: ProbeOutcome
    /** 失败时的原始事实；收到 block-start 时为 undefined */
    failure: VerifyFailureFacts | undefined
}

/** 一个提供方的探测结论：逐条明细 + 短路情况（由 Node 半执行器产出，供汇报函数消费） */
export interface ProviderProbeOutcome {
    provider: string
    /** 与该组探测清单前缀对齐：短路时长度小于 planned */
    results: VerifyProbeResult[]
    blockedBy: ProviderBlockReason | undefined
    planned: number
}

/** 单个提供方的验证结论（逐提供方可见） */
export interface VerifyProviderReport {
    provider: string
    /** 端点可达：全程未出现传输层失败 */
    reachable: boolean
    /** 凭据有效且有额度：可达且全程未出现额度 / 凭据类失败（从未可达时不作断言） */
    keyValid: boolean
    /** 整组是否因 provider 级失败被短路 */
    skipped: boolean
    blockedBy: ProviderBlockReason | undefined
    /** 该组内可用模型数（按「提供方 / 模型」去重） */
    models: number
    /** 该组内可用档位数 */
    efforts: number
    /** 判定为「档位不支持」的探测数：逐模型逐档位，故与其它失败分开计数 */
    unsupported: number
    /** 计划探测数 */
    planned: number
    /** 实际发出数（短路时小于 planned） */
    probed: number
}

/** 验证结果汇总：逐提供方汇报 + 逐条明细 + 全局计数 */
export interface VerifySummary {
    providers: readonly VerifyProviderReport[]
    /** 逐条探测明细，顺序为「组序 → 组内探测序」，可重复消费 */
    results: readonly VerifyProbeResult[]
    models: number
    efforts: number
    unsupported: number
    planned: number
    probed: number
}

/**
 * 一次验证运行的进度帧判别联合。投递顺序即帧顺序：先是唯一一条 `opened`，
 * 随后每完成一条探测发一条 `probed`，最后收于唯一一条 `done`。
 *
 * 中途被中止（用户点停止、关窗、连接断开）时**不发 `done`**——收到流自然结束却没等到 `done`，
 * 消费方即知这轮没跑完，据此决定是保留进度还是标错误。
 *
 * 刻意不加的字段：`seq`（单条连接天然保序，编号是为可重放观察者准备的）、`elapsedMs`
 * （交由终端节点自持，别让传输格式随渲染需求膨胀）。
 */
export type VerifyProgressFrame =
    /** 开流即发的第一条：让 UI 立刻知道总共几项，而不是对着空白等第一条结果 */
    | { type: 'opened'; total: number }
    /**
     * 一条探测出结果。`done`/`total` 是跨提供方并行的累计位置，直接显示为进度。
     * `skipped` 仅在该结论触发 provider 级短路时出现，值为该组剩余未发出的条数。
     */
    | {
        type: 'probed'
        provider: string
        model: string
        effort: string | undefined
        outcome: ProbeOutcome
        skipped?: number
        done: number
        total: number
    }
    /** 终帧：整轮跑完，`summary` 是与旧版 RPC 等价的完整结论 */
    | { type: 'done'; summary: VerifySummary }
