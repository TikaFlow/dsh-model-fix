/**
 * 模型参数填充卡片（浏览器半）：可折叠卡片，1:1 复刻官方 Web-UI 插件卡（ui-settings-plugins）。
 * header 整块为 `aria-expanded` 按钮（名称 + 描述两行，dirty 时挂「未保存」胶囊；折叠文案只进
 * aria-label，官方同款——视觉只有 chevron，不是死代码）。展开体是两个配置组瓦片（自动填充 /
 * 允许更新），排版照官方「插件列表」项卡：一行两个的栅格、summary 行（组名 + 整组开关 + 箭头，
 * min-height 52px）、展开体（组释义 + 三行子开关，填官方 .cardDetails 的模块底色）。展开态样式
 * 完全跟随官方（`data-open` 驱动）：描边由 l4 换最浅的 l1 并叠两层柔光、summary 行保留淡底、
 * 箭头 180° 旋转。瓦片默认收起、同时只展开一个（官方手风琴语义——各瓦片展开高度不同，
 * 同时展开两列底部会参差）。
 * 正文下方为 footer（强制更新 左｜放弃修改 · 保存 右）。
 * 全卡分隔线：外层摘要↔正文 1 条 + 每个展开中的瓦片 1 条 + footer 1 条，均官方同值 0.5px --dsw-alias-border-l2。
 * 本地暂存（draft）：单格/总控点击只改草稿，点「保存」才经 settingsScope 原子写 version-2；
 * 草稿跨折叠存活（收起时靠 header 胶囊告知未落盘），「放弃修改」即草稿归 null 回随已存值；
 * 保存被宿主确认落地（dirty 归 false）后自动收起并留一行弱提示，写失败保持展开与草稿可重试。
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
 * 内嵌样式表（类名 dsh-mr- 前缀防撞）。取值逐条照搬官方，两层各按其同类组件：
 * 外层卡＝ui-settings-plugins 的 PluginCard（0.5px border-l4 + 16px 圆角 + bg-layer-3，展开态
 * 描边 label-dimmed、底 bg-layer-2；胶囊/开关/按钮亦出自该包）；内层瓦片＝ui-settings-plugin-inventory
 * 的插件列表项卡（栅格 repeat(2,minmax(0,1fr)) gap 10、14px 圆角、elevation 发丝描边、展开态
 * data-open 三变化）。本卡是可展开的设置卡，与 provider 行（.rowCard，不可展开的列表行）不是同类
 * 组件，故不再按同页数值折中，一律照官方同类组件取值。宿主无 Switch 原语、插件卡 footer 亦不自用
 * Button 原语，故两处皆自绘复刻。
 * 颜色一律只用宿主 --dsw-alias-* 令牌（主题插件改色时与官方同步变化），字面量仅作令牌缺失时的
 * 浅色守卫，且取 design-platform.css 真值（label-primary/brand-primary 浅色下即近黑，非品牌蓝）；
 * 官方源码里的 --dsw-alias-label-error、--dsw-alias-bg-layer-4 属未定义令牌，禁止照抄。
 */
const STYLE_TEXT = [
    // 外壳逐字照官方插件卡 .card（0.5px border-l4 + 16px 圆角 + bg-layer-3 底；hover/展开换
    // label-dimmed 描边，展开态底改 bg-layer-2——官方即"正在编辑的那张"表达）
    '.dsh-mr-card{max-width:720px;border:0.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.16));border-radius:16px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s, background .16s}',
    '.dsh-mr-card:hover{border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mr-cardOpen{border-color:var(--dsw-alias-label-dimmed,#e1e5ee);background:var(--dsw-alias-bg-layer-2,#fff)}',
    // header：名称叠描述，右侧未保存胶囊与旋转 chevron
    '.dsh-mr-header{display:flex;align-items:center;gap:12px;box-sizing:border-box;width:100%;padding:14px 16px;border:1px solid transparent;border-radius:12px;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}',
    '.dsh-mr-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-2px}',
    // 配置服务不可用时的静态头（div 渲染，无展开语义）
    '.dsh-mr-headerStatic{cursor:default}',
    '.dsh-mr-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
    '.dsh-mr-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mr-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mr-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#81858c);transition:transform .16s}',
    '.dsh-mr-chevronOpen{transform:rotate(180deg)}',
    '.dsh-mr-pending{flex:none;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b)}',
    // 展开体：左右内缩 16px 与 header 的 padding 对齐；顶部 0.5px 分隔线隔开外层摘要与正文，
    // 12px 上边距撑开与瓦片的距离（官方由子项 .permission 的 padding:12px 0 提供，我们以容器 padding 等效实现）
    '.dsh-mr-body{margin:0 16px;padding:12px 0 8px;border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));display:flex;flex-direction:column;gap:12px}',
    // 状态行：内联承载一切结果反馈（官方设置面无 Toast）
    '.dsh-mr-notice{margin:0;padding:0 16px 12px;font-size:12px;line-height:18px}',
    '.dsh-mr-noticeSuccess{color:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mr-noticeError{color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mr-line{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mr-warn{color:var(--dsw-alias-state-warn-label,#dd8629)}',
    // 配置组瓦片：栅格、项卡外壳、描边/阴影、行与展开体逐条照官方「插件列表」项卡
    // （ui-settings-plugin-inventory）。描边用官方同一套 elevation 令牌链（0.5px 发丝画在
    // box-shadow 里、组件 border:0），并在字面兜底里原样复刻该链的计算结果——宿主定义了令牌
    // 即与官方同源同源换色，未定义（更旧宿主）也得到同一观感。
    '.dsh-mr-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px}',
    '.dsh-mr-item{min-width:0;overflow:hidden;border:0;border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:var(--dsw-elevation-stroke,0 0 0 0.5px var(--dsw-alias-border-l4,rgba(0,0,0,.16)))}',
    // 展开态（官方 data-open 驱动）：描边换最浅的 l1 并叠两层柔光，summary 行保留淡底
    '.dsh-mr-item[data-open="true"]{--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,rgba(0,0,0,.04));box-shadow:var(--dsw-elevation-panel,0 0 0 0.5px var(--dsw-alias-border-l1,rgba(0,0,0,.04)),0 3px 8px 0 rgba(0,0,0,.03),0 0 16px 0 rgba(0,0,0,.02))}',
    '.dsh-mr-item[data-open="true"]>.dsh-mr-itemHead{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
    '.dsh-mr-itemHead{box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:52px;padding:12px 14px;color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mr-itemHead:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
    // 整行折叠按钮：透明覆盖层承担点击与键盘（hover/展开底色画在行容器上）；
    // 尾区抬 z-index 并关掉自身 pointer-events、只放开开关本体——整行可点而开关不被吞，也不产生 button 套 button
    '.dsh-mr-itemToggle{position:absolute;inset:0;padding:0;border:none;border-radius:14px;background:none;cursor:pointer}',
    '.dsh-mr-itemToggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:-2px}',
    '.dsh-mr-itemTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:600}',
    '.dsh-mr-itemTrailing{position:relative;z-index:1;display:inline-flex;flex:none;align-items:center;gap:7px;pointer-events:none;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mr-itemSwitch{pointer-events:auto}',
    '.dsh-mr-itemChevron{flex:none;transition:transform 140ms var(--ds-ease-in-out,ease)}',
    '.dsh-mr-item[data-open="true"] .dsh-mr-itemChevron{transform:rotate(180deg)}',
    // 展开体填充官方 .cardDetails 的模块底色（与同页 .editor/.setupCard 同令牌），使展开内容读成内层面板
    '.dsh-mr-itemBody{border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));padding:10px 14px 12px;display:grid;gap:6px;background:var(--dsw-alias-bg-module-platform,#f5f6f7)}',
    '.dsh-mr-itemHint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mr-itemRow{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#0f1115)}',
    '@media (max-width:680px){.dsh-mr-items{grid-template-columns:minmax(0,1fr)}}',
    '@media (prefers-reduced-motion:reduce){.dsh-mr-itemChevron{transition:none}}',
    // 开关：逐字复刻官方 .switch/.thumb（宿主无 Switch 原语；轨道无过渡）
    '.dsh-mr-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3,rgba(0,0,0,.12));cursor:pointer}',
    '.dsh-mr-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#0f1115)}',
    '.dsh-mr-switch:disabled{cursor:default;opacity:.5}',
    '.dsh-mr-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:2px}',
    '.dsh-mr-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground,#fff);transition:transform 120ms ease}',
    '.dsh-mr-switch[aria-checked="true"] .dsh-mr-thumb{transform:translateX(16px)}',
    '.dsh-mr-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0 4px;border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}',
    '.dsh-mr-actions{display:flex;align-items:center;gap:8px}',
    // footer 三把按钮共用官方 .discard/.save 基座；危险键按官方语义为红字透明底（无实心红先例）
    '.dsh-mr-discard,.dsh-mr-save,.dsh-mr-force{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}',
    '.dsh-mr-discard{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:none;color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mr-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary,#0f1115);border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mr-save{background:var(--dsw-alias-label-primary,#0f1115);color:var(--dsw-alias-bg-layer-3,#fff)}',
    '.dsh-mr-force{background:none;color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mr-force:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05))}',
    '.dsh-mr-discard:disabled,.dsh-mr-save:disabled,.dsh-mr-force:disabled{opacity:.4;cursor:default}',
    '.dsh-mr-discard:focus-visible,.dsh-mr-save:focus-visible,.dsh-mr-force:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:1px}',
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

/**
 * 配置组瓦片（官方「插件列表」项卡同款）：summary 为组名 + 整组开关 + 折叠箭头，
 * 展开体为组释义 + 三行子开关。整行可点由 `.dsh-mr-itemToggle` 覆盖层承担，开关在其
 * 上层独占点击区（故不存在 button 嵌套）；可访问名用 aria-labelledby 指向可见标题。
 */
function GroupTile(props: {
    column: Column
    tileKey: string
    title: string
    hint: string
    open: boolean
    disabled: boolean
    flags: Flags
    masterAria: string
    onToggle: () => void
    onMaster: () => void
    onCell: (key: (typeof FIELD_KEYS)[number]) => void
    labelOf: (key: (typeof FIELD_KEYS)[number]) => string
    cellAria: (key: (typeof FIELD_KEYS)[number]) => string
}) {
    const id = `dsh-mr-item-${props.tileKey}`
    return (
        <div className="dsh-mr-item" role="group" data-open={props.open ? 'true' : undefined} aria-labelledby={`${id}-title`}>
            <div className="dsh-mr-itemHead">
                <button
                    type="button"
                    className="dsh-mr-itemToggle"
                    aria-expanded={props.open}
                    aria-controls={`${id}-body`}
                    aria-labelledby={`${id}-title`}
                    onClick={props.onToggle}
                />
                <strong className="dsh-mr-itemTitle" id={`${id}-title`}>{props.title}</strong>
                <span className="dsh-mr-itemTrailing">
                    <span className="dsh-mr-itemSwitch">
                        <Switch
                            checked={masterValue(props.flags, props.column)}
                            disabled={props.disabled}
                            aria={props.masterAria}
                            onChange={props.onMaster}
                        />
                    </span>
                    <IconChevronDownOutline14 size={12} className="dsh-mr-itemChevron" />
                </span>
            </div>
            {props.open ? (
                <div className="dsh-mr-itemBody" id={`${id}-body`}>
                    <p className="dsh-mr-itemHint">{props.hint}</p>
                    {FIELD_KEYS.map((key) => (
                        <div key={key} className="dsh-mr-itemRow">
                            <span>{props.labelOf(key)}</span>
                            <Switch
                                checked={props.flags[props.column][key]}
                                disabled={props.disabled}
                                aria={props.cellAria(key)}
                                onChange={() => { props.onCell(key) }}
                            />
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
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
    // 两个配置组瓦片的折叠态：沿用官方「插件列表」的手风琴语义（同时只开一个、默认全收起，
    // 状态按行键 string 而非列名存，与官方 expanded: string | null 同形）——各瓦片展开后高度
    // 不同，同时展开会让两列底部参差，官方因此单选
    const [tileOpen, setTileOpen] = useState<string | null>(null)
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
    // 整组总控：组内任一为开则显示开；点击取反并把该组三格全部设为同一值
    const onMaster = (column: Column) => {
        setNotice(null)
        setDraft(applyColumn(shown, column, !masterValue(shown, column)))
    }
    // 瓦片折叠：官方 toggleRow 同语义——点已开者即收起，否则切到该瓦片
    const onTileToggle = (key: string) => {
        setTileOpen((prev) => (prev === key ? null : key))
    }
    const onSave = () => {
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
                    <div className="dsh-mr-items">
                        <GroupTile
                            column="autoFill"
                            tileKey="autoFill"
                            title={t('colAutoFill')}
                            hint={t('hintAutoFill')}
                            open={tileOpen === 'autoFill'}
                            disabled={!canWrite}
                            flags={shown}
                            masterAria={`${t('colAutoFill')} ${t('masterAll')}`}
                            onToggle={() => { onTileToggle('autoFill') }}
                            onMaster={() => { onMaster('autoFill') }}
                            onCell={(key) => { onCell('autoFill', key) }}
                            labelOf={(key) => t(ROW_KEYS[key])}
                            cellAria={(key) => cellAria('autoFill', key)}
                        />
                        <GroupTile
                            column="allowUpdate"
                            tileKey="allowUpdate"
                            title={t('colAllowUpdate')}
                            hint={t('hintAllowUpdate')}
                            open={tileOpen === 'allowUpdate'}
                            disabled={!canWrite}
                            flags={shown}
                            masterAria={`${t('colAllowUpdate')} ${t('masterAll')}`}
                            onToggle={() => { onTileToggle('allowUpdate') }}
                            onMaster={() => { onMaster('allowUpdate') }}
                            onCell={(key) => { onCell('allowUpdate', key) }}
                            labelOf={(key) => t(ROW_KEYS[key])}
                            cellAria={(key) => cellAria('allowUpdate', key)}
                        />
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
                                className="dsh-mr-save"
                                disabled={!canWrite || !dirty || submitting || forceBusy}
                                onClick={onSave}
                            >
                                {submitting ? t('saving') : t('save')}
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
