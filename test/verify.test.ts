// src/verify.ts 纯函数测试：探测清单展开（笛卡尔积 / 无档位 / 入参校验）、按提供方分组（组内原序 + 下标）、结果汇总
import { groupProbesByProvider, planProbes, summarizeProbes } from '@/verify'
import type { VerifyProbe } from '@/verify'
import { check, stable } from '@test/helper'

/** 一个模型的载荷；参数收 unknown 以便构造非法入参用例（RPC 入参按不可信输入校验） */
const entry = (provider: unknown, model: unknown, efforts: unknown): Record<string, unknown> => ({ provider, model, efforts })

/** 执行本文件的全部用例 */
export function run(): void {
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

    // ---------- summarizeProbes：模型去重 / 档位计数 / 总数 ----------
    const probes: VerifyProbe[] = [
        { provider: 'a', model: 'm1', effort: 'off' },
        { provider: 'a', model: 'm1', effort: 'high' },
        { provider: 'b', model: 'n1', effort: 'low' },
    ]
    check('summarizeProbes 全成功', stable(summarizeProbes(probes, [true, true, true])) === stable({ models: 2, efforts: 3, total: 3 }))
    check('summarizeProbes 部分失败', stable(summarizeProbes(probes, [true, false, true])) === stable({ models: 2, efforts: 2, total: 3 }))
    check('summarizeProbes 全失败', stable(summarizeProbes(probes, [false, false, false])) === stable({ models: 0, efforts: 0, total: 3 }))
    // 同一模型的多个档位只计一个可用模型；同名模型在不同提供方下是两个模型
    const sameName: VerifyProbe[] = [
        { provider: 'a', model: 'shared', effort: 'off' },
        { provider: 'b', model: 'shared', effort: 'off' },
    ]
    check('summarizeProbes 同名跨提供方分别计数', stable(summarizeProbes(sameName, [true, true])) === stable({ models: 2, efforts: 2, total: 2 }))
}