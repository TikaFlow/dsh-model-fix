import { PLUGIN_NS } from '@/shared/constants'

export const STORE_PREFIX = `${PLUGIN_NS}.`

/** 存储句柄的最小面，可注入内存桩单测 */
export interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
}

export function resolveStorage(): StorageLike | null {
    try {
        return (globalThis as { localStorage?: StorageLike | null }).localStorage ?? null
    } catch {
        return null
    }
}

export function readRaw(storage: StorageLike | null, key: string): string | null {
    if (storage === null) return null
    try {
        return storage.getItem(key)
    } catch {
        return null
    }
}

export function writeRaw(storage: StorageLike | null, key: string, value: string): void {
    if (storage === null) return
    try {
        storage.setItem(key, value)
    } catch {
        return
    }
}

/** `clear()` 的 `event.key` 为 null，此时以空后缀通知一次 */
export function watchStorage(onChange: (suffix: string) => void): () => void {
    if (typeof window === 'undefined') return () => { }
    const listener = (event: StorageEvent): void => {
        const key = event.key
        if (key === null) {
            onChange('')
            return
        }
        if (!key.startsWith(STORE_PREFIX)) return
        onChange(key.slice(STORE_PREFIX.length))
    }
    window.addEventListener('storage', listener)
    return () => { window.removeEventListener('storage', listener) }
}

/** `undefined` 表示没有记录 */
export interface LocalRecord<T> {
    get(): T | undefined
    set(value: T): void
    subscribe(listener: () => void): () => void
}

export function createLocalRecord<T>(
    fullKey: string,
    parse: (raw: string | null) => T | undefined,
    serialize: (value: T) => string,
    storage: StorageLike | null = resolveStorage(),
): LocalRecord<T> {
    let raw = readRaw(storage, fullKey)
    let current = parse(raw)
    const listeners = new Set<() => void>()
    let offWatch: (() => void) | null = null

    const sync = (): void => {
        const nextRaw = readRaw(storage, fullKey)
        if (nextRaw === raw) return
        raw = nextRaw
        current = parse(nextRaw)
        for (const listener of [...listeners]) listener()
    }

    return {
        get: () => current,
        set: (value) => {
            const nextRaw = serialize(value)
            if (nextRaw === raw) return
            writeRaw(storage, fullKey, nextRaw)
            raw = nextRaw
            current = value
            for (const listener of [...listeners]) listener()
        },
        subscribe: (listener) => {
            listeners.add(listener)
            offWatch ??= watchStorage((suffix) => {
                if (suffix === '' || `${STORE_PREFIX}${suffix}` === fullKey) sync()
            })
            return () => {
                listeners.delete(listener)
                if (listeners.size === 0 && offWatch !== null) {
                    offWatch()
                    offWatch = null
                }
            }
        },
    }
}
