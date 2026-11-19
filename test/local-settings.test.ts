
import {
    LOCAL_DEFAULTS,
    LOCAL_FLAG_IDS,
    LOCAL_SNAPSHOT_SOURCE,
    LOCAL_STORAGE_SUFFIX,
    createLocalSettings,
    decodeFlag,
    seedLocalSettings,
    storageKeyOf,
} from '@/client/local-settings'
import { createLocalRecord, readRaw, resolveStorage, writeRaw, STORE_PREFIX } from '@/client/local-store'
import type { StorageLike } from '@/client/local-store'
import type { Flags } from '@/client/model'
import { DEFAULT_CONFIG } from '@/shared/config-schema'
import { check, stable } from '@test/helper'

function memoryStorage(seed: Record<string, string> = {}, throwOn: { read?: boolean; write?: boolean } = {}): StorageLike & { data: Map<string, string> } {
    const data = new Map(Object.entries(seed))
    return {
        data,
        getItem(key) {
            if (throwOn.read) throw new Error('read denied')
            return data.get(key) ?? null
        },
        setItem(key, value) {
            if (throwOn.write) throw new Error('write denied')
            data.set(key, value)
        },
    }
}

const SNAPSHOT: Flags = {
    ...DEFAULT_CONFIG,
    behavior: {
        ...DEFAULT_CONFIG.behavior,
        showInComposer: false,
        classicSetting: false,
    },
    userExperience: { ...DEFAULT_CONFIG.userExperience, rememberEfforts: false },
}

export function run(): void {
    check('全部后缀唯一', new Set(Object.values(LOCAL_STORAGE_SUFFIX)).size === LOCAL_FLAG_IDS.length)
    check('键位形如 tikaflow-model-fix.<kebab>',
        LOCAL_FLAG_IDS.every((id) => {
            const key = storageKeyOf(id)
            return key.startsWith(STORE_PREFIX) && /^[a-z][a-z0-9-]*$/.test(key.slice(STORE_PREFIX.length))
        }),
        LOCAL_FLAG_IDS.map(storageKeyOf))
    check('默认值取自 DEFAULT_CONFIG + 两个新键 true',
        stable(LOCAL_DEFAULTS) === stable({
            ...DEFAULT_CONFIG.behavior,
            rememberEfforts: DEFAULT_CONFIG.userExperience.rememberEfforts,
            defaultHigh: DEFAULT_CONFIG.userExperience.defaultHigh,
            showTitleIndicator: true,
            rememberFloatingPosition: true,
        }),
        LOCAL_DEFAULTS)
    check('九个键有快照来源、两个新键没有',
        LOCAL_FLAG_IDS.filter((id) => LOCAL_SNAPSHOT_SOURCE[id] !== null).length === 9,
        LOCAL_FLAG_IDS.map((id) => [id, LOCAL_SNAPSHOT_SOURCE[id]]))

    check('decodeFlag 只认 "true" / "false"',
        decodeFlag('true') === true && decodeFlag('false') === false)
    for (const bad of [null, '', '1', '0', 'TRUE', 'False', 'yes', 'on', ' ', '{}', 'null']) {
        check(`decodeFlag 非规范值回落 null ${JSON.stringify(bad)}`, decodeFlag(bad) === null, bad)
    }

    {
        const storage = memoryStorage({ [storageKeyOf('showInModels')]: 'garbage' })
        const local = createLocalSettings(storage)
        const snap = local.getSnapshot()
        check('单键损坏落该键默认', snap.showInModels === LOCAL_DEFAULTS.showInModels, snap.showInModels)
        check('单键损坏不连累其余十个键', snap.classicSetting === true && snap.showTitleIndicator === true, snap)
    }

    {
        const local = createLocalSettings(memoryStorage({}, { read: true }))
        check('读取抛错一律落默认', stable(local.getSnapshot()) === stable(LOCAL_DEFAULTS), local.getSnapshot())
        let threw = false
        try {
            local.set('showInModels', false)
        } catch {
            threw = true
        }
        check('写入抛错不抛给调用方', !threw)
        check('写入抛错后内存值仍更新（本次会话内生效）', local.getSnapshot().showInModels === false)
    }
    {
        let threw = false
        try {
            writeRaw(null, 'x', '1')
        } catch {
            threw = true
        }
        check('存储句柄缺席时读写全是空操作', readRaw(null, 'x') === null && !threw)
    }

    {
        const local = createLocalSettings(memoryStorage())
        const first = local.getSnapshot()
        check('无变化时快照引用稳定', local.getSnapshot() === first)
        local.set('showInModels', false)
        check('写入后换引用', local.getSnapshot() !== first)
        check('写入单个键不动其余键', local.getSnapshot().showInComposer === true)
        const second = local.getSnapshot()
        local.set('showInModels', false)
        check('同值写入不换引用', local.getSnapshot() === second)
    }

    {
        const storage = memoryStorage()
        const local = createLocalSettings(storage)
        let notified = 0
        const off = local.subscribe(() => { notified++ })
        local.setAll(false)
        off()
        check('setAll 整组置关', LOCAL_FLAG_IDS.every((id) => local.getSnapshot()[id] === false))
        check('setAll 只通知一次', notified === 1, notified)
        check('setAll 逐键落盘', LOCAL_FLAG_IDS.every((id) => storage.data.get(storageKeyOf(id)) === 'false'))
        local.setAll(false)
        check('setAll 同值不通知', notified === 1, notified)
    }

    {
        const local = createLocalSettings(memoryStorage())
        let notified = 0
        const off = local.subscribe(() => { notified++ })
        local.set('showInFloat', false)
        check('订阅者收到一次通知', notified === 1, notified)
        off()
        local.set('showInFloat', true)
        check('退订后不再通知', notified === 1, notified)
    }

    {
        const storage = memoryStorage({ [storageKeyOf('showInModels')]: 'true' })
        const local = createLocalSettings(storage)
        local.seed(SNAPSHOT)
        check('播种按快照值写入', storage.data.get(storageKeyOf('showInComposer')) === 'false')
        check('播种取到快照的 classicSetting=false', local.getSnapshot().classicSetting === false)
        check('播种取到快照的 rememberEfforts=false', local.getSnapshot().rememberEfforts === false)
        const storage2 = memoryStorage({ [storageKeyOf('showInComposer')]: 'true' })
        const local2 = createLocalSettings(storage2)
        local2.seed(SNAPSHOT)
        check('已有值不被快照覆盖', storage2.data.get(storageKeyOf('showInComposer')) === 'true')
        check('已有值在快照里是 false 时也不覆盖', local2.getSnapshot().showInComposer === true)
    }
    {
        const storage = memoryStorage()
        const local = createLocalSettings(storage)
        local.seed(SNAPSHOT)
        check('两个新键播种时不落盘', storage.data.get(storageKeyOf('showTitleIndicator')) === undefined
            && storage.data.get(storageKeyOf('rememberFloatingPosition')) === undefined)
        check('两个新键取默认值', local.getSnapshot().showTitleIndicator === true
            && local.getSnapshot().rememberFloatingPosition === true)
    }
    {
        const storage = memoryStorage()
        const local = createLocalSettings(storage)
        local.seed(SNAPSHOT)
        const after = new Map(storage.data)
        local.seed({ ...SNAPSHOT, behavior: { ...SNAPSHOT.behavior, showInComposer: true } })
        check('重复播种幂等（第二次不覆盖）', stable([...storage.data]) === stable([...after]))
    }
    {
        const storage = memoryStorage({ [storageKeyOf('classicSetting')]: 'true' })
        const local = createLocalSettings(storage)
        local.set('classicSetting', true)
        local.seed(SNAPSHOT)
        check('用户先前的显式取值优先于快照', local.getSnapshot().classicSetting === true)
    }

    {
        // loading 期间 value 回落 DEFAULT_CONFIG，播了会把默认值冻进存储
        const storage = memoryStorage()
        const local = createLocalSettings(storage)
        let listener: (() => void) | null = null
        const scope = {
            getSnapshot: () => ({ status: 'loading' as const, value: undefined }),
            subscribe: (fn: () => void) => { listener = fn; return () => { listener = null } },
            set: () => Promise.resolve(),
            mutate: () => Promise.resolve(true),
            dispose: () => { },
        } as unknown as Parameters<typeof seedLocalSettings>[0]
        seedLocalSettings(scope, local)
        check('未 ready 时不播种', storage.data.size === 0, [...storage.data])
        check('未 ready 时已订阅等待', listener !== null)
    }
    {
        const storage = memoryStorage()
        const local = createLocalSettings(storage)
        let listener: (() => void) | null = null
        let unsubscribed = false
        const scope = {
            getSnapshot: () => ({ status: 'ready' as const, value: SNAPSHOT }),
            subscribe: (fn: () => void) => {
                listener = fn
                return () => { unsubscribed = true; listener = null }
            },
            set: () => Promise.resolve(),
            mutate: () => Promise.resolve(true),
            dispose: () => { },
        } as unknown as Parameters<typeof seedLocalSettings>[0]
        seedLocalSettings(scope, local)
        check('已 ready 时立即播种', storage.data.get(storageKeyOf('showInComposer')) === 'false')
        check('立即播种不订阅', listener === null && !unsubscribed)
    }
    {
        const storage = memoryStorage()
        const local = createLocalSettings(storage)
        // 用可变容器承接：TS 看不到 subscribe 回调内的赋值
        const state: { listener: (() => void) | null; unsubscribed: boolean; ready: boolean } =
            { listener: null, unsubscribed: false, ready: false }
        const scope = {
            getSnapshot: () => state.ready
                ? { status: 'ready' as const, value: SNAPSHOT }
                : { status: 'loading' as const, value: undefined },
            subscribe: (fn: () => void) => {
                state.listener = fn
                return () => { state.unsubscribed = true; state.listener = null }
            },
            set: () => Promise.resolve(),
            mutate: () => Promise.resolve(true),
            dispose: () => { },
        } as unknown as Parameters<typeof seedLocalSettings>[0]
        seedLocalSettings(scope, local)
        check('首个帧未 ready 不播种', storage.data.size === 0)
        state.ready = true
        state.listener?.()
        check('首个 ready 帧完成播种', storage.data.get(storageKeyOf('showInComposer')) === 'false')
        check('播种后立即退订', state.unsubscribed === true)
    }

    {
        const key = `${STORE_PREFIX}floating-position`
        const storage = memoryStorage({ [key]: '{"edge":"right","offset":120}' })
        const record = createLocalRecord<{ edge: string; offset: number }>(
            key,
            (raw) => {
                if (raw === null) return undefined
                try {
                    const parsed = JSON.parse(raw) as { edge: string; offset: number }
                    return typeof parsed.offset === 'number' ? parsed : undefined
                } catch {
                    return undefined
                }
            },
            (value) => JSON.stringify(value),
            storage,
        )
        check('构造即读一次', stable(record.get()) === stable({ edge: 'right', offset: 120 }))
        record.set({ edge: 'left', offset: 40 })
        check('set 落到同一键', storage.data.get(key) === '{"edge":"left","offset":40}')
        check('set 后 get 返回新值', stable(record.get()) === stable({ edge: 'left', offset: 40 }))
        const same = record.get()
        record.set({ edge: 'left', offset: 40 })
        check('同值 set 不换引用', record.get() === same)
        check('非法 JSON 回落 undefined', createLocalRecord<{ a: 1 }>(
            key, () => undefined, (v) => JSON.stringify(v), memoryStorage({ [key]: 'not json' }),
        ).get() === undefined)
    }

    {
        const saved = (globalThis as { localStorage?: unknown }).localStorage
        check('Node 环境无 localStorage → null', resolveStorage() === null, saved)
    }
}
