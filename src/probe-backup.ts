/**
 * 「探测式填充」的崩溃兜底备份：探测开始前把 `llm-pi-ai` 的**整段 providers**（不是只备被探测的那几个模型）
 * 压成一个字符串存进自有段，收敛落盘后立刻删掉；插件启动末尾若还留着它，说明上一轮探测没能收尾
 * （进程被杀、崩溃、断电），按这份备份把配置回退一次。
 *
 * 为什么必须整段备份而不是只备探测范围：探测期间配置里的改动是**临时预声明**（`src/fill.ts` 把七档
 * 临时写进 `reasoningEfforts`），收敛才收回。崩在中间 ⇒ 用户配置里就留着「声称支持全部七档」的模型，
 * 而插件自己也不知道下一轮该收敛成什么样。只备被探测的部分则会在收敛时把范围外的模型一并按备份覆盖，
 * 反而可能抹掉用户在探测期间的正当编辑——整段备 + 交集回退（`planRestore`）才是最小伤害的处置。
 *
 * 为什么压成字符串：整段 providers 对大配置可达数百 KB，而备份只是「崩了才用」的一次性凭据，
 * 常驻在用户配置里不合适。`deflateRaw` + base64 后通常只剩零头，键落在**自有段的顶层**（与 `version-N` 同级），
 * 不进当前版本快照——`canonicalizeCurrentOp` 会把快照里的多余键剥掉。
 *
 * 收尾窗口的已知代价：收敛已落盘、备份尚未清除时进程被杀，下次启动会把这一轮**已成功**的补全回退掉
 * （多花一次探测即可重来）。反过来先清后备着，则崩在收敛之前会连预声明都无人回收，把用户的配置留在半截状态——
 * 后者更糟，故取前者。
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { MAX_ATTEMPTS } from '@/constants'
import { API_NS, PLUGIN_NAME, PLUGIN_NS } from '@/shared/constants'
import { isPlainObject, providersOf } from '@/shared/types'
import { planRestore } from '@/restore'
import { endIgnoreAll, startIgnoreAll } from '@/guard'
import { queueTask } from '@/host'
import { descriptorOf, ownSection } from '@/section'
import { isSettingsConflict } from '@/writeback'

/** 自有段里存这份备份的键（顶层，与 `version-N` 同级） */
const PROBE_BACKUP_KEY = 'probeBackup'

/** 整段 providers 压成一个字符串（JSON → deflateRaw → base64）；纯函数，可单测 */
export function encodeProbeBackup(providers: Record<string, unknown>): string {
    return Buffer.from(deflateRawSync(Buffer.from(JSON.stringify(providers), 'utf8'))).toString('base64')
}

/** 解码备份：非字符串、空串、解压失败、JSON 不成立或不是普通对象，一律 undefined（读取侧永不抛） */
export function decodeProbeBackup(text: unknown): Record<string, unknown> | undefined {
    if (typeof text !== 'string' || text.length === 0) return undefined
    try {
        const parsed: unknown = JSON.parse(inflateRawSync(Buffer.from(text, 'base64')).toString('utf8'))
        return isPlainObject(parsed) ? parsed : undefined
    } catch {
        return undefined
    }
}

/** 写自有段（冲突重试，读回最新 revision 后重发同一组 op——备份与清除都是幂等的） */
async function mutateOwn(ctx: Context, ops: readonly SettingsPathOp[]): Promise<void> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const descriptor = descriptorOf(ctx, PLUGIN_NS)
        if (!descriptor) throw new Error(`${PLUGIN_NAME}: 自有配置段 ${PLUGIN_NS} 不可读`)
        try {
            await queueTask(() => ctx.settings.mutate(PLUGIN_NS, [...ops], descriptor.revision))
            return
        } catch (error) {
            if (isSettingsConflict(error) && attempt < MAX_ATTEMPTS) continue
            throw error
        }
    }
    throw new Error(`${PLUGIN_NAME}: 写入探测备份冲突重试耗尽`)
}

/**
 * 探测开始前落备份。**失败即中止整轮**：没有退路就不动用户配置（预声明一旦写下就可能来不及收回）。
 * 调用方（`probeAndFill`）已持有事件流守卫，本函数不碰守卫。
 */
export async function saveProbeBackup(ctx: Context): Promise<void> {
    const providers = providersOf(descriptorOf(ctx, API_NS)?.user)
    if (!providers) throw new Error(`${PLUGIN_NAME}: 当前 ${API_NS} 无 providers 段，无法生成探测前的兜底备份`)
    const text = encodeProbeBackup(providers)
    await mutateOwn(ctx, [{ op: 'set', path: [PROBE_BACKUP_KEY], value: text }])
    ctx.logger.info(`${PLUGIN_NAME}: 已存下探测前的配置兜底备份（${Object.keys(providers).length} 个提供方，${text.length} 字符）`)
}

/** 收敛落盘后清备份；调用方持有守卫。清理失败不在此抛，由调用方决定降级 */
export function clearProbeBackup(ctx: Context): Promise<void> {
    return mutateOwn(ctx, [{ op: 'unset', path: [PROBE_BACKUP_KEY] }])
}

/**
 * 按备份回退模型（交集语义，与「恢复备份」同一口径：只回退共有 provider 里的共有 model，不复活被删项、不覆盖新增）。
 *
 * 刻意**不走** `src/writeback.ts` 的写回外壳：本回退不打任何逐次日志（成败由启动链末尾统一汇报一条），
 * 套壳会凭空多出「零变更」与「失败第 n 次」两条告警。
 */
async function restoreProviders(ctx: Context, backup: Record<string, unknown>): Promise<number> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const descriptor = descriptorOf(ctx, API_NS)
        const providers = providersOf(descriptor?.user)
        // 与 restoreModels 同理：读不到段时显式失败，返回 0 会被当成「本就一致」而静默吞掉真故障
        if (!providers) throw new Error(`${PLUGIN_NAME}: 当前 ${API_NS} 无 providers 段，无法回退`)
        const { modelOps, changed } = planRestore(backup, providers)
        if (modelOps.length === 0) return 0
        try {
            await queueTask(() => ctx.settings.mutate(API_NS, modelOps, descriptor?.revision || 0))
            return changed
        } catch (error) {
            if (isSettingsConflict(error) && attempt < MAX_ATTEMPTS) continue
            throw error
        }
    }
    throw new Error(`${PLUGIN_NAME}: 回退探测备份冲突重试耗尽`)
}

/**
 * 启动末尾的崩溃回退：段里没有备份即无事可做（本轮没探测过，或上一轮正常收尾）；
 * 有则按交集语义回退并清掉备份，返回被回退的模型数（0 = 无可回退或本就一致）。
 * 回退期间持事件流守卫——写回触发的段变更事件必须被入口拦下，否则 `fix` 会在回退途中把预声明又填回来。
 * **恢复成功才清备份**：清除失败只是下次启动再回退一次（幂等、零 op），反过来先清则备份永久丢失。
 */
export async function restoreProbeBackup(ctx: Context): Promise<number> {
    const section = ownSection(ctx)
    const raw = section?.[PROBE_BACKUP_KEY]
    if (raw === undefined) return 0
    const backup = decodeProbeBackup(raw)
    if (!backup) {
        ctx.logger.warn(`${PLUGIN_NAME}: 遗留的探测兜底备份无法解码，已丢弃（不回退任何模型）`)
        await clearProbeBackup(ctx)
        return 0
    }
    startIgnoreAll()
    try {
        const changed = await restoreProviders(ctx, backup)
        await clearProbeBackup(ctx)
        if (changed > 0) ctx.logger.warn(`${PLUGIN_NAME}: 检测到上次探测式填充未收尾，已按备份回退 ${changed} 个模型`)
        return changed
    } finally {
        endIgnoreAll()
    }
}