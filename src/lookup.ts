import { HINTS } from './constants'
import type { CacheEntry, IndexedCatalog } from './types'

/** 归一化模型 id：小写并去 -latest / -openai-compact 后缀噪音 */
function normalizeId(id: string): string {
    return id.toLowerCase().replace(/-openai-compact$/, '').replace(/-latest$/, '')
}

/** 提取模型 id 的语义主体（去提供方前缀与版本日期） */
function stem(id: string): string {
    return normalizeId(id)
        .replace(/-\d{8}$/, '')
        .split('-')
        .filter((part) => !/^\d{4,}$/.test(part))
        .join('-')
}

/** 匹配本地模型 id 与目录 id：精确、词干、前缀三级 */
function matchId(localId: string, ids: readonly string[]): string | undefined {
    const normalized = normalizeId(localId)
    if (ids.includes(normalized)) return normalized
    if (!normalized.includes('-') && !normalized.includes('.')) return
    const localStem = stem(normalized)
    const stemHits = ids.filter((id) => stem(id) === localStem)
    if (stemHits.length === 1) return stemHits[0]
    const prefix = ids.filter((id) => id.startsWith(`${normalized}-`) || id.startsWith(`${normalized}.`))
    if (prefix.length === 1) return prefix[0]
}

/** 按模型名前缀提示官方提供方 */
function hintedProvider(id: string): string | undefined {
    const bare = id.slice(id.lastIndexOf('/') + 1).toLowerCase()
    return HINTS.find(([prefix]) => bare === prefix || bare.startsWith(`${prefix}-`) || bare.startsWith(`${prefix}.`))?.[1]
}

/** 在目录中查找模型条目：优先按 provider+modelId，失败再仅按 modelId 全局匹配 */
export function lookup(indexed: IndexedCatalog, providerId: string, modelId: string): CacheEntry | undefined {
    const { groups } = indexed
    const bare = modelId.slice(modelId.lastIndexOf('/') + 1)
    const matchIn = (provider: string): CacheEntry | undefined => {
        const group = groups.get(provider)
        if (!group) return
        const hit = matchId(bare, group.ids)
        if (hit === undefined) return
        return group.entries.find((entry) => entry.id === hit)
    }
    // 配置 provider 精确命中目录时，仅在该 provider 内匹配
    if (providerId && groups.has(providerId)) {
        const same = matchIn(providerId)
        if (same) return same
    }
    // 否则按 modelId 全局匹配：先提示提供方，再全部提供方
    const hinted = hintedProvider(bare)
    if (hinted) {
        const official = matchIn(hinted)
        if (official) return official
    }
    for (const provider of groups.keys()) {
        if (provider === providerId || provider === hinted) continue
        const hit = matchIn(provider)
        if (hit) return hit
    }
}

/** 转换为 reasoningEfforts 映射：key 为可选等级，value 为实际发送拼写（仅 off 允许空值） */
export function toReasoningEfforts(entry: CacheEntry | undefined): Record<string, string | null> | undefined {
    if (!entry) return
    const mapped: Record<string, string | null> = {}
    for (const effort of entry.efforts) {
        const level = effort === 'none' ? 'off' : effort
        mapped[level] = level === 'off' ? null : level
    }
    const keys = Object.keys(mapped)
    if (keys.length === 0) return
    // 仅剩 off 表示无可选档位，等同无匹配，不填充
    if (keys.length === 1 && keys[0] === 'off') return
    return mapped
}
