/**
 * 模型参数填充卡片（浏览器半）：可折叠卡片，1:1 复刻官方 Web-UI 插件卡（ui-settings-plugins）。
 * header 整块为 `aria-expanded` 按钮（名称 + 描述两行，dirty 时挂「未保存」胶囊；折叠文案只进
 * aria-label，官方同款——视觉只有 chevron，不是死代码）。展开体是四个配置组瓦片（自动填充 /
 * 允许更新 / 兼容性 / 排除提供方），排版照官方「插件列表」项卡：一行两个的栅格、summary 行（组名 +
 * 组控件 + 箭头，min-height 52px）、展开体（组释义 + 该组的子控件行，填官方 .cardDetails 的模块底色）。
 * 前三张同形（布尔矩阵：组内任一为开即显示开，点击整组同置）；第四张是动态集合瓦片——summary 的开关位
 * 换成「N 命中」计数徽标（0 命中也常驻），展开体为输入框 + 每行一项的标签列表，命中的项（其 id 存在于
 * 宿主 llm-pi-ai 的 user 层，即本插件确会跳过它）转绿并带圆点，未命中项为普通样式但同样生效。
 * 展开态样式
 * 完全跟随官方（`data-open` 驱动）：描边由 l4 换最浅的 l1 并叠两层柔光、summary 行保留淡底、
 * 箭头 180° 旋转。瓦片默认收起、同时只展开一个（官方手风琴语义——各瓦片展开高度不同，
 * 同时展开两列底部会参差）。
 * 正文下方为 footer（强制更新 左｜放弃修改 · 保存 右）。
 * 全卡分隔线：外层摘要↔正文 1 条 + 每个展开中的瓦片 1 条 + footer 1 条，均官方同值 0.5px --dsw-alias-border-l2。
 * 本地暂存（draft）：单格/总控/增删排除项只改草稿，点「保存」才经 settingsScope 原子写当前版本快照键；
 * 草稿跨折叠存活（收起时靠 header 胶囊告知未落盘），「放弃修改」即草稿归 null 回随已存值；
 * 保存被宿主确认落地（dirty 归 false）后自动收起并留一行弱提示，写失败保持展开与草稿可重试。
 * 结果反馈一律走卡片内联状态行（挂在 header 之后、条件展开体之外，故折叠不丢在途结果），
 * 不用宿主 Toast——官方设置面零 Toast 调用，成功走自动收起/绿字提示、失败走行内红字。
 * 「强制更新」（危险按钮，贴最左）弹宿主 Modal 二次确认（官方删除确认同款：outline 按钮 + 红色
 * tint + 取消键 autoFocus），确认后经 Connection RPC 请求 Node 半单次 force 填充。
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Button, IconChevronDownOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RpcResult } from '../types'

/**
 * 排除项删除钮的字形：逐字复刻官方 models 页模型行删除的本地 `IconTrash`（线稿风格：
 * 14×14 / viewBox 16 / stroke 1.3 / round cap+join / currentColor / aria-hidden）。
 * 不用 primitives 的 `IconTrashOutline16`——那是实心填充桶，同尺寸下墨量大得多，正是"显胖"的根源；
 * 本地组件同理须自绘而非引宿主内部函数（宿主该函数不导出）。
 */
function IconTrash() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
                d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    )
}
import {
    DEFAULT_FLAGS,
    EXCLUDE_ID_PATTERN,
    GROUPS,
    GROUP_KEYS,
    VERSION_KEY,
    addExclude,
    applyGroup,
    groupValue,
    isDirty,
    masterValue,
    providerIdsOf,
    removeExclude,
    resolveHits,
    snapshotFromFlags,
    toggleCell,
} from './model'
import type { CardKey } from './locales'
import type { Flags, Group, RowKey } from './model'
import { COLUMN_KEYS, HINT_KEYS, ROW_KEYS } from './locales'

/** 卡片组件 props（t 由 slots.register 的 locale 席位合成注入；scope/forceUpdate 由入口闭包传入） */
export interface CardProps {
    t: TranslateNS<'settings.modelFix'>
    scope: SettingsScope<Flags>
    /** 宿主 llm-pi-ai 命名空间：只取 snapshot.user 的提供商 id，判定排除项是否命中 */
    providersScope: SettingsScope<readonly unknown[]>
    /** 强制更新 RPC：channel 与端点在入口拼好，卡片只消费结果 */
    forceUpdate: () => Promise<RpcResult<unknown>>
}

/** 内联状态行：文本 + 色调（成功＝官方 .savedNotice 绿，失败＝.failed/.error 红） */
interface Notice {
    text: string
    tone: 'success' | 'error'
}

const STYLE_ID = 'dsh-model-fix-card-css'

/**
 * 内嵌样式表（类名 dsh-mf- 前缀防撞）。取值逐条照搬官方，两层各按其同类组件：
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
    '.dsh-mf-card{max-width:720px;border:0.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.16));border-radius:16px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s, background .16s}',
    '.dsh-mf-card:hover{border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mf-cardOpen{border-color:var(--dsw-alias-label-dimmed,#e1e5ee);background:var(--dsw-alias-bg-layer-2,#fff)}',
    // header：名称叠描述，右侧未保存胶囊与旋转 chevron
    '.dsh-mf-header{display:flex;align-items:center;gap:12px;box-sizing:border-box;width:100%;padding:14px 16px;border:1px solid transparent;border-radius:12px;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}',
    '.dsh-mf-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-2px}',
    // 配置服务不可用时的静态头（div 渲染，无展开语义）
    '.dsh-mf-headerStatic{cursor:default}',
    '.dsh-mf-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
    '.dsh-mf-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mf-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#81858c);transition:transform .16s}',
    '.dsh-mf-chevronOpen{transform:rotate(180deg)}',
    '.dsh-mf-pending{flex:none;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b)}',
    // 展开体：左右内缩 16px 与 header 的 padding 对齐；顶部 0.5px 分隔线隔开外层摘要与正文，
    // 12px 上边距撑开与瓦片的距离（官方由子项 .permission 的 padding:12px 0 提供，我们以容器 padding 等效实现）
    '.dsh-mf-body{margin:0 16px;padding:12px 0 8px;border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));display:flex;flex-direction:column;gap:12px}',
    // 状态行：内联承载一切结果反馈（官方设置面无 Toast）
    '.dsh-mf-notice{margin:0;padding:0 16px 12px;font-size:12px;line-height:18px}',
    '.dsh-mf-noticeSuccess{color:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mf-noticeError{color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mf-line{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-warn{color:var(--dsw-alias-state-warn-label,#dd8629)}',
    // 配置组瓦片：栅格、项卡外壳、描边/阴影、行与展开体逐条照官方「插件列表」项卡
    // （ui-settings-plugin-inventory）。描边用官方同一套 elevation 令牌链（0.5px 发丝画在
    // box-shadow 里、组件 border:0），并在字面兜底里原样复刻该链的计算结果——宿主定义了令牌
    // 即与官方同源同源换色，未定义（更旧宿主）也得到同一观感。
    '.dsh-mf-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px}',
    '.dsh-mf-item{min-width:0;overflow:hidden;border:0;border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:var(--dsw-elevation-stroke,0 0 0 0.5px var(--dsw-alias-border-l4,rgba(0,0,0,.16)))}',
    // 展开态（官方 data-open 驱动）：描边换最浅的 l1 并叠两层柔光，summary 行保留淡底
    '.dsh-mf-item[data-open="true"]{--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,rgba(0,0,0,.04));box-shadow:var(--dsw-elevation-panel,0 0 0 0.5px var(--dsw-alias-border-l1,rgba(0,0,0,.04)),0 3px 8px 0 rgba(0,0,0,.03),0 0 16px 0 rgba(0,0,0,.02))}',
    '.dsh-mf-item[data-open="true"]>.dsh-mf-itemHead{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
    '.dsh-mf-itemHead{box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:52px;padding:12px 14px;color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mf-itemHead:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
    // 整行折叠按钮：透明覆盖层承担点击与键盘（hover/展开底色画在行容器上）；
    // 尾区抬 z-index 并关掉自身 pointer-events、只放开开关本体——整行可点而开关不被吞，也不产生 button 套 button
    '.dsh-mf-itemToggle{position:absolute;inset:0;padding:0;border:none;border-radius:14px;background:none;cursor:pointer}',
    '.dsh-mf-itemToggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4176e6);outline-offset:-2px}',
    '.dsh-mf-itemTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:600}',
    '.dsh-mf-itemTrailing{position:relative;z-index:1;display:inline-flex;flex:none;align-items:center;gap:7px;pointer-events:none;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-itemSwitch{pointer-events:auto}',
    '.dsh-mf-itemChevron{flex:none;transition:transform 140ms var(--ds-ease-in-out,ease)}',
    '.dsh-mf-item[data-open="true"] .dsh-mf-itemChevron{transform:rotate(180deg)}',
    // 展开体填充官方 .cardDetails 的模块底色（与同页 .editor/.setupCard 同令牌），使展开内容读成内层面板
    '.dsh-mf-itemBody{border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));padding:10px 14px 12px;display:grid;gap:6px;background:var(--dsw-alias-bg-module-platform,#f5f6f7)}',
    '.dsh-mf-itemHint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-itemRow{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#0f1115)}',
    // 「排除提供方」瓦片专用：命中/未命中状态胶囊与小绿点照官方「插件列表」项卡的状态徽章体系
    // （ui-settings-plugin-inventory 的 .configTag + data-kind 与 .statusDot，语义同为"启用中/未启用"）：
    // 胶囊 min-height 20px / 圆角 5 / 1px 6px / 11-16 / inline-flex，未命中=默认 bg-layer-1 + label-secondary，
    // 命中=color-mix(state-success-primary 10%, transparent) 底 + state-success-primary 文字（无边框）；
    // 绿点 7×7 / border-radius 999 / corner-shape round。输入框照 ModelsSection 的 .input；
    // 删除钮照同页 .iconButton（28×28 / 6px 圆角 / hover 抬色），字形照同页行删除的自绘线稿 IconTrash。
    '.dsh-mf-count{flex:none;border-radius:5px;padding:1px 6px;font-size:11px;line-height:16px;white-space:nowrap;min-height:20px;display:inline-flex;align-items:center;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mf-count[data-hit="true"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#22c55e) 10%, transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mf-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.16));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:14px;line-height:22px}',
    '.dsh-mf-input:focus{border-color:var(--dsw-alias-brand-primary,#0f1115);outline:none}',
    '.dsh-mf-input::placeholder{color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mf-input:disabled{opacity:.6;cursor:default}',
    '.dsh-mf-fieldError{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ec1313)}',
    // 一行一项：状态点在胶囊**外**（官方 trailing 是 [PhaseDot][StateTag] 两个兄弟节点），行距对齐官方 7px；
    // 删除钮用官方 .rowActions 的 margin-left:auto 贴右成列（连续点击目标不漂移）
    '.dsh-mf-tagRow{position:relative;display:flex;align-items:center;gap:7px;min-width:0}',
    '.dsh-mf-tag{min-width:0;display:inline-flex;align-items:center;gap:6px;border-radius:5px;padding:1px 6px;font-size:11px;line-height:16px;min-height:20px;white-space:nowrap;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mf-tag[data-hit="true"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#22c55e) 10%, transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mf-tagText{min-width:0;overflow:hidden;text-overflow:ellipsis}',
    // 命中的第二信号（不只靠颜色）：照官方 .statusDot 的 7px 圆点（data-phase=active 同款 success 色）
    '.dsh-mf-tagDot{flex:none;width:7px;height:7px;display:inline-block;border-radius:999px;corner-shape:round;background:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mf-remove{box-sizing:border-box;flex:none;width:28px;height:28px;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}',
    '.dsh-mf-remove:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mf-remove:disabled{cursor:default;opacity:.4}',
    '.dsh-mf-remove:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:-2px}',
    // 只给读屏器的状态文案：照同页 .hiddenLabel 的裁剪手法
    '.dsh-mf-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media (max-width:680px){.dsh-mf-items{grid-template-columns:minmax(0,1fr)}}',
    '@media (prefers-reduced-motion:reduce){.dsh-mf-itemChevron{transition:none}}',
    // 开关：逐字复刻官方 .switch/.thumb（宿主无 Switch 原语；轨道无过渡）
    '.dsh-mf-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3,rgba(0,0,0,.12));cursor:pointer}',
    '.dsh-mf-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#0f1115)}',
    '.dsh-mf-switch:disabled{cursor:default;opacity:.5}',
    '.dsh-mf-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:2px}',
    '.dsh-mf-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground,#fff);transition:transform 120ms ease}',
    '.dsh-mf-switch[aria-checked="true"] .dsh-mf-thumb{transform:translateX(16px)}',
    '.dsh-mf-footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0 4px;border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}',
    '.dsh-mf-actions{display:flex;align-items:center;gap:8px}',
    // footer 三把按钮共用官方 .discard/.save 基座；危险键按官方语义为红字透明底（无实心红先例）
    '.dsh-mf-discard,.dsh-mf-save,.dsh-mf-force{appearance:none;border:1px solid transparent;border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}',
    '.dsh-mf-discard{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:none;color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mf-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary,#0f1115);border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mf-save{background:var(--dsw-alias-label-primary,#0f1115);color:var(--dsw-alias-bg-layer-3,#fff)}',
    '.dsh-mf-force{background:none;color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mf-force:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05))}',
    '.dsh-mf-discard:disabled,.dsh-mf-save:disabled,.dsh-mf-force:disabled{opacity:.4;cursor:default}',
    '.dsh-mf-discard:focus-visible,.dsh-mf-save:focus-visible,.dsh-mf-force:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#0f1115);outline-offset:1px}',
    // 危险确认键：官方 .deleteConfirm 写法（outline 按钮 + 红描边红字 + danger hover）
    '.dsh-mf-confirmDanger:not(:disabled){border-color:var(--dsw-alias-state-error-primary,#ec1313);color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mf-confirmDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05))}',
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
    tag.dataset.plugin = 'dsh-model-fix'
    tag.textContent = STYLE_TEXT
    document.head.appendChild(tag)
    stylesInjected = true
}

/** 截断失败信息：RPC 与异常消息可能极长（含 URL、响应片段），截断以保持状态行可读 */
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
            className="dsh-mf-switch"
            onClick={props.onChange}
        >
            <span className="dsh-mf-thumb" />
        </button>
    )
}

/**
 * 配置组瓦片（官方「插件列表」项卡同款）：summary 为组名 + 整组开关 + 折叠箭头，
 * 展开体为组释义 + 该组的子开关行（行键取 GROUP_KEYS，故新增组只是多一张同形瓦片）。
 * 整行可点由 `.dsh-mf-itemToggle` 覆盖层承担，开关在其上层独占点击区（故不存在 button 嵌套）；
 * 可访问名用 aria-labelledby 指向可见标题。文案与可访问名一律由 group + 词典键在此派生。
 */
function GroupTile(props: {
    group: Group
    t: CardProps['t']
    flags: Flags
    open: boolean
    disabled: boolean
    onToggle: () => void
    onMaster: () => void
    onCell: (key: RowKey) => void
}) {
    const { group, t, open } = props
    const id = `dsh-mf-item-${group}`
    const title = t(COLUMN_KEYS[group])
    return (
        <div className="dsh-mf-item" role="group" data-open={open ? 'true' : undefined} aria-labelledby={`${id}-title`}>
            <div className="dsh-mf-itemHead">
                <button
                    type="button"
                    className="dsh-mf-itemToggle"
                    aria-expanded={open}
                    aria-controls={`${id}-body`}
                    aria-labelledby={`${id}-title`}
                    onClick={props.onToggle}
                />
                <strong className="dsh-mf-itemTitle" id={`${id}-title`}>{title}</strong>
                <span className="dsh-mf-itemTrailing">
                    <span className="dsh-mf-itemSwitch">
                        <Switch
                            checked={masterValue(props.flags, group)}
                            disabled={props.disabled}
                            aria={`${title} ${t('masterAll')}`}
                            onChange={props.onMaster}
                        />
                    </span>
                    <IconChevronDownOutline14 size={12} className="dsh-mf-itemChevron" />
                </span>
            </div>
            {open ? (
                <div className="dsh-mf-itemBody" id={`${id}-body`}>
                    <p className="dsh-mf-itemHint">{t(HINT_KEYS[group])}</p>
                    {GROUP_KEYS[group].map((key) => (
                        <div key={key} className="dsh-mf-itemRow">
                            <span>{t(ROW_KEYS[key])}</span>
                            <Switch
                                checked={groupValue(props.flags, group, key)}
                                disabled={props.disabled}
                                aria={`${t(ROW_KEYS[key])} ${title}`}
                                onChange={() => { props.onCell(key) }}
                            />
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

/**
 * 「排除提供方」瓦片：形状与 GroupTile 不同是必然的——排除项是动态集合而非布尔矩阵，
 * 既没有「整组开关」的合法语义，也不能塞进 RowKey。
 * summary 尾区为「N 命中」计数徽标（命中 = 该 id 存在于宿主 llm-pi-ai 的 user 层，即本插件确会跳过它；
 * **0 命中也常驻**——未命中同样是生效状态，绝不能画成错误色）。
 * 展开体自上而下：组释义、输入框、校验错误行、每行一项的标签列表（标签贴左、删除钮贴右成列）。
 * 只能手填：正确用法就是先写尚未创建的提供商 id、再新建该提供商，故不提供任何"仅可选现有项"的控件。
 */
function ExcludesTile(props: {
    t: CardProps['t']
    flags: Flags
    /** 命中的排除项（由卡片以宿主 user 层提供商 id 求交得出） */
    hits: ReadonlySet<string>
    open: boolean
    disabled: boolean
    onToggle: () => void
    onAdd: (id: string) => void
    onRemove: (id: string) => void
}) {
    const { t, open } = props
    const id = 'dsh-mf-item-excludes'
    const title = t('colExcludes')
    // 输入文本与校验反馈是纯 UI 暂态（不属于配置），故留在瓦片本地
    const [text, setText] = useState('')
    const [error, setError] = useState<CardKey | undefined>()
    const inputRef = useRef<HTMLInputElement>(null)
    const commit = () => {
        const value = text.trim()
        // 空输入静默忽略（与官方新增提供商时的按钮禁用同取向：无事发生即可，不必报错）
        if (value === '') {
            setError(undefined)
            return
        }
        if (!EXCLUDE_ID_PATTERN.test(value)) {
            setError('excludeInvalid')
            return
        }
        if (props.flags.excludes.includes(value)) {
            setError('excludeDuplicate')
            return
        }
        props.onAdd(value)
        setText('')
        setError(undefined)
        // 焦点留在输入框：连续录入多项时不必每次回点
        inputRef.current?.focus()
    }
    return (
        <div className="dsh-mf-item" role="group" data-open={open ? 'true' : undefined} aria-labelledby={`${id}-title`}>
            <div className="dsh-mf-itemHead">
                <button
                    type="button"
                    className="dsh-mf-itemToggle"
                    aria-expanded={open}
                    aria-controls={`${id}-body`}
                    aria-labelledby={`${id}-title`}
                    onClick={props.onToggle}
                />
                <strong className="dsh-mf-itemTitle" id={`${id}-title`}>{title}</strong>
                <span className="dsh-mf-itemTrailing">
                    {/* 官方 trailing 结构：[状态点][状态胶囊]，点在胶囊外；summary 的点纯装饰（徽标文字已带语义，读屏不重复播报） */}
                    {props.hits.size > 0 ? <span className="dsh-mf-tagDot" aria-hidden /> : null}
                    <span className="dsh-mf-count" data-hit={props.hits.size > 0 ? 'true' : undefined}>
                        {t('excludeHits', { count: props.hits.size })}
                    </span>
                    <IconChevronDownOutline14 size={12} className="dsh-mf-itemChevron" />
                </span>
            </div>
            {open ? (
                <div className="dsh-mf-itemBody" id={`${id}-body`}>
                    <p className="dsh-mf-itemHint">{t('hintExcludes')}</p>
                    <input
                        ref={inputRef}
                        type="text"
                        className="dsh-mf-input"
                        value={text}
                        placeholder={t('excludePlaceholder')}
                        aria-label={t('excludeAdd')}
                        aria-invalid={error !== undefined}
                        disabled={props.disabled}
                        onChange={(event) => {
                            setText(event.target.value)
                            setError(undefined)
                        }}
                        onKeyDown={(event) => {
                            // 中文输入法候选词上屏的 Enter 不得误提交（该场景下这是主要输入路径）
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                event.preventDefault()
                                commit()
                            }
                        }}
                    />
                    {error !== undefined ? <p className="dsh-mf-fieldError" role="alert">{t(error)}</p> : null}
                    {props.flags.excludes.map((excluded) => {
                        const hit = props.hits.has(excluded)
                        const stateText = t(hit ? 'excludeHit' : 'excludeUnmatched')
                        return (
                            <div key={excluded} className="dsh-mf-tagRow">
                                {/* 官方结构：trailing 是 [状态点][状态胶囊] 两个兄弟节点，点在胶囊外面不进底色 */}
                                {hit ? <span className="dsh-mf-tagDot" role="img" aria-label={stateText} title={stateText} /> : null}
                                <span className="dsh-mf-tag" data-hit={hit ? 'true' : undefined}>
                                    <span className="dsh-mf-tagText">{excluded}</span>
                                </span>
                                {/* 命中状态不能只靠颜色传达：圆点带读屏名，行内再留一份状态文案 */}
                                <span className="dsh-mf-hidden">{stateText}</span>
                                <button
                                    type="button"
                                    className="dsh-mf-remove"
                                    aria-label={t('excludeRemove', { id: excluded })}
                                    disabled={props.disabled}
                                    onClick={() => { props.onRemove(excluded) }}
                                >
                                    <IconTrash />
                                </button>
                            </div>
                        )
                    })}
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
    // 提供商 id 来源 scope：只消费其 user 层（宿主 describe mirror 保证快照引用稳定，memo 只在文档变更时重算）
    const providersScope = props.providersScope
    const providersSnap = useSyncExternalStore(
        (listener) => providersScope.subscribe(listener),
        () => providersScope.getSnapshot(),
    )
    const providerIds = useMemo(
        () => providerIdsOf(providersSnap.status === 'ready' ? providersSnap.user : undefined),
        [providersSnap],
    )
    // draft === null 表示未编辑、跟随已存值；首次点击即冻结当前显示值为草稿
    const [draft, setDraft] = useState<Flags | null>(null)
    const [submitting, setSubmitting] = useState(false)
    // 折叠态为卡片本地状态（读姿而非配置），默认收起，与官方插件卡一致；草稿跨折叠存活
    const [open, setOpen] = useState(false)
    // 四个配置组瓦片的折叠态：沿用官方「插件列表」的手风琴语义（同时只开一个、默认全收起，
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
    // 命中集合按草稿算（编辑中即所见即所得），未命中项同样生效，只是当前无同名提供商
    const hits = useMemo(() => resolveHits(shown.excludes, providerIds), [shown.excludes, providerIds])

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
            <div className="dsh-mf-card">
                <div className="dsh-mf-header dsh-mf-headerStatic">
                    <span className="dsh-mf-headText">
                        <span className="dsh-mf-name">{t('title')}</span>
                        <span className="dsh-mf-desc">{t('unavailable')}</span>
                    </span>
                </div>
            </div>
        )
    }

    const onCell = (group: Group, key: RowKey) => {
        setNotice(null)
        setDraft(toggleCell(shown, group, key))
    }
    // 整组总控：组内任一为开则显示开；点击取反并把该组全部行设为同一值（总开关无对应存储，只是批量操作）
    const onMaster = (group: Group) => {
        setNotice(null)
        setDraft(applyGroup(shown, group, !masterValue(shown, group)))
    }
    // 瓦片折叠：官方 toggleRow 同语义——点已开者即收起，否则切到该瓦片
    const onTileToggle = (key: string) => {
        setTileOpen((prev) => (prev === key ? null : key))
    }
    // 豁免列表的增删同样只改草稿（保存才落盘），与单格/总控一条路径
    const onAddExclude = (id: string) => {
        setNotice(null)
        setDraft(addExclude(shown, id))
    }
    const onRemoveExclude = (id: string) => {
        setNotice(null)
        setDraft(removeExclude(shown, id))
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
    // 放弃修改：草稿归 null 即回到「跟随已存值」形态，dirty 随之消失（不发任何写）
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
        <div className={open ? 'dsh-mf-card dsh-mf-cardOpen' : 'dsh-mf-card'}>
            <button
                type="button"
                className="dsh-mf-header"
                aria-expanded={open}
                aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
                onClick={() => { setOpen(!open) }}
            >
                <span className="dsh-mf-headText">
                    <span className="dsh-mf-name">{t('title')}</span>
                    <span className="dsh-mf-desc">{t('description')}</span>
                </span>
                {/* 胶囊挂在 header：收起态也要说明卡里存着未落盘的编辑 */}
                {dirty ? <span className="dsh-mf-pending">{t('unsaved')}</span> : null}
                <IconChevronDownOutline14 className={open ? 'dsh-mf-chevron dsh-mf-chevronOpen' : 'dsh-mf-chevron'} />
            </button>
            {/* 结果提示挂在条件体之外：折叠不会吞掉在途/已到的结果 */}
            {notice !== null ? (
                <p
                    className={notice.tone === 'error' ? 'dsh-mf-notice dsh-mf-noticeError' : 'dsh-mf-notice dsh-mf-noticeSuccess'}
                    role={notice.tone === 'error' ? 'alert' : 'status'}
                    aria-live={notice.tone === 'error' ? undefined : 'polite'}
                >
                    {notice.text}
                </p>
            ) : null}
            {open ? (
                <div className="dsh-mf-body">
                    {!ready ? <p className="dsh-mf-line" role="status">{t('loading')}</p> : null}
                    {ready && !snap.writable ? <p className="dsh-mf-line dsh-mf-warn" role="status">{t('readOnly')}</p> : null}
                    {/* 三个布尔配置组只差 group：由组枚举与键表派生渲染，保证各瓦片形态始终一致；
                        第四张是动态集合瓦片，形状不同故单独渲染（栅格仍为两列，四张正好补齐 2×2） */}
                    <div className="dsh-mf-items">
                        {GROUPS.map((group) => (
                            <GroupTile
                                key={group}
                                group={group}
                                t={t}
                                flags={shown}
                                open={tileOpen === group}
                                disabled={!canWrite}
                                onToggle={() => { onTileToggle(group) }}
                                onMaster={() => { onMaster(group) }}
                                onCell={(key) => { onCell(group, key) }}
                            />
                        ))}
                        <ExcludesTile
                            t={t}
                            flags={shown}
                            hits={hits}
                            open={tileOpen === 'excludes'}
                            disabled={!canWrite}
                            onToggle={() => { onTileToggle('excludes') }}
                            onAdd={onAddExclude}
                            onRemove={onRemoveExclude}
                        />
                    </div>
                    <div className="dsh-mf-footer">
                        <button
                            type="button"
                            className="dsh-mf-force"
                            disabled={!ready || forceBusy || submitting}
                            onClick={onForce}
                        >
                            {forceBusy ? t('forceBusy') : t('force')}
                        </button>
                        <span className="dsh-mf-actions">
                            <button
                                type="button"
                                className="dsh-mf-discard"
                                disabled={!dirty || submitting}
                                onClick={onDiscard}
                            >
                                {t('discard')}
                            </button>
                            <button
                                type="button"
                                className="dsh-mf-save"
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
                    <Button variant="outline" className="dsh-mf-confirmDanger" onClick={runForce}>{t('forceGo')}</Button>
                </>}
            />
        </div>
    )
}
