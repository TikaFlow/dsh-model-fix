/**
 * 0.1.7+ 宿主：ConfigForm → SettingsScope 适配器。
 *
 * 0.1.7 浏览器半 settings 面是 ctx.configForms（宿主 settings 服务的段级读取/写入面）；
 * 本包锁定 0.1.6 的 settingsScope，故 0.1.7 的形态经本适配器对齐——ConfigForm 与
 * SettingsScope 成员同构（getSnapshot/subscribe/set/unset/mutate，快照字段相同），
 * 差异有二：
 * - get() 不带本插件的 decode，快照 value 为段原始值（宿主 schema 解析后、经 projectForm
 *   原样——Config = z.any() 宽松字典不被投影）；
 * - mutate 等写方法返回 Promise<boolean>（宿主是否接受写入），SettingsScope 契约为 Promise<void>。
 *
 * 本地维护一份 SettingsScope 形态的稳定快照（useSyncExternalStore 要求 getSnapshot 引用稳定；
 * decode 结果每次新造会触发重渲染环，故 form 变化时才重解并替换引用）：订阅 form（其快照引用
 * 在变化前稳定，与宿主 SettingsScopeController 同契约），user 层原样透传（「排除提供方」瓦片的
 * 命中判定直接读 user 层的 providers 键，与 Node 半 fix 遍历的同一事实源）。写路径透传 form，
 * 返回类型对齐 void；订阅随 dispose 释放，调用方经 ctx.effect 挂入自身 fiber 生命周期。
 *
 * 类型面：SettingsScope/SettingsScopeSnapshot 直引 devDep 的
 * @deepseek-ai/dsh-client-ui-settings/client（type-only）；写路径 ops 经 devDep 的
 * @deepseek-ai/dsh-settings 的 SettingsPathOp 传参（与 Node 半 fix.ts 同源）；
 * ConfigForm 结构面本地复制（devDep 版本未导出，见 ConfigFormLike JSDoc）。
 */
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * ConfigForm 的结构面（对照 0.1.7 宿主 dsh-client-ui-settings 的 config-form-types.ts 复制）：
 * 快照字段与 SettingsScopeSnapshot 逐字一致；写方法返回 Promise<boolean>（宿主是否接受写入，
 * 本适配器不透传该结果、对齐 SettingsScope 的 Promise<void> 契约，与 0.1.6 settingsScope.bind
 * 的写语义一致——写失败由宿主镜像恢复读兜底）。
 * 本地声明而非 type-only 导入：devDep 锁 0.1.6 版本，该版 dsh-client-ui-settings/client
 * 未导出 ConfigForm，导入即 typecheck 失败。
 */
export interface ConfigFormLike {
    getSnapshot(): SettingsScopeSnapshot<unknown>
    subscribe(listener: () => void): () => void
    set(field: string, value: unknown): Promise<unknown>
    unset(field: string): Promise<unknown>
    mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<unknown>
}

export function makeScope<T>(form: ConfigFormLike, decode: (raw: unknown) => T): SettingsScope<T> & { dispose: () => void } {
    let snap: SettingsScopeSnapshot<T> = {
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
            const result = form.mutate(ops.map((op) => ({ op: op.op, path: [...op.path], ...(op.op === 'set' ? { value: op.value } : {}) })), expectedRevision)
            return result.then(() => undefined)
        },
        dispose: () => {
            off()
            listeners.clear()
        },
    }
}
