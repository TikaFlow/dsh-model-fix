/**
 * ConfigForm 的 decode 包装层。
 *
 * 宿主 0.1.7+ 浏览器半 settings 面是 ctx.configForms（ConfigForm：段级读取/写入面）。
 * 本层不是代际适配而是 decode 缓存语义：useSyncExternalStore 要求 getSnapshot 引用稳定，
 * ConfigForm 快照引用本身稳定，但 decode 结果每次新造会触发重渲染环，故订阅 form、
 * 快照变化时才重解并替换引用。user 层原样透传（「排除提供方」瓦片的命中判定直接读
 * user 层的 providers 键，与 Node 半 fix 遍历的同一事实源）。写路径透传 form、返回类型
 * 对齐 void（调用方均不消费宿主接受布尔，写失败由宿主镜像恢复读兜底）；订阅随 dispose
 * 释放，调用方经 ctx.effect 挂入自身 fiber 生命周期。
 *
 * 类型面：ConfigForm/ConfigFormSnapshot 直引 devDep 的
 * @deepseek-ai/dsh-client-ui-settings/client（type-only）；写路径 ops 经 devDep 的
 * @deepseek-ai/dsh-settings 的 SettingsPathOp 传参（与 Node 半 fix.ts 同源），转发时
 * 逐字段浅拷贝为宿主 mutate 的入参形态（value: unknown → JsonValue 的收敛见转发处断言）。
 */
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/** decode 后的段视图：快照 value 为解析结果，写方法返回 Promise<void>，另附订阅释放。 */
export interface DecodedScope<T> {
    getSnapshot(): ConfigFormSnapshot<T>
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<void>
    unset(field: string): Promise<void>
    mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>
    dispose(): void
}

export function makeScope<T>(form: ConfigForm<unknown>, decode: (raw: unknown) => T): DecodedScope<T> {
    let snap: ConfigFormSnapshot<T> = {
        status: 'loading',
        value: undefined,
        base: undefined,
        user: undefined,
        revision: undefined,
        writable: false,
        mode: 'host',
    }
    const listeners = new Set<() => void>()
    /** form 变化时重建快照引用（useSyncExternalStore 的稳定引用契约：变化前同一引用） */
    const sync = (): void => {
        const s = form.getSnapshot()
        snap = {
            status: s.status,
            value: decode(s.value),
            base: s.base,
            user: s.user,
            revision: s.revision,
            writable: s.writable,
            mode: s.mode,
        }
        for (const listener of [...listeners]) listener()
    }
    const off = form.subscribe(sync)
    sync()
    return {
        getSnapshot: () => snap,
        subscribe: (listener) => {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
        set: (field, value) => form.set(field, value).then(() => undefined),
        unset: (field) => form.unset(field).then(() => undefined),
        mutate: (ops, expectedRevision) => {
            const result = form.mutate(
                ops.map((op) => ({ op: op.op, path: [...op.path], ...(op.op === 'set' ? { value: op.value } : {}) })) as Parameters<ConfigForm<unknown>['mutate']>[0],
                expectedRevision,
            )
            return result.then(() => undefined)
        },
        dispose: () => {
            off()
            listeners.clear()
        },
    }
}
