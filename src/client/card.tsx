/**
 * 模型参数填充卡片（浏览器半）：可折叠卡片，1:1 复刻官方 Web-UI 插件卡（ui-settings-plugins）。
 * header 整块为 `aria-expanded` 按钮（名称 + 描述两行，dirty 时挂「未保存」胶囊；折叠文案只进
 * aria-label，官方同款——视觉只有 chevron，不是死代码），展开体为 4 行表格（表头为纵向总控，
 * 不落存储；列名下方常驻 hint 释义，官方设置面不用 Tooltip）+ footer（强制更新 左｜放弃修改 · 应用 右）。
 * 本地暂存（draft）：单格/总控点击只改草稿，点「应用」才经 settingsScope 原子写 version-2；
 * 草稿跨折叠存活（收起时靠 header 胶囊告知未落盘），「放弃修改」即草稿归 null 回随已存值；
 * 应用被宿主确认落地（dirty 归 false）后自动收起并留一行弱提示，写失败保持展开与草稿可重试。
 * 结果反馈一律走卡片内联状态行（挂在 header 之后、条件展开体之外，故折叠不丢在途结果），
 * 不用宿主 Toast——官方设置面零 Toast 调用，成功走自动收起/绿字提示、失败走行内红字。
 * 「强制更新」（危险按钮，贴最左）弹宿主 Modal 二次确认（官方删除确认同款：outline 按钮 + 红色
 * tint + 取消键 autoFocus），确认后经 Connection RPC 请求 Node 半单次 force 填充。
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, IconChevronDownOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
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

/** 内联状态行：文本 + 色调（成功＝官方 .savedNotice 绿，失败＝.failed/.error 红） */
interface Notice {
    text: string
    tone: 'success' | 'error'
}

const STYLE_ID = 'dsh-model-reasoning-card-css'

/**
 * 内嵌样式表（类名 dsh-mr- 前缀防撞）。取值逐条对齐官方：卡片外壳按宿主「模型」页发布版同页
 * provider 行（dsh-client-ui-settings-models 的 .rowCard）——无背景 + 1px --dsw-alias-border-l2
 * + 12px 圆角；折叠壳/胶囊/开关/按钮逐字复刻 ui-settings-plugins 的 PluginCard 与
 * SubagentModelSelectionCard（宿主无 Switch 原语、插件卡 footer 亦不自用 Button 原语，故皆自绘）。
 * 颜色一律只用宿主 --dsw-alias-* 令牌（主题插件改色时与官方同步变化），字面量仅作令牌缺失时的
 * 浅色守卫，且取 design-platform.css 真值（label-primary/brand-primary 浅色下即近黑，非品牌蓝）；
 * 官方源码里的 --dsw-alias-label-error、--dsw-alias-bg-layer-4 属未定义令牌，禁止照抄。
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
    '.dsh-mr-pending{flex:none;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b)}',
    // 展开体：左右内缩与 rowCard 左缘对齐，顶部分隔线即与 header 的界线
    '.dsh-mr-body{margin:0 14px;padding-bottom:8px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));display:flex;flex-direction:column;gap:12px}',
    // 状态行：内联承载一切结果反馈（官方设置面无 Toast）
    '.dsh-mr-notice{margin:0;padding:0 14px 12px;font-size:12px;line-height:18px}',
    '.dsh-mr-noticeSuccess{color:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mr-noticeError{color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mr-line{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mr-warn{color:var(--dsw-alias-state-warn-label,#dd8629)}',
    '.dsh-mr-grid{display:flex;flex-direction:column}',
    // 分隔线只在相邻行间画（表头行不画顶边，避免与展开体顶线叠成粗线）
    '.dsh-mr-row{display:grid;grid-template-columns:minmax(0,1fr) 140px 140px;align-items:center;gap:8px;padding:8px 0}',
    '.dsh-mr-row+.dsh-mr-row{border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}',
    // 表头取发布版说明条同规格（.modelCatalogTitle：12/18、500、label-secondary）
    '.dsh-mr-head{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mr-label{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#0f1115)}',
    // 列头两行：开关+列名一行，释义常驻下一行（官方 fields .hint）
    '.dsh-mr-colCell{display:flex;flex-direction:column;gap:2px}',
    '.dsh-mr-colTop{display:flex;align-items:center;gap:8px}',
    '.dsh-mr-colHint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mr-cellWrap{display:flex;align-items:center}',
    // 开关：逐字复刻官方 .switch/.thumb（宿主无 Switch 原语；轨道无过渡）
    '.dsh-mr-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3,rgba(0,0,0,.12));cursor:pointer}',
    '.dsh-mr-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#0f1115)}',
    '.dsh-mr-switch:disabled{cursor:default;opacity:.5}',
    '.dsh-mr-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:2px}',
    '.dsh-mr-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground,#fff);transition:transform 120ms ease}',
    '.dsh-mr-switch[aria-checked="true"] .dsh-mr-thumb{transform:translateX(16px)}',
    '.dsh-mr-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0 4px;border-top:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}',
    '.dsh-mr-actions{display:flex;align-items:center;gap:8px}',
    // footer 三把按钮共用官方 .discard/.save 基座；危险键按官方语义为红字透明底（无实心红先例）
    '.dsh-mr-discard,.dsh-mr-apply,.dsh-mr-force{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}',
    '.dsh-mr-discard{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:none;color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mr-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary,#0f1115);border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mr-apply{background:var(--dsw-alias-label-primary,#0f1115);color:var(--dsw-alias-bg-layer-3,#fff)}',
    '.dsh-mr-force{background:none;color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mr-force:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05))}',
    '.dsh-mr-discard:disabled,.dsh-mr-apply:disabled,.dsh-mr-force:disabled{opacity:.4;cursor:default}',
    '.dsh-mr-discard:focus-visible,.dsh-mr-apply:focus-visible,.dsh-mr-force:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:1px}',
    // 危险确认键：官方 .deleteConfirm 写法（outline 按钮 + 红描边红字 + danger hover）
    '.dsh-mr-confirmDanger:not(:disabled){border-color:var(--dsw-alias-state-error-primary,#ec1313);color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mr-confirmDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05))}',
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

/** 失败信息截断（内联状态行为单行小字，防长消息撑爆布局） */
function truncateMessage(value: string): string {
    return value.length > 120 ? `${value.slice(0, 119)}…` : value
}

/** 自绘开关（宿主无 Switch 原语，官方插件卡同样自绘 role="switch"，结构与取值逐字对齐） */
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
    // 内联结果提示：常驻至下一次操作（官方 .savedNotice 无定时器，故不设自动淡出）
    const [notice, setNotice] = useState<Notice | null>(null)
    // 强制更新执行态；confirmOpen 控宿主 Modal 二次确认
    const [forceBusy, setForceBusy] = useState(false)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const saveStarted = useRef(false)

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
        setNotice(null)
        setDraft(toggleCell(shown, column, key))
    }
    // 纵向总控：任一为开则显示开；点击取反并把该列三格全部设为同一值
    const onMaster = (column: Column) => {
        setNotice(null)
        setDraft(applyColumn(shown, column, !masterValue(shown, column)))
    }
    const onApply = () => {
        if (!canWrite || !dirty || submitting) return
        setNotice(null)
        setSubmitting(true)
        // 写入成功由宿主回推新 value（dirty 自动归 false，触发上面的自动收起），此处留一行弱提示；
        // 失败时 scope 内部已重读恢复，胶囊与展开态即传达「未落盘」，不另发提示
        void scope.set(VERSION_KEY, snapshotFromFlags(shown))
            .then(() => {
                // 官方 card-form 的范式是写后读回核对：值真被宿主接受才算成功并发提示，
                // 未落地则保持「未保存」胶囊与展开态，不误报成功
                const latest = scope.getSnapshot().value
                if (latest !== undefined && !isDirty(shown, latest)) {
                    setNotice({ text: t('saveDone'), tone: 'success' })
                }
            })
            .catch(() => {
                /* 恢复读由 scope 负责，失败保持 dirty 态可重试 */
            })
            .finally(() => {
                setSubmitting(false)
            })
    }
    // 放弃修改：草稿归 null 即回到「跟随已存值」形态，dirty 随之消失（不发任何写）。
    // TODO(恢复默认)：官方 reset 语义＝scope.unset 清掉 user 层、回落组合层 base（见 harness
    // card-form.ts 的 resetField/plan），与 discard（只丢草稿）正交；本插件的快照无 base 层，
    // 若要「恢复默认」应显式写入 DEFAULT_FLAGS 规范快照，属独立需求，勿与本按钮混用。
    const onDiscard = () => {
        if (submitting) return
        setNotice(null)
        setDraft(null)
    }
    // 危险操作：点按钮先弹宿主 Modal 二次确认；确认后经 RPC 触发 Node 半单次 force 填充。
    // 不依赖 canWrite/dirty（不改配置本身，只按目录覆盖写回模型字段）
    const onForce = () => {
        if (!ready || forceBusy || submitting) return
        setNotice(null)
        setConfirmOpen(true)
    }
    const runForce = () => {
        setConfirmOpen(false)
        setForceBusy(true)
        props.forceUpdate()
            .then((result) => {
                if (result.ok) {
                    const changed = (result.value as { changed?: number } | undefined)?.changed ?? 0
                    setNotice({ text: changed > 0 ? t('forceDone', { count: changed }) : t('forceNone'), tone: 'success' })
                } else {
                    setNotice({ text: t('forceFailed', { message: truncateMessage(result.error.message) }), tone: 'error' })
                }
            })
            .catch((error: unknown) => {
                // 传输层失败（HTTP 非 2xx 等）call 直接 reject，与 ok:false 同一路径展示
                setNotice({
                    text: t('forceFailed', { message: truncateMessage(error instanceof Error ? error.message : String(error)) }),
                    tone: 'error',
                })
            })
            .finally(() => {
                setForceBusy(false)
            })
    }

    return (
        <div className={open ? 'dsh-mr-card dsh-mr-cardOpen' : 'dsh-mr-card'}>
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
            {/* 结果提示挂在条件体之外：折叠不会吞掉在途/已到的结果 */}
            {notice !== null ? (
                <p
                    className={notice.tone === 'error' ? 'dsh-mr-notice dsh-mr-noticeError' : 'dsh-mr-notice dsh-mr-noticeSuccess'}
                    role={notice.tone === 'error' ? 'alert' : 'status'}
                    aria-live={notice.tone === 'error' ? undefined : 'polite'}
                >
                    {notice.text}
                </p>
            ) : null}
            {open ? (
                <div className="dsh-mr-body">
                    {!ready ? <p className="dsh-mr-line" role="status">{t('loading')}</p> : null}
                    {ready && !snap.writable ? <p className="dsh-mr-line dsh-mr-warn" role="status">{t('readOnly')}</p> : null}
                    <div className="dsh-mr-grid">
                        <div className="dsh-mr-row dsh-mr-head">
                            <span className="dsh-mr-label">{t('colModelParams')}</span>
                            {/* 开关在前、标题随后（全选式阅读顺序）：与数据行开关左缘对齐且不误配到相邻列 */}
                            <span className="dsh-mr-colCell">
                                <span className="dsh-mr-colTop">
                                    <Switch
                                        checked={masterValue(shown, 'autoFill')}
                                        disabled={!canWrite}
                                        aria={`${t('colAutoFill')} (${t('colModelParams')})`}
                                        onChange={() => { onMaster('autoFill') }}
                                    />
                                    <span>{t('colAutoFill')}</span>
                                </span>
                                <span className="dsh-mr-colHint">{t('hintAutoFill')}</span>
                            </span>
                            <span className="dsh-mr-colCell">
                                <span className="dsh-mr-colTop">
                                    <Switch
                                        checked={masterValue(shown, 'allowUpdate')}
                                        disabled={!canWrite}
                                        aria={`${t('colAllowUpdate')} (${t('colModelParams')})`}
                                        onChange={() => { onMaster('allowUpdate') }}
                                    />
                                    <span>{t('colAllowUpdate')}</span>
                                </span>
                                <span className="dsh-mr-colHint">{t('hintAllowUpdate')}</span>
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
            {/* 二次确认弹层：宿主 Modal + Button 原语（官方同页删除 provider 即用此组合，
                portal/遮罩/Escape 由组件自带）；危险确认键按官方 .deleteConfirm 上红 tint，
                取消键 autoFocus（与官方一致：焦点落在可安全退出的那一侧） */}
            <Modal
                open={confirmOpen}
                onClose={() => { setConfirmOpen(false) }}
                title={t('force')}
                closeLabel={t('close')}
                description={t('forceConfirm')}
                footer={<>
                    <Button variant="outline" autoFocus onClick={() => { setConfirmOpen(false) }}>{t('forceCancel')}</Button>
                    <Button variant="outline" className="dsh-mr-confirmDanger" onClick={runForce}>{t('forceGo')}</Button>
                </>}
            />
        </div>
    )
}
