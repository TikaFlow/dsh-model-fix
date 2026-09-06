/**
 * 模型参数填充卡片（浏览器半）：可折叠卡片，官方 Web-UI 插件卡片同形态——
 * header 整块为 `aria-expanded` 按钮（名称 + 描述两行，dirty 时挂「未保存」胶囊），
 * 展开体为 4 行表格（表头为纵向总控，不落存储）+ footer（强制更新 左｜放弃修改 · 应用 右）。
 * 本地暂存（draft）：单格/总控点击只改草稿，点「应用」才经 settingsScope 原子写 version-2；
 * 草稿跨折叠存活（收起时靠 header 胶囊告知未落盘），「放弃修改」即草稿归 null 回随已存值；
 * 应用被宿主确认落地（dirty 归 false）后自动收起，写失败保持展开与草稿可重试。
 * 「强制更新」（危险按钮，贴最左）弹宿主 Modal 二次确认后，经 Connection RPC 请求
 * Node 半单次 force 填充，结果（变更数/失败原因）以宿主 Toast 原语一次性反馈；
 * Modal/Toast 渲染在卡片根层、条件展开体之外，故收起不会打断在途弹层。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, IconChevronDownOutline14, IconWarningOutline16, Modal, Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RpcResult } from '../types'
import {
    DEFAULT_FLAGS,
    FIELD_KEYS,
    VERSION_KEY,
    applyColumn,
    isDirty,
    masterValue,
    snapshotFromFlags,
    toggleCell,
} from './model'
import type { Column, Flags } from './model'
import { COLUMN_KEYS, ROW_KEYS } from './locales'

/** 卡片组件 props（t 由 slots.register 的 locale 席位合成注入；scope/forceUpdate 由入口闭包传入） */
export interface CardProps {
    t: TranslateNS<'settings.modelReasoning'>
    scope: SettingsScope<Flags>
    /** 强制更新 RPC：channel 与端点在入口拼好，卡片只消费结果 */
    forceUpdate: () => Promise<RpcResult<unknown>>
}

const STYLE_ID = 'dsh-model-reasoning-card-css'

/**
 * 内嵌样式表（类名 dsh-mr- 前缀防撞；颜色全部走 --dsw-alias-* 令牌带字面兜底，深浅色由宿主令牌自动切换）。
 * 卡片外壳按宿主「模型」页发布版同规格（`dsh-client-ui-settings-models` 的 .rowCard）：
 * 无背景 + 1px --dsw-alias-border-l2 + 12px 圆角，使卡片与同页 provider 行融为一体；
 * bg-module-platform 在宿主语义里是编辑器内填色块，本卡仅用于「未保存」胶囊。
 * 兜底字面量取宿主浅色主题令牌真值（design-platform.css：label-primary=bluish-1000、
 * label-secondary=bluish-700、label-tertiary=bluish-600、label-dimmed=bluish-200、
 * bg-module-platform=bluish-60；brand-primary 浅色下即近黑，非蓝色）。
 */
const STYLE_TEXT = [
    // 外壳：透明底 + 细边框，hover 与展开态同为 label-dimmed（header 是整块按钮，需要可点提示）
    '.dsh-mr-card{max-width:720px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:12px;background:none;transition:border-color .16s}',
    '.dsh-mr-card:hover,.dsh-mr-cardOpen{border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    // header：名称叠描述，右侧未保存胶囊与旋转 chevron
    '.dsh-mr-header{display:flex;align-items:center;gap:12px;box-sizing:border-box;width:100%;padding:14px;border:1px solid transparent;border-radius:12px;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}',
    '.dsh-mr-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-2px}',
    // 配置服务不可用时的静态头（div 渲染，无展开语义）
    '.dsh-mr-headerStatic{cursor:default}',
    '.dsh-mr-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
    '.dsh-mr-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mr-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mr-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#81858c);transition:transform .16s}',
    '.dsh-mr-chevronOpen{transform:rotate(180deg)}',
    '.dsh-mr-pending{flex:none;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b)}',
    // 展开体：左右内缩与 rowCard 左缘对齐，顶部分隔线即与 header 的界线
    '.dsh-mr-body{margin:0 14px;padding-bottom:8px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));display:flex;flex-direction:column;gap:12px}',
    '.dsh-mr-statusHint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mr-grid{display:flex;flex-direction:column}',
    // 分隔线只在相邻行间画（表头行不画顶边，避免与展开体顶线叠成粗线）
    '.dsh-mr-row{display:grid;grid-template-columns:minmax(0,1fr) 140px 140px;align-items:center;gap:8px;padding:8px 0}',
    '.dsh-mr-row+.dsh-mr-row{border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}',
    '.dsh-mr-head{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mr-label{font-size:13px;color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mr-colCell{display:flex;align-items:center;gap:8px}',
    '.dsh-mr-tipText{cursor:help}',
    '.dsh-mr-cellWrap{display:flex;align-items:center}',
    '.dsh-mr-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:none;border-radius:10px;cursor:pointer;background:var(--dsw-alias-border-l3,rgba(0,0,0,.12));transition:background .12s ease}',
    '.dsh-mr-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#0f1115)}',
    '.dsh-mr-switch:disabled{opacity:.5;cursor:default}',
    '.dsh-mr-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:2px}',
    '.dsh-mr-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground,#fff);transition:transform .12s ease}',
    '.dsh-mr-switch[aria-checked="true"] .dsh-mr-thumb{transform:translateX(16px)}',
    '.dsh-mr-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}',
    '.dsh-mr-actions{display:flex;align-items:center;gap:8px}',
    '.dsh-mr-apply{font-size:13px;padding:6px 16px;border:none;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-button-primary-fill,#0f1115)}',
    '.dsh-mr-apply:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#333)}',
    // 放弃修改：官方插件卡 .discard 同款幽灵按钮，尺寸向本卡按钮对齐
    '.dsh-mr-discard{font-size:13px;padding:6px 14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:8px;background:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mr-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary,#0f1115);border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mr-apply:disabled,.dsh-mr-discard:disabled{opacity:.45;cursor:default}',
    // 三个自绘按钮统一焦点环（与官方 .save/.discard 一致）
    '.dsh-mr-apply:focus-visible,.dsh-mr-discard:focus-visible,.dsh-mr-force:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:1px}',
    // 危险操作按钮：红底白字（state-error-primary 令牌随宿主深浅色自适应），与常规按钮同款尺寸
    '.dsh-mr-force{font-size:13px;padding:6px 16px;border:none;border-radius:8px;cursor:pointer;color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-state-error-primary,#d92d24)}',
    '.dsh-mr-force:hover:not(:disabled){filter:brightness(.9)}',
    '.dsh-mr-force:disabled{opacity:.45;cursor:default}',
].join('\n')

/** 幂等注入样式（模块级守护，重复挂载不重复插入） */
let stylesInjected = false
function ensureStyles(): void {
    if (stylesInjected || typeof document === 'undefined') return
    if (document.getElementById(STYLE_ID) !== null) {
        stylesInjected = true
        return
    }
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-model-reasoning'
    tag.textContent = STYLE_TEXT
    document.head.appendChild(tag)
    stylesInjected = true
}

/** 失败信息截断（Toast 文案为单行小字，防长消息撑爆布局） */
function truncateMessage(value: string): string {
    return value.length > 120 ? `${value.slice(0, 119)}…` : value
}

/** 自绘开关（宿主无现成 Switch，结构与宿主内置设置卡片的手绘开关一致） */
function Switch(props: { checked: boolean; disabled: boolean; aria: string; onChange: () => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={props.checked}
            aria-label={props.aria}
            disabled={props.disabled}
            className="dsh-mr-switch"
            onClick={props.onChange}
        >
            <span className="dsh-mr-thumb" />
        </button>
    )
}

/** 卡片主体 */
export function Card(props: CardProps) {
    ensureStyles()
    const scope = props.scope
    const { t } = props
    // scope 的方法是类实例方法，须经箭头函数保 this 绑定后交给 uSES
    const snap = useSyncExternalStore(
        (listener) => scope.subscribe(listener),
        () => scope.getSnapshot(),
    )
    // draft === null 表示未编辑、跟随已存值；首次点击即冻结当前显示值为草稿
    const [draft, setDraft] = useState<Flags | null>(null)
    const [submitting, setSubmitting] = useState(false)
    // 折叠态为卡片本地状态（读姿而非配置），默认收起，与官方插件卡一致；草稿跨折叠存活
    const [open, setOpen] = useState(false)
    // 强制更新执行态；confirmOpen 控宿主 Modal 二次确认；toast 为一次性结果反馈
    // （宿主 Toast 原语：seq 自增强刷新重放，failed 挂警示图标，约 4s 自动淡出）
    const rootRef = useRef<HTMLDivElement | null>(null)
    const saveStarted = useRef(false)
    const toastSeq = useRef(0)
    const [forceBusy, setForceBusy] = useState(false)
    const [toast, setToast] = useState<{ seq: number; text: string; failed: boolean } | null>(null)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const showNotice = (text: string, failed = false) => {
        toastSeq.current += 1
        setToast({ seq: toastSeq.current, text, failed })
    }

    const saved = snap.value
    const shown = draft ?? saved ?? DEFAULT_FLAGS
    const ready = snap.status === 'ready' && saved !== undefined
    const canWrite = ready && snap.writable === true
    const dirty = draft !== null && saved !== undefined && isDirty(draft, saved)

    // 保存成功后自动收起：等宿主确认写入落地（submitting 结束且 dirty 归 false）再收，
    // 写失败时草稿与 dirty 保留，故保持展开可原地重试；用户任何时刻手动开合不受此约束
    useEffect(() => {
        if (submitting) {
            saveStarted.current = true
            return
        }
        if (!saveStarted.current) return
        saveStarted.current = false
        if (!dirty) setOpen(false)
    }, [submitting, dirty])

    // 配置服务不可用：同一外壳的静态形态（无展开语义），保留可发现性便于排查
    if (snap.status === 'unavailable') {
        return (
            <div className="dsh-mr-card">
                <div className="dsh-mr-header dsh-mr-headerStatic">
                    <span className="dsh-mr-headText">
                        <span className="dsh-mr-name">{t('title')}</span>
                        <span className="dsh-mr-desc">{t('unavailable')}</span>
                    </span>
                </div>
            </div>
        )
    }

    const cellAria = (column: Column, row: (typeof FIELD_KEYS)[number]) =>
        `${t(ROW_KEYS[row])} ${t(COLUMN_KEYS[column])}`

    const onCell = (column: Column, key: (typeof FIELD_KEYS)[number]) => {
        setDraft(toggleCell(shown, column, key))
    }
    // 纵向总控：任一为开则显示开；点击取反并把该列三格全部设为同一值
    const onMaster = (column: Column) => {
        setDraft(applyColumn(shown, column, !masterValue(shown, column)))
    }
    const onApply = () => {
        if (!canWrite || !dirty || submitting) return
        setSubmitting(true)
        // 写入成功由宿主回推新 value（dirty 自动归 false，触发上面的自动收起）；失败时 scope
        // 内部已重读恢复，此处仅复位提交态，错误日志交由宿主 settingsScope 通道
        void scope.set(VERSION_KEY, snapshotFromFlags(shown))
            .catch(() => {
                /* 恢复读由 scope 负责，失败保持 dirty 态可重试 */
            })
            .finally(() => {
                setSubmitting(false)
            })
    }
    // 放弃修改：草稿归 null 即回到「跟随已存值」形态，dirty 随之消失（不发任何写）
    const onDiscard = () => {
        if (submitting) return
        setDraft(null)
    }
    // 危险操作：点按钮先弹宿主 Modal 二次确认；确认后经 RPC 触发 Node 半单次 force 填充。
    // 不依赖 canWrite/dirty（不改配置本身，只按目录覆盖写回模型字段）
    const onForce = () => {
        if (!ready || forceBusy || submitting) return
        setConfirmOpen(true)
    }
    const runForce = () => {
        setConfirmOpen(false)
        setForceBusy(true)
        props.forceUpdate()
            .then((result) => {
                if (result.ok) {
                    const changed = (result.value as { changed?: number } | undefined)?.changed ?? 0
                    showNotice(changed > 0 ? t('forceDone', { count: changed }) : t('forceNone'))
                } else {
                    showNotice(t('forceFailed', { message: truncateMessage(result.error.message) }), true)
                }
            })
            .catch((error: unknown) => {
                // 传输层失败（HTTP 非 2xx 等）call 直接 reject，与 ok:false 同一路径展示
                showNotice(t('forceFailed', { message: truncateMessage(error instanceof Error ? error.message : String(error)) }), true)
            })
            .finally(() => {
                setForceBusy(false)
            })
    }

    return (
        <div className={open ? 'dsh-mr-card dsh-mr-cardOpen' : 'dsh-mr-card'} ref={rootRef}>
            <button
                type="button"
                className="dsh-mr-header"
                aria-expanded={open}
                aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
                onClick={() => { setOpen(!open) }}
            >
                <span className="dsh-mr-headText">
                    <span className="dsh-mr-name">{t('title')}</span>
                    <span className="dsh-mr-desc">{t('description')}</span>
                </span>
                {/* 胶囊挂在 header：收起态也要说明卡里存着未落盘的编辑 */}
                {dirty ? <span className="dsh-mr-pending">{t('unsaved')}</span> : null}
                <IconChevronDownOutline14 className={open ? 'dsh-mr-chevron dsh-mr-chevronOpen' : 'dsh-mr-chevron'} />
            </button>
            {open ? (
                <div className="dsh-mr-body">
                    {!ready ? <p className="dsh-mr-statusHint" role="status">{t('loading')}</p> : null}
                    {ready && !snap.writable ? <p className="dsh-mr-statusHint" role="status">{t('readOnly')}</p> : null}
                    <div className="dsh-mr-grid">
                        <div className="dsh-mr-row dsh-mr-head">
                            <span className="dsh-mr-label">{t('colModelParams')}</span>
                            <span className="dsh-mr-colCell">
                                {/* 开关在前、标题随后（全选式阅读顺序）：与数据行开关左缘对齐且不误配到相邻列 */}
                                <Switch
                                    checked={masterValue(shown, 'autoFill')}
                                    disabled={!canWrite}
                                    aria={`${t('colAutoFill')} (${t('colModelParams')})`}
                                    onChange={() => { onMaster('autoFill') }}
                                />
                                <Tooltip label={t('tipAutoFill')} side="bottom" delayMs={500}>
                                    <span className="dsh-mr-tipText" tabIndex={0}>{t('colAutoFill')}</span>
                                </Tooltip>
                            </span>
                            <span className="dsh-mr-colCell">
                                <Switch
                                    checked={masterValue(shown, 'allowUpdate')}
                                    disabled={!canWrite}
                                    aria={`${t('colAllowUpdate')} (${t('colModelParams')})`}
                                    onChange={() => { onMaster('allowUpdate') }}
                                />
                                <Tooltip label={t('tipAllowUpdate')} side="bottom" delayMs={500}>
                                    <span className="dsh-mr-tipText" tabIndex={0}>{t('colAllowUpdate')}</span>
                                </Tooltip>
                            </span>
                        </div>
                        {FIELD_KEYS.map((key) => (
                            <div key={key} className="dsh-mr-row">
                                <span className="dsh-mr-label">{t(ROW_KEYS[key])}</span>
                                <span className="dsh-mr-cellWrap">
                                    <Switch
                                        checked={shown.autoFill[key]}
                                        disabled={!canWrite}
                                        aria={cellAria('autoFill', key)}
                                        onChange={() => { onCell('autoFill', key) }}
                                    />
                                </span>
                                <span className="dsh-mr-cellWrap">
                                    <Switch
                                        checked={shown.allowUpdate[key]}
                                        disabled={!canWrite}
                                        aria={cellAria('allowUpdate', key)}
                                        onChange={() => { onCell('allowUpdate', key) }}
                                    />
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="dsh-mr-footer">
                        <button
                            type="button"
                            className="dsh-mr-force"
                            disabled={!ready || forceBusy || submitting}
                            onClick={onForce}
                        >
                            {forceBusy ? t('forceBusy') : t('force')}
                        </button>
                        <span className="dsh-mr-actions">
                            <button
                                type="button"
                                className="dsh-mr-discard"
                                disabled={!dirty || submitting}
                                onClick={onDiscard}
                            >
                                {t('discard')}
                            </button>
                            <button
                                type="button"
                                className="dsh-mr-apply"
                                disabled={!canWrite || !dirty || submitting || forceBusy}
                                onClick={onApply}
                            >
                                {submitting ? t('saving') : t('apply')}
                            </button>
                        </span>
                    </div>
                </div>
            ) : null}
            {/* 二次确认弹层：宿主 Modal 原语（portal/遮罩/Escape 由组件自带），按钮范式同 RiskConfirmation；
                与条件展开体平级挂在本层，故折叠不会卸载在途弹层 */}
            <Modal
                open={confirmOpen}
                onClose={() => { setConfirmOpen(false) }}
                title={t('force')}
                closeLabel={t('close')}
                description={t('forceConfirm')}
                footer={<>
                    <Button variant="outline" onClick={() => { setConfirmOpen(false) }}>{t('forceCancel')}</Button>
                    <Button variant="primary" onClick={runForce}>{t('forceGo')}</Button>
                </>}
            />
            {/* 结果反馈：宿主 Toast 原语（锚卡片水平居中，自动淡出后卸载） */}
            {toast !== null && (
                <Toast
                    key={toast.seq}
                    text={toast.text}
                    icon={toast.failed ? <IconWarningOutline16 /> : undefined}
                    anchor={rootRef.current}
                    onDone={() => { setToast(null) }}
                />
            )}
        </div>
    )
}
