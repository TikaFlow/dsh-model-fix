// src/verify.ts 用例：探测清单展开（笛卡尔积 / 无档位 / 入参校验）、按提供方分组、失败分类、逐组汇报、
// 汇总求和，以及带桩跑通的整条执行链（分组串行 + provider 级失败短路）
import { classifyFailure, groupProbesByProvider, planProbes, reportProvider, summarizeProviders, verifyModels } from '@/verify'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm/types'
import { decodeProgressFrame, encodeProgressFrame, isProviderBlocking } from '@/shared/verify-progress'
import type { ProbeOutcome, VerifyProbe, VerifyProbeResult, VerifyProgressFrame, VerifyProviderReport } from '@/shared/verify-progress'
import { check, stable } from '@test/helper'

/** 一个模型的载荷；参数收 unknown 以便构造非法入参用例（RPC 入参按不可信输入校验） */
const entry = (provider: unknown, model: unknown, efforts: unknown): Record<string, unknown> => ({ provider, model, efforts })

/** 失败事实桩：message 各厂商不同，分类不得依赖它 */
const failure = (code: string, status?: number): LlmFailure =>
    ({ code, message: '文案随便写，各厂商都不一样', ...(status === undefined ? {} : { status }) }) as LlmFailure

/** 分片桩：成功流先吐 block-start，终止流只吐 finish */
const BLOCK_START = { type: 'block-start', index: 0, blockType: 'text' }
const FINISH_STOP = { type: 'finish', reason: { kind: 'stop' } }
const finishError = (code: string, status?: number): StreamChunk =>
    ({ type: 'finish', reason: { kind: 'error', failure: failure(code, status) } }) as unknown as StreamChunk

/** 执行本文件的全部用例 */
export async function run(): Promise<void> {
    // ---------- planProbes：笛卡尔积（模型序 × 档位序） ----------
    check(
        'planProbes 展开笛卡尔积',
        stable(planProbes({ models: [entry('a', 'm1', ['off', 'high']), entry('a', 'm2', ['low'])] })) === stable([
            { provider: 'a', model: 'm1', effort: 'off' },
            { provider: 'a', model: 'm1', effort: 'high' },
            { provider: 'a', model: 'm2', effort: 'low' },
        ]),
    )
    // ---------- planProbes：无档位模型产出一次不带 effort 的探测 ----------
    check(
        'planProbes 无档位模型不带 effort',
        stable(planProbes({ models: [entry('a', 'plain', []), entry('a', 'x', ['max'])] })) === stable([
            { provider: 'a', model: 'plain' },
            { provider: 'a', model: 'x', effort: 'max' },
        ]),
    )
    // ---------- planProbes：入参校验一律拒绝 ----------
    check('planProbes 非对象拒绝', planProbes(undefined) === undefined)
    check('planProbes models 非数组拒绝', planProbes({ models: {} }) === undefined)
    check('planProbes models 空数组拒绝', planProbes({ models: [] }) === undefined)
    check('planProbes 条目非对象拒绝', planProbes({ models: ['a'] }) === undefined)
    check('planProbes provider 非字符串拒绝', planProbes({ models: [entry('', 'm', [])] }) === undefined)
    check('planProbes model 非字符串拒绝', planProbes({ models: [entry('a', 1, [])] }) === undefined)
    check('planProbes efforts 非数组拒绝', planProbes({ models: [{ provider: 'a', model: 'm' }] }) === undefined)
    check('planProbes 档位非字符串拒绝', planProbes({ models: [entry('a', 'm', [1])] }) === undefined)
    // 档位必须落在 harness 支持的取值内（'none' 是目录侧拼写，写入配置时已归一为 'off'）
    check('planProbes 未知档位拒绝', planProbes({ models: [entry('a', 'm', ['turbo'])] }) === undefined)
    check('planProbes 目录拼写 none 拒绝', planProbes({ models: [entry('a', 'm', ['none'])] }) === undefined)
    // ---------- planProbes：探测总数超上限即拒绝（笛卡尔积会放大条目，静默截断会漏验） ----------
    const many = Array.from({ length: 100 }, (_, i) => entry('a', `m${i}`, ['low', 'medium', 'high']))
    check('planProbes 超上限拒绝', planProbes({ models: many }) === undefined)
    const atLimit = Array.from({ length: 50 }, (_, i) => entry('a', `m${i}`, ['low', 'medium', 'high', 'off']))
    check('planProbes 恰在上限放行', planProbes({ models: atLimit })?.length === 200)

    // ---------- groupProbesByProvider：同 provider 归一组、组内原序、下标回填 ----------
    const interleaved: VerifyProbe[] = [
        { provider: 'a', model: 'm1', effort: 'off' },
        { provider: 'b', model: 'n1', effort: 'low' },
        { provider: 'a', model: 'm2', effort: 'high' },
    ]
    check(
        'groupProbesByProvider 按 provider 归组并保序',
        stable(groupProbesByProvider(interleaved)) === stable([
            { provider: 'a', indexes: [0, 2], probes: [interleaved[0], interleaved[2]] },
            { provider: 'b', indexes: [1], probes: [interleaved[1]] },
        ]),
        groupProbesByProvider(interleaved),
    )
    check('groupProbesByProvider 空输入得空组', groupProbesByProvider([]).length === 0)

    // ---------- classifyFailure：只认 code 与 status，绝不比对文案 ----------
    check('classifyFailure 档位不被支持', classifyFailure(failure('UNSUPPORTED_REASONING_EFFORT')) === 'unsupported-effort')
    check('classifyFailure 额度耗尽', classifyFailure(failure('QUOTA', 429)) === 'quota')
    check('classifyFailure 余额耗尽', classifyFailure(failure('ACCOUNT_QUOTA_EXCEEDED', 402)) === 'quota')
    check('classifyFailure 凭据无效', classifyFailure(failure('INVALID_CREDENTIAL', 401)) === 'credential')
    check('classifyFailure 凭据缺失', classifyFailure(failure('MISSING_CREDENTIAL', 401)) === 'credential')
    // 传输层失败没有 HTTP status（宿主 normalizeLlmFailure 的兜底对象只给 message + code）
    check('classifyFailure 无 status 判端点不可达', classifyFailure(failure('ECONNREFUSED')) === 'unreachable')
    check('classifyFailure 有 status 归其它', classifyFailure(failure('MODEL_NOT_FOUND', 404)) === 'other')
    // 档位码优先：它由宿主在派发前本地抛出，本就没有 HTTP 响应
    check('classifyFailure 档位码不被 status 盖过', classifyFailure(failure('UNSUPPORTED_REASONING_EFFORT', 400)) === 'unsupported-effort')
    // 零内容完成：请求成功抵达却无内容块，同样没有 status——必须显式排除，否则会被当成断线而误短路整组
    check('classifyFailure 零内容完成归其它而非不可达', classifyFailure(failure('EMPTY_RESPONSE')) === 'other')

    // ---------- isProviderBlocking：只有三类 provider 级失败才短路 ----------
    check('isProviderBlocking 端点不可达', isProviderBlocking('unreachable') === true)
    check('isProviderBlocking 额度耗尽', isProviderBlocking('quota') === true)
    check('isProviderBlocking 凭据无效', isProviderBlocking('credential') === true)
    check('isProviderBlocking 档位不支持不短路', isProviderBlocking('unsupported-effort') === false)
    check('isProviderBlocking 其它失败不短路', isProviderBlocking('other') === false)
    check('isProviderBlocking 可用不短路', isProviderBlocking('usable') === false)

    // ---------- reportProvider：可用模型去重、档位不支持单列、可达与凭据取自全程 ----------
    const detail = (model: string, outcome: ProbeOutcome, effort?: string): VerifyProbeResult =>
        ({ provider: 'a', model, effort, outcome, failure: undefined })
    const report = (results: VerifyProbeResult[], blockedBy?: 'unreachable' | 'quota' | 'credential') =>
        reportProvider({ provider: 'a', results, blockedBy, planned: 3 })
    const allOk = report([detail('m1', 'usable', 'off'), detail('m1', 'usable', 'high'), detail('m2', 'usable', 'low')])
    check(
        'reportProvider 全可用：同模型多档只计一个可用模型',
        stable(allOk) === stable({
            provider: 'a', reachable: true, keyValid: true, skipped: false, blockedBy: undefined,
            models: 2, efforts: 3, unsupported: 0, planned: 3, probed: 3,
        }),
        allOk,
    )
    const oneUnsupported = report([detail('m1', 'usable', 'off'), detail('m1', 'unsupported-effort', 'high'), detail('m2', 'usable', 'low')])
    check(
        'reportProvider 档位不支持单列，不混入其它失败',
        stable(oneUnsupported) === stable({
            provider: 'a', reachable: true, keyValid: true, skipped: false, blockedBy: undefined,
            models: 2, efforts: 2, unsupported: 1, planned: 3, probed: 3,
        }),
        oneUnsupported,
    )
    const dead = report([detail('m1', 'unreachable')], 'unreachable')
    check(
        'reportProvider 端点不可达：短路且不臆断凭据有效',
        stable(dead) === stable({
            provider: 'a', reachable: false, keyValid: false, skipped: true, blockedBy: 'unreachable',
            models: 0, efforts: 0, unsupported: 0, planned: 3, probed: 1,
        }),
        dead,
    )
    // 可达但额度耗尽：端点通、key 无效——这正是「凭据有效且有额度」要拆成两态的原因
    const outOfQuota = report([detail('m1', 'usable', 'off'), detail('m1', 'quota', 'high')], 'quota')
    check(
        'reportProvider 额度耗尽：可达但凭据无效',
        stable(outOfQuota) === stable({
            provider: 'a', reachable: true, keyValid: false, skipped: true, blockedBy: 'quota',
            models: 1, efforts: 1, unsupported: 0, planned: 3, probed: 2,
        }),
        outOfQuota,
    )

    // ---------- summarizeProviders：逐字段求和 ----------
    const ok: VerifyProviderReport = {
        provider: 'a', reachable: true, keyValid: true, skipped: false, blockedBy: undefined,
        models: 2, efforts: 3, unsupported: 1, planned: 3, probed: 3,
    }
    const blocked: VerifyProviderReport = {
        provider: 'b', reachable: false, keyValid: false, skipped: true, blockedBy: 'unreachable',
        models: 0, efforts: 0, unsupported: 0, planned: 5, probed: 1,
    }
    const details: VerifyProbeResult[] = [detail('m1', 'usable', 'off')]
    check(
        'summarizeProviders 求和（短路组的计划数计入、实测数只计已发出的）',
        stable(summarizeProviders([ok, blocked], details)) === stable({
            providers: [ok, blocked], results: details, unsupportedEfforts: [], tested: 1, models: 2, efforts: 3, unsupported: 1, planned: 8, probed: 4,
        }),
        summarizeProviders([ok, blocked], details),
    )
    check(
        'summarizeProviders 空输入',
        stable(summarizeProviders([], [])) === stable({
            providers: [], results: [], unsupportedEfforts: [], tested: 0, models: 0, efforts: 0, unsupported: 0, planned: 0, probed: 0,
        }),
    )
    // 不支持档位明细由结果派生：剔除要写配置就得逐条定位，聚合与明细同源、不另立口径
    const unsupportedDetail = [
        { provider: 'a', model: 'm1', effort: 'high', outcome: 'unsupported-effort', failure: undefined },
    ] as VerifyProbeResult[]
    check(
        'summarizeProviders 不支持档位明细逐条给出',
        stable(summarizeProviders([], unsupportedDetail).unsupportedEfforts)
        === stable([{ provider: 'a', model: 'm1', effort: 'high' }]),
        summarizeProviders([], unsupportedDetail).unsupportedEfforts,
    )
    // tested 记「探过的模型」而非「可用的模型」：全档位失败的模型也要计入，否则开档位模式下总数小于用户勾选数
    const allFailed = [
        { provider: 'a', model: 'm1', effort: 'off', outcome: 'other', failure: undefined },
        { provider: 'a', model: 'm1', effort: 'high', outcome: 'other', failure: undefined },
    ] as VerifyProbeResult[]
    check(
        'summarizeProviders tested 计入全档位失败的模型，与可用模型数分开',
        summarizeProviders([], allFailed).tested === 1 && summarizeProviders([], allFailed).models === 0,
        summarizeProviders([], allFailed),
    )

    // ---------- verifyModels：带桩跑通整条链，逐组串行且短路 ----------
    /** 桩：按「模型@档位 -> 分片序列」应答，未登记的组合默认成功；记录调用顺序与提示词；`onCall` 供用例在中途触发中止 */
    const stub = (script: Record<string, readonly StreamChunk[]>, onCall?: (callIndex: number) => void) => {
        const calls: string[] = []
        const prompts: string[] = []
        const stream = (options: {
            provider: string
            model: string
            reasoningEffort?: string
            messages: readonly { role: string; content: readonly { type: 'text'; text: string }[] }[]
        }): AsyncIterable<StreamChunk> => {
            const tag = `${options.model}${options.reasoningEffort === undefined ? '' : `@${options.reasoningEffort}`}`
            calls.push(`${options.provider}/${tag}`)
            prompts.push(options.messages[0].content[0].text)
            onCall?.(calls.length)
            const chunks = script[tag] ?? [BLOCK_START as unknown as StreamChunk, FINISH_STOP as unknown as StreamChunk]
            return (async function* () { for (const chunk of chunks) yield chunk })()
        }
        return { llm: { stream } as unknown as Pick<LlmRuntime, 'stream'>, calls, prompts }
    }

    {
        const { llm, prompts } = stub({})
        const summary = await verifyModels(llm, { models: [entry('a', 'm1', ['off', 'high']), entry('a', 'm2', ['low'])] })
        check(
            'verifyModels 全可用：逐档位各发一次并逐组汇报',
            summary.models === 2 && summary.efforts === 3 && summary.probed === 3 && summary.planned === 3
            && summary.providers.length === 1 && summary.providers[0].reachable && summary.providers[0].keyValid,
            summary,
        )
        // 明细：逐条给出「提供方 / 模型 / 档位 / 结论」，顺序为「组序 → 组内探测序」
        check(
            'verifyModels 返回逐条明细',
            stable(summary.results) === stable([
                { provider: 'a', model: 'm1', effort: 'off', outcome: 'usable', failure: undefined },
                { provider: 'a', model: 'm1', effort: 'high', outcome: 'usable', failure: undefined },
                { provider: 'a', model: 'm2', effort: 'low', outcome: 'usable', failure: undefined },
            ]),
            summary.results,
        )
        // 提示词固定为一句 Just say OK——它是省额度的前提，不该被顺手改成更啰嗦的说法
        check('verifyModels 每次探测的提示词都是 Just say OK', prompts.length === 3 && prompts.every((text) => text === 'Just say OK'), prompts)
    }
    {
        // 额度耗尽：首个探测即命中，第二、三个档位不该再发（同一 url 同一 key，过不了就是过不了）
        const { llm, calls } = stub({ 'm1@off': [finishError('QUOTA', 429)] })
        const summary = await verifyModels(llm, { models: [entry('a', 'm1', ['off', 'high'])] })
        check(
            'verifyModels 额度耗尽短路整组',
            calls.length === 1 && summary.probed === 1 && summary.planned === 2
            && summary.providers[0].skipped && summary.providers[0].blockedBy === 'quota'
            && summary.providers[0].reachable && !summary.providers[0].keyValid,
            { calls, summary },
        )
        // 明细须带上失败的原始事实，调用方可据此做比本插件更细的分类与展示
        check(
            'verifyModels 明细带失败原始事实',
            stable(summary.results) === stable([{
                provider: 'a', model: 'm1', effort: 'off', outcome: 'quota',
                failure: { code: 'QUOTA', status: 429, message: '文案随便写，各厂商都不一样' },
            }]),
            summary.results,
        )
    }
    {
        // 端点不可达：可达与凭据都判否
        const { llm, calls } = stub({ 'm1': [finishError('ECONNREFUSED')] })
        const summary = await verifyModels(llm, { models: [entry('a', 'm1', []), entry('a', 'm2', [])] })
        check(
            'verifyModels 端点不可达短路并记为不可达',
            calls.length === 1 && summary.providers[0].blockedBy === 'unreachable'
            && !summary.providers[0].reachable && !summary.providers[0].keyValid,
            { calls, summary },
        )
    }
    {
        // 档位不被支持是逐模型逐档位的个体结论：只跳过这一条，不短路
        const { llm, calls } = stub({ 'm1@high': [finishError('UNSUPPORTED_REASONING_EFFORT', 400)] })
        const summary = await verifyModels(llm, { models: [entry('a', 'm1', ['off', 'high'])] })
        check(
            'verifyModels 档位不支持不短路、计入 unsupported',
            calls.length === 2 && summary.probed === 2 && summary.unsupported === 1
            && summary.efforts === 1 && !summary.providers[0].skipped,
            { calls, summary },
        )
    }
    {
        // 厂商侧拒绝（如该模型不存在）多与具体模型有关，同样不短路
        const { llm, calls } = stub({ 'm1': [finishError('MODEL_NOT_FOUND', 404)] })
        const summary = await verifyModels(llm, { models: [entry('a', 'm1', []), entry('a', 'm2', [])] })
        check(
            'verifyModels 其它厂商拒绝不短路',
            calls.length === 2 && summary.probed === 2 && summary.efforts === 1
            && summary.providers[0].reachable && summary.providers[0].keyValid && !summary.providers[0].skipped,
            { calls, summary },
        )
    }
    {
        // 零内容完成是「请求成功抵达、但一个内容块都没有」，既非 provider 级失败也不该短路：
        // 若漏判就会把一次成功响应误报成端点断线，后面的模型全部不再验证
        const { llm, calls } = stub({ 'm1': [finishError('EMPTY_RESPONSE')] })
        const summary = await verifyModels(llm, { models: [entry('a', 'm1', []), entry('a', 'm2', [])] })
        check(
            'verifyModels 零内容完成不短路',
            calls.length === 2 && summary.probed === 2 && summary.efforts === 1
            && summary.providers[0].reachable && !summary.providers[0].skipped,
            { calls, summary },
        )
    }
    {
        // 两个提供方互不牵连：一个不可达，另一个照常验证
        const { llm, calls } = stub({ 'm1': [finishError('ECONNREFUSED')] })
        const summary = await verifyModels(llm, { models: [entry('a', 'm1', []), entry('b', 'n1', [])] })
        check(
            'verifyModels 短路只影响本组',
            summary.providers.length === 2 && summary.providers[0].skipped === true
            && summary.providers[1].skipped === false && summary.providers[1].efforts === 1,
            { calls, summary },
        )
    }
    {
        let threw = false
        try {
            await verifyModels(stub({}).llm, { models: [entry('a', 'm', ['turbo'])] })
        } catch {
            threw = true
        }
        check('verifyModels 入参非法抛错（由 RPC 层转失败结果）', threw)
    }
    {
        // 正常帧序列：opened 起 → 每条 probed → 收于唯一一条 done
        const frames: VerifyProgressFrame[] = []
        const { llm } = stub({})
        const summary = await verifyModels(llm, { models: [entry('a', 'm1', ['off', 'high']), entry('a', 'm2', ['low'])] }, {
            onProgress: (frame) => { frames.push(frame) },
        })
        const last = frames[frames.length - 1]
        check(
            'verifyModels 进度帧：opened 起、逐条 probed、done 收尾',
            stable(frames.slice(0, 4)) === stable([
                { type: 'opened', total: 3 },
                { type: 'probed', provider: 'a', model: 'm1', effort: 'off', outcome: 'usable', done: 1, total: 3 },
                { type: 'probed', provider: 'a', model: 'm1', effort: 'high', outcome: 'usable', done: 2, total: 3 },
                { type: 'probed', provider: 'a', model: 'm2', effort: 'low', outcome: 'usable', done: 3, total: 3 },
            ]) && frames.length === 5 && last.type === 'done' && last.summary === summary,
            frames,
        )
    }
    {
        // 短路那条自带 skipped：消费方才好交代「这组还剩几条没验」
        const frames: VerifyProgressFrame[] = []
        const { llm, calls } = stub({ 'm1@off': [finishError('QUOTA', 429)] })
        await verifyModels(llm, { models: [entry('a', 'm1', ['off', 'high', 'max'])] }, {
            onProgress: (frame) => { frames.push(frame) },
        })
        check(
            'verifyModels 短路那条 probed 带 skipped',
            calls.length === 1 && stable(frames[1]) === stable({
                type: 'probed', provider: 'a', model: 'm1', effort: 'off', outcome: 'quota', skipped: 2, done: 1, total: 3,
            }),
            frames,
        )
    }
    {
        // 中止：桩不理会信号本身，这里要验的是「本组不再发新探测」与「不发 done」
        const controller = new AbortController()
        const frames: VerifyProgressFrame[] = []
        const { llm, calls } = stub({}, (index) => { if (index === 2) controller.abort() })
        const summary = await verifyModels(llm, { models: [entry('a', 'm1', ['off', 'high']), entry('a', 'm2', ['low'])] }, {
            signal: controller.signal,
            onProgress: (frame) => { frames.push(frame) },
        })
        check(
            'verifyModels 中止后早停且不发 done',
            calls.length === 2 && frames.every((frame) => frame.type !== 'done')
            && summary.probed === 2 && summary.planned === 3,
            { calls, frames, summary },
        )
    }
    {
        // 六个提供方、五个 worker：第 3 次调用时中止，此时前 3 组已开跑、后 3 组从未开始。
        // 它们不该出现在汇报里——报成「可达且凭据有效」或「全不可用」都是撒谎，它压根没被验证过。
        const controller = new AbortController()
        const { llm } = stub({}, (index) => { if (index === 3) controller.abort() })
        const summary = await verifyModels(
            llm,
            { models: ['a', 'b', 'c', 'd', 'e', 'f'].map((provider) => entry(provider, 'm', [])) },
            { signal: controller.signal },
        )
        check(
            'verifyModels 从未开跑的提供方不进汇报',
            stable(summary.providers.map((report) => report.provider)) === stable(['a', 'b', 'c'])
            && summary.planned === 3 && summary.probed === 3,
            summary.providers.map((report) => report.provider),
        )
    }

    // ---------- 进度帧编解码：线上格式与形状校验 ----------
    const opened = encodeProgressFrame({ type: 'opened', total: 3 })
    check('encodeProgressFrame 输出 data 行加空行分隔', opened === 'data: {"type":"opened","total":3}\n\n', opened)
    check('decodeProgressFrame 往返一致', stable(decodeProgressFrame(opened)) === stable({ type: 'opened', total: 3 }))
    // SSE 心跳是注释行；我们不用 EventSource（它会自动重连，等于重跑整轮），但仍按格式容忍
    check('decodeProgressFrame 忽略注释帧', decodeProgressFrame(': connected') === undefined)
    check('decodeProgressFrame 忽略非法 JSON', decodeProgressFrame('data: {oops') === undefined)
    check('decodeProgressFrame 忽略非帧对象', decodeProgressFrame('data: {"type":"nope"}') === undefined)
    // done 帧直接驱动卡片上的统计数字，计数缺失就该判非法，而不是把 undefined 当 0 展示
    check('decodeProgressFrame 拒计数缺失的 done', decodeProgressFrame('data: {"type":"done","summary":{}}') === undefined)
    check('decodeProgressFrame 拒字段缺失的 probed', decodeProgressFrame('data: {"type":"probed","provider":"a"}') === undefined)
    check(
        'decodeProgressFrame 接受无 effort 的 probed（模型未声明档位，键缺省是合法形态）',
        stable(decodeProgressFrame('data: {"type":"probed","provider":"a","model":"m","outcome":"usable","done":1,"total":1}'))
        === stable({ type: 'probed', provider: 'a', model: 'm', outcome: 'usable', done: 1, total: 1 }),
    )
}