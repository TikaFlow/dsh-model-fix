/** 本机设置：11 项只存 localStorage，不进 settings 快照。取舍见 docs/decisions-ui.md「本机设置」。 */

import { DEFAULT_CONFIG } from '@/shared/config-schema'
import { createLocalRecord, type LocalRecord, type StorageLike, resolveStorage, readRaw, writeRaw, watchStorage, STORE_PREFIX } from '@/client/local-store'
import type { DecodedScope } from '@/client/scope'
import type { Flags } from '@/client/model'

/** 顺序即瓦片内的渲染顺序 */
export const LOCAL_FLAG_IDS = [
    'showInModels',
    'showInBuiltinPlugins',
    'showInComposer',
    'showFollowStatus',
    'showInFloat',
    'backToChat',
    'classicSetting',
    'rememberEfforts',
    'defaultHigh',
    'showTitleIndicator',
    'rememberFloatingPosition',
] as const

export type LocalFlagId = (typeof LOCAL_FLAG_IDS)[number]

export const LOCAL_STORAGE_SUFFIX: Readonly<Record<LocalFlagId, string>> = {
    showInModels: 'show-in-models',
    showInBuiltinPlugins: 'show-in-builtin-plugins',
    showInComposer: 'show-in-composer',
    showFollowStatus: 'show-follow-status',
    showInFloat: 'show-in-float',
    backToChat: 'back-to-chat',
    classicSetting: 'classic-setting',
    rememberEfforts: 'remember-efforts',
    defaultHigh: 'default-high',
    showTitleIndicator: 'show-title-indicator',
    rememberFloatingPosition: 'remember-floating-position',
}

export type LocalFlags = { readonly [K in LocalFlagId]: boolean }

/** 播种来源 `[组, 键]`；`null` 表示快照无对应字段 */
export const LOCAL_SNAPSHOT_SOURCE: Readonly<Record<LocalFlagId, readonly [group: 'behavior' | 'userExperience', key: string] | null>> = {
    showInModels: ['behavior', 'showInModels'],
    showInBuiltinPlugins: ['behavior', 'showInBuiltinPlugins'],
    showInComposer: ['behavior', 'showInComposer'],
    showFollowStatus: ['behavior', 'showFollowStatus'],
    showInFloat: ['behavior', 'showInFloat'],
    backToChat: ['behavior', 'backToChat'],
    classicSetting: ['behavior', 'classicSetting'],
    rememberEfforts: ['userExperience', 'rememberEfforts'],
    defaultHigh: ['userExperience', 'defaultHigh'],
    showTitleIndicator: null,
    rememberFloatingPosition: null,
}

export const LOCAL_DEFAULTS: Readonly<LocalFlags> = {
    ...DEFAULT_CONFIG.behavior,
    rememberEfforts: DEFAULT_CONFIG.userExperience.rememberEfforts,
    defaultHigh: DEFAULT_CONFIG.userExperience.defaultHigh,
    showTitleIndicator: true,
    rememberFloatingPosition: true,
}

export function storageKeyOf(id: LocalFlagId): string {
    return `${STORE_PREFIX}${LOCAL_STORAGE_SUFFIX[id]}`
}

/** 只认 `"true"` / `"false"`，其余返回 null 由调用方落默认 */
export function decodeFlag(raw: string | null): boolean | null {
    if (raw === 'true') return true
    if (raw === 'false') return false
    return null
}

/** 快照引用只在值变化时更换（uSES 硬要求） */
export interface LocalSettings {
    getSnapshot(): LocalFlags
    subscribe(listener: () => void): () => void
    set(id: LocalFlagId, value: boolean): void
    setAll(value: boolean): void
    /** 逐键「缺席才写」，不覆盖已有值 */
    seed(source: Pick<Flags, 'behavior' | 'userExperience'>): void
}

function readAll(storage: StorageLike | null): LocalFlags {
    const flags = {} as Record<LocalFlagId, boolean>
    for (const id of LOCAL_FLAG_IDS) {
        flags[id] = decodeFlag(readRaw(storage, storageKeyOf(id))) ?? LOCAL_DEFAULTS[id]
    }
    return flags
}

export function createLocalSettings(storage: StorageLike | null = resolveStorage()): LocalSettings {
    let snapshot = readAll(storage)
    const listeners = new Set<() => void>()
    let offWatch: (() => void) | null = null
    const notify = (): void => {
        for (const listener of [...listeners]) listener()
    }
    const reload = (): void => {
        const next = readAll(storage)
        if (LOCAL_FLAG_IDS.every((id) => next[id] === snapshot[id])) return
        snapshot = next
        notify()
    }
    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener)
            offWatch ??= watchStorage(() => { reload() })
            return () => {
                listeners.delete(listener)
                if (listeners.size === 0 && offWatch !== null) {
                    offWatch()
                    offWatch = null
                }
            }
        },
        set: (id, value) => {
            if (snapshot[id] === value) return
            writeRaw(storage, storageKeyOf(id), value ? 'true' : 'false')
            snapshot = { ...snapshot, [id]: value }
            notify()
        },
        setAll: (value) => {
            const next = {} as Record<LocalFlagId, boolean>
            for (const id of LOCAL_FLAG_IDS) {
                next[id] = value
                writeRaw(storage, storageKeyOf(id), value ? 'true' : 'false')
            }
            if (LOCAL_FLAG_IDS.every((id) => snapshot[id] === value)) return
            snapshot = next
            notify()
        },
        seed: (source) => {
            let changed = false
            for (const id of LOCAL_FLAG_IDS) {
                const from = LOCAL_SNAPSHOT_SOURCE[id]
                if (from === null) continue
                if (readRaw(storage, storageKeyOf(id)) !== null) continue
                const [group, key] = from
                const rows = source[group] as unknown as Record<string, unknown>
                writeRaw(storage, storageKeyOf(id), rows[key] === false ? 'false' : 'true')
                changed = true
            }
            if (changed) reload()
        },
    }
}

/** 已 ready 立即播，否则等首个 ready 帧播完退订。
 * 不能在 `loading` 时播：那时 `value` 回落 `DEFAULT_CONFIG`，会把默认值冻进存储。 */
export function seedLocalSettings(scope: DecodedScope<Flags>, local: LocalSettings): void {
    const trySeed = (): boolean => {
        const snap = scope.getSnapshot()
        if (snap.status !== 'ready' || snap.value === undefined) return false
        local.seed(snap.value)
        return true
    }
    if (trySeed()) return
    // 可变槽承接退订函数：subscribe 若同步回调，直接引用 const 会落进 TDZ
    const slot: { off: (() => void) | null } = { off: null }
    slot.off = scope.subscribe(() => {
        if (!trySeed()) return
        slot.off?.()
        slot.off = null
    })
    // 订阅期间可能已同步播种，收尾避免空转订阅
    if (slot.off !== null && trySeed()) {
        slot.off()
        slot.off = null
    }
}

export function createFloatingPositionRecord<T>(
    parse: (raw: string | null) => T | undefined,
    serialize: (value: T) => string,
): LocalRecord<T> {
    return createLocalRecord(`${STORE_PREFIX}floating-position`, parse, serialize)
}
