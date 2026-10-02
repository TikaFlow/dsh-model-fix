/**
 * 模型参数填充卡片（浏览器半）：1:1 复刻官方 Web-UI 插件卡的可折叠卡片。四个挂载席位（模型页 footer /
 * 插件配置页 li / 插件详情页 / 内置插件选项卡）共用本外壳，差异只有根元素（`as`）与折叠态策略
 * （`defaultOpen`：详情页与内置插件选项卡默认展开且保存后不自动收起，另两席默认收起、保存后自动收起）；
 * 详情页仍自绘自己的图标 / 面包屑 / 开关，卡片头部只管本卡。
 * 展开体为五张瓦片（顺序由 TILE_ORDER 单一分发）：布尔矩阵瓦片（自动填充 / 允许更新 / 兼容性 /
 * 用户体验）+ 动态集合瓦片（排除提供方，
 * summary 尾区为「N 命中」徽标，0 命中也常驻、不得画成错误色）。瓦片手风琴：默认收起、同时只开一个。
 * footer 左侧强制更新 / 重置推理级别（危险键）/ 恢复备份（次级键）、右侧放弃修改（仅未保存时渲染）/
 * 保存；三把写回键弹
 * 宿主 Modal 二次确认后经 Connection RPC 请求 Node 半。
 * 编辑只改本地草稿，「保存」才经 settingsScope 原子写当前版本快照键（efforts 取写入当刻实时值，
 * 卡片不拥有该字段）；草稿跨折叠存活（header 挂「未保存」胶囊），写失败保持展开可重试。
 * 结果反馈一律走卡片内联状态行（挂在条件展开体之外，折叠不丢在途结果）；不用宿主 Toast（官方设置面零调用）。
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
// primitives 由宿主模块表注入；chevron 图标随宿主代际改名（见 CHEVRON_DOWN）
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { RpcResult } from '@/shared/types'
import { PLUGIN_NAME } from '@/shared/constants'
import { DEFAULT_CONFIG as DEFAULT_FLAGS, toStored } from '@/shared/parse'

/** 瓦片 chevron：宿主 0.1.7 起该组件改名（旧名 IconChevronDownOutline14 已删除），按当前宿主实有符号取用（props 两代同形）。 */
type ChevronIcon = (props: { size?: number; className?: string }) => ReactElement
const CHEVRON_DOWN: ChevronIcon =
    primitives.IconChevronDownOutline14
    ?? (primitives as typeof primitives & { IconChevronDownOutlineRegular?: ChevronIcon }).IconChevronDownOutlineRegular
const { Button, Modal } = primitives

/** 排除项删除钮：复刻官方 models 页自绘线稿 IconTrash（primitives 只有实心桶 IconTrashOutline16，观感更重且线稿版不导出）。 */
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
    EXCLUDE_ID_PATTERN,
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
    toggleCell,
} from '@/client/model'
import type { CardKey } from '@/client/locales'
import type { Flags, Group, RowKey } from '@/client/model'
import { COLUMN_KEYS, HINT_KEYS, ROW_KEYS } from '@/client/locales'

/** 瓦片渲染顺序：自动填充 / 允许更新 / 兼容性 / 排除提供方 / 用户体验（排除提供方之后紧接用户体验） */
const TILE_ORDER: readonly (Group | 'excludes')[] = ['autoFill', 'allowUpdate', 'compat', 'excludes', 'userExperience']

/** 卡片组件 props（t 由 slots.register 的 locale 席位合成注入；scope/forceUpdate 由入口闭包传入） */
export interface CardProps {
    t: TranslateNS<'settings.modelFix'>
    scope: SettingsScope<Flags>
    /** 宿主 llm-pi-ai 命名空间：只取 snapshot.user 的提供方 id，判定排除项是否命中 */
    providersScope: SettingsScope<readonly unknown[]>
    /** 强制更新 RPC：channel 与端点在入口拼好，卡片只消费结果 */
    forceUpdate: () => Promise<RpcResult<unknown>>
    /** 重置推理级别 RPC：仅剔除模型上的 reasoningEfforts（最大上下文 / 输出上限 / 图片模态可在模型页自行设置，不清除；excludes 命中跳过），配置段原样保留；返回受影响的模型数 */
    resetModels: () => Promise<RpcResult<unknown>>
    /** 恢复备份 RPC：回退启动时备份（交集 provider+model）到当前配置；返回被恢复的模型数 */
    restoreModels: () => Promise<RpcResult<unknown>>
    /** 根元素：插件配置席位把卡片渲在 `<ul>` 内须为 li（官方 PluginCard 同形；列表样式由 .dsh-mf-card 自清） */
    as?: 'div' | 'li'
    /** 初始折叠态：插件详情页（plugins.bundle.config）与「内置插件」选项卡（settings.plugins.tab）默认展开；另两席位不传即默认收起（与官方插件卡一致）。同时决定保存成功后是否自动收起——只在默认收起的席位上生效 */
    defaultOpen?: boolean
}

/** 内联状态行：文本 + 色调（成功＝官方 .savedNotice 绿，失败＝.failed/.error 红） */
interface Notice {
    text: string
    tone: 'success' | 'error'
}

const STYLE_ID = 'dsh-model-fix-card-css'

/**
 * 内嵌样式表（类名 dsh-mf- 前缀防撞）。取值逐条照官方同类组件：外层卡＝ui-settings-plugins 的
 * PluginCard；内层瓦片＝ui-settings-plugin-inventory 的插件列表项卡（本卡是可展开的设置卡，
 * 与不可展开的 provider 行 .rowCard 非同类，不作基准）。颜色一律只用 --dsw-alias-* 令牌，
 * 字面量仅作令牌缺失时的浅色守卫（取宿主主题 design-platform.css 真值）；官方源码引用但主题
 * 未定义的令牌（label-error、bg-layer-4）禁止照抄。
 */
const STYLE_TEXT = [
    // 外壳逐字照官方插件卡 .card；不写 max-width（宽度由所在 section 约束，官方同样不写）
    '.dsh-mf-card{list-style:none;border:0.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.16));border-radius:16px;background:var(--dsw-alias-bg-layer-3,#fff);transition:border-color .16s, background .16s}',
    '.dsh-mf-card:hover{border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mf-cardOpen{border-color:var(--dsw-alias-label-dimmed,#e1e5ee);background:var(--dsw-alias-bg-layer-2,#fff)}',
    // header：名称叠描述，右侧未保存胶囊与旋转 chevron
    '.dsh-mf-header{display:flex;align-items:center;gap:12px;box-sizing:border-box;width:100%;padding:14px 16px;border:1px solid transparent;border-radius:12px;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}',
    // 配置服务不可用时的静态头（div 渲染，无展开语义）
    '.dsh-mf-headerStatic{cursor:default}',
    '.dsh-mf-headText{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}',
    '.dsh-mf-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mf-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-chevron{flex:none;color:var(--dsw-alias-label-tertiary,#81858c);transition:transform .16s}',
    '.dsh-mf-chevronOpen{transform:rotate(180deg)}',
    '.dsh-mf-pending{flex:none;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-module-platform,#f5f6f7);color:var(--dsw-alias-label-secondary,#61666b)}',
    // 展开体：左右内缩与 header 对齐；顶部 0.5px 分隔线隔开摘要与正文，12px 上边距撑开与瓦片的距离
    '.dsh-mf-body{margin:0 16px;padding:12px 0 8px;border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));display:flex;flex-direction:column;gap:12px}',
    // 状态行：内联承载一切结果反馈（官方设置面无 Toast）
    '.dsh-mf-notice{margin:0;padding:0 16px 12px;font-size:12px;line-height:18px}',
    '.dsh-mf-noticeSuccess{color:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mf-noticeError{color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mf-line{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-warn{color:var(--dsw-alias-state-warn-label,#dd8629)}',
    // 配置组瓦片：栅格、项卡外壳、描边/阴影、行与展开体逐条照官方「插件列表」项卡（ui-settings-plugin-inventory）。
    // 描边用官方 elevation 令牌链（0.5px 发丝画在 box-shadow 里），字面兜底复刻其计算结果——有令牌即同源换色，无令牌同观感
    '.dsh-mf-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px}',
    '.dsh-mf-item{min-width:0;overflow:hidden;border:0;border-radius:14px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:var(--dsw-elevation-stroke,0 0 0 0.5px var(--dsw-alias-border-l4,rgba(0,0,0,.16)))}',
    // 展开态（官方 data-open 驱动）：描边换最浅的 l1 并叠两层柔光，summary 行保留淡底
    '.dsh-mf-item[data-open="true"]{--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,rgba(0,0,0,.04));box-shadow:var(--dsw-elevation-panel,0 0 0 0.5px var(--dsw-alias-border-l1,rgba(0,0,0,.04)),0 3px 8px 0 rgba(0,0,0,.03),0 0 16px 0 rgba(0,0,0,.02))}',
    '.dsh-mf-item[data-open="true"]>.dsh-mf-itemHead{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
    '.dsh-mf-itemHead{box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:52px;padding:12px 14px;color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mf-itemHead:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
    // 整行折叠按钮：透明覆盖层承担点击与键盘；尾区抬 z-index 关掉 pointer-events、只放开开关本体（无 button 嵌套）
    '.dsh-mf-itemToggle{position:absolute;inset:0;padding:0;border:none;border-radius:14px;background:none;cursor:pointer}',
    '.dsh-mf-itemTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:600}',
    '.dsh-mf-itemTrailing{position:relative;z-index:1;display:inline-flex;flex:none;align-items:center;gap:7px;pointer-events:none;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-itemSwitch{pointer-events:auto}',
    '.dsh-mf-itemChevron{flex:none;transition:transform 140ms var(--ds-ease-in-out,ease)}',
    '.dsh-mf-item[data-open="true"] .dsh-mf-itemChevron{transform:rotate(180deg)}',
    // 展开体填充官方 .cardDetails 的模块底色（与同页 .editor/.setupCard 同令牌），使展开内容读成内层面板
    '.dsh-mf-itemBody{border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));padding:10px 14px 12px;display:grid;gap:6px;background:var(--dsw-alias-bg-module-platform,#f5f6f7)}',
    '.dsh-mf-itemHint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-itemRow{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#0f1115)}',
    // 「排除提供方」瓦片：状态胶囊与小绿点照官方「插件列表」项卡的 .configTag/.statusDot 体系
    // （命中=success 10% 底 + 同色文字无边框，未命中=bg-layer-1 + label-secondary；点 7×7、在胶囊外）；
    // 输入框照 ModelsSection 的 .input，删除钮照同页 .iconButton、字形照其自绘线稿 IconTrash
    '.dsh-mf-count{flex:none;border-radius:5px;padding:1px 6px;font-size:11px;line-height:16px;white-space:nowrap;min-height:20px;display:inline-flex;align-items:center;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mf-count[data-hit="true"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#22c55e) 10%, transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mf-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.16));border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:14px;line-height:22px}',
    '.dsh-mf-input:focus{border-color:var(--dsw-alias-brand-primary,#0f1115);outline:none}',
    '.dsh-mf-input::placeholder{color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mf-input:disabled{opacity:.6;cursor:default}',
    '.dsh-mf-fieldError{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ec1313)}',
    // 一行一项：状态点在胶囊外（官方 trailing 是 [PhaseDot][StateTag] 兄弟节点）；删除钮 margin-left:auto 贴右成列
    '.dsh-mf-tagRow{position:relative;display:flex;align-items:center;gap:7px;min-width:0}',
    '.dsh-mf-tag{min-width:0;display:inline-flex;align-items:center;gap:6px;border-radius:5px;padding:1px 6px;font-size:11px;line-height:16px;min-height:20px;white-space:nowrap;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mf-tag[data-hit="true"]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary,#22c55e) 10%, transparent);color:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mf-tagText{min-width:0;overflow:hidden;text-overflow:ellipsis}',
    // 命中的第二信号（不只靠颜色）：照官方 .statusDot 的 7px 圆点（data-phase=active 同款 success 色）
    '.dsh-mf-tagDot{flex:none;width:7px;height:7px;display:inline-block;border-radius:999px;corner-shape:round;background:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mf-remove{box-sizing:border-box;flex:none;width:28px;height:28px;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:6px;background:0 0;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}',
    '.dsh-mf-remove:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mf-remove:disabled{cursor:default;opacity:.4}',
    // 只给读屏器的状态文案：照同页 .hiddenLabel 的裁剪手法
    '.dsh-mf-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media (max-width:680px){.dsh-mf-items{grid-template-columns:minmax(0,1fr)}}',
    '@media (prefers-reduced-motion:reduce){.dsh-mf-itemChevron{transition:none}}',
    // 开关：逐字复刻 primitives 的 Switch.module.css（官方设置面无 on/off 开关，该 CSS 是规格唯一
    // 权威；组件本体 0.2.0 线起才导出、peer 下限无此符号，故不自用；轨道无过渡）
    // 滑块分态取色：关闭态读专用令牌 switch-thumb（深色下 neutral-bluish-400 中灰——关闭态轨道是
    // 中性灰 border-l3，需要比轨道更亮的滑块，纯白在暗色下过亮故不用反色令牌）；开启态仍读
    // label-primary-foreground（开启态轨道是 brand-primary，滑块必须与轨道反色相抗——全局换成
    // switch-thumb 会让深色下「近白轨道 + 中灰滑块」对比反被拉低）。fallback 逐层退回，新令牌
    // 不存在的旧宿主保持原取值。
    '.dsh-mf-switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:10px;background:var(--dsw-alias-border-l3,rgba(0,0,0,.12));cursor:pointer}',
    '.dsh-mf-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#0f1115)}',
    '.dsh-mf-switch:disabled{cursor:default;opacity:.5}',
    '.dsh-mf-thumb{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground,#fff);transition:transform 120ms ease}',
    '.dsh-mf-switch[aria-checked="false"] .dsh-mf-thumb{background:var(--dsw-alias-switch-thumb,var(--dsw-alias-label-primary-foreground,#fff))}',
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
    tag.dataset.plugin = PLUGIN_NAME
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

/** 配置组瓦片（官方「插件列表」项卡同款）：summary 为组名 + 整组开关 + 折叠箭头，展开体为组释义 + 子开关行；
 * 整行可点由 .dsh-mf-itemToggle 覆盖层承担（无 button 嵌套），可访问名用 aria-labelledby 指向可见标题。 */
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
                    <CHEVRON_DOWN size={12} className="dsh-mf-itemChevron" />
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

/** 「排除提供方」瓦片：动态集合而非布尔矩阵（无整组开关语义）；summary 尾区为「N 命中」徽标，
 * 命中 = 该 id 存在于宿主 llm-pi-ai 的 user 层（0 命中也常驻、不得画成错误色）。
 * 只能手填——正用场景就是先写尚未创建的提供方 id 再新建该提供方，故不做"仅可选现有项"控件。 */
function ExcludesTile(props: {
    t: CardProps['t']
    flags: Flags
    /** 命中的排除项（由卡片以宿主 user 层提供方 id 求交得出） */
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
        // 空输入静默忽略（与官方新增提供方时的按钮禁用同取向：无事发生即可，不必报错）
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
                    <CHEVRON_DOWN size={12} className="dsh-mf-itemChevron" />
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
    // 根元素由席位决定：模型页 footer 是普通块，插件配置页在 <ul> 内须为 li（官方 PluginCard 同形）
    const Root = props.as ?? 'div'
    // scope 的方法是类实例方法，须经箭头函数保 this 绑定后交给 uSES
    const snap = useSyncExternalStore(
        (listener) => scope.subscribe(listener),
        () => scope.getSnapshot(),
    )
    // 提供方 id 来源 scope：只消费其 user 层（宿主 describe mirror 保证快照引用稳定，memo 只在文档变更时重算）
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
    // 折叠态为卡片本地状态（读姿而非配置）：初始值取 defaultOpen（缺省收起、与官方插件卡一致）；草稿跨折叠存活
    const [open, setOpen] = useState(props.defaultOpen ?? false)
    // 保存后自动收起只对默认收起的席位有意义：默认展开的两席（插件详情页 / 内置插件选项卡）
    // 保存后保持展开，否则用户刚配完就被收起、还得再点一次才看得见结果
    const autoCollapse = props.defaultOpen !== true
    // 瓦片折叠态：官方手风琴语义（同时只开一个、默认全收起；各瓦片展开高度不同，同开两列底部参差）
    const [tileOpen, setTileOpen] = useState<string | null>(null)
    // 内联结果提示：常驻至下一次操作（官方 .savedNotice 无定时器，故不设自动淡出）
    const [notice, setNotice] = useState<Notice | null>(null)
    // 三个后端写回操作的执行态；confirm 三态各控一个宿主 Modal 二次确认
    const [forceBusy, setForceBusy] = useState(false)
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [resetBusy, setResetBusy] = useState(false)
    const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
    const [restoreBusy, setRestoreBusy] = useState(false)
    const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
    // 「记住推理级别」关掉时的确认：是否清空已有记忆（前端直写，不走 RPC）
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
    const saveStarted = useRef(false)

    const saved = snap.value
    const shown = draft ?? saved ?? DEFAULT_FLAGS
    const ready = snap.status === 'ready' && saved !== undefined
    const canWrite = ready && snap.writable === true
    const dirty = draft !== null && saved !== undefined && isDirty(draft, saved)
    // 命中集合按草稿算（编辑中即所见即所得），未命中项同样生效，只是当前无同名提供方
    const hits = useMemo(() => resolveHits(shown.excludes, providerIds), [shown.excludes, providerIds])

    // 保存成功（submitting 结束且 dirty 归 false）后自动收起，仅限默认收起的席位；
    // 写失败保留草稿与展开态可重试
    useEffect(() => {
        if (submitting) {
            saveStarted.current = true
            return
        }
        if (!saveStarted.current) return
        saveStarted.current = false
        if (!dirty && autoCollapse) setOpen(false)
    }, [submitting, dirty, autoCollapse])

    // 配置服务不可用：保留静态外壳（无展开语义）便于发现与排查
    if (snap.status === 'unavailable') {
        return (
            <Root className="dsh-mf-card">
                <div className="dsh-mf-header dsh-mf-headerStatic">
                    <span className="dsh-mf-headText">
                        <span className="dsh-mf-name">{t('title')}</span>
                        <span className="dsh-mf-desc">{t('unavailable')}</span>
                    </span>
                </div>
            </Root>
        )
    }

    // 落草稿；「记住推理级别」由开转关且仍有记忆时立即弹确认。记忆判据取实时值（草稿不拥有 efforts）
    const commitDraft = (next: Flags) => {
        setDraft(next)
        if (
            groupValue(shown, 'userExperience', 'rememberEfforts') &&
            !groupValue(next, 'userExperience', 'rememberEfforts') &&
            Object.keys(snap.value?.efforts ?? {}).length > 0
        ) {
            setClearConfirmOpen(true)
        }
    }
    const onCell = (group: Group, key: RowKey) => {
        setNotice(null)
        commitDraft(toggleCell(shown, group, key))
    }
    // 整组总控：组内任一为开则显示开；点击取反并把该组全部行设为同一值（总开关无对应存储，只是批量操作）
    const onMaster = (group: Group) => {
        setNotice(null)
        commitDraft(applyGroup(shown, group, !masterValue(shown, group)))
    }
    // 瓦片折叠：官方 toggleRow 同语义——点已开者即收起，否则切到该瓦片
    const onTileToggle = (key: string) => {
        setTileOpen((prev) => (prev === key ? null : key))
    }
    // 排除列表的增删同样只改草稿（保存才落盘），与单格/总控一条路径
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
        // 写入成功由宿主回推新 value（dirty 自动归 false，触发自动收起）；失败由 scope 重读恢复，保持 dirty 可重试。
        // efforts 取写入当刻的实时值：卡片不拥有该字段，用草稿副本会把「开卡后切过模型」的记忆覆盖回去
        const liveEfforts = scope.getSnapshot().value?.efforts
        void scope.set(VERSION_KEY, toStored({ ...shown, efforts: liveEfforts ?? shown.efforts }))
            .then(() => {
                // 官方 card-form 范式：写后读回核对，未落地不算成功（保持「未保存」态，不误报）
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
    // 危险操作先弹 Modal 二次确认；不依赖 canWrite/dirty（不改配置，只按目录覆盖写回模型字段）
    const onForce = () => {
        if (!ready || forceBusy || resetBusy || restoreBusy || submitting) return
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
    // 重置推理级别：与强制更新同形（危险键 + 二次确认）；配置段零写入（开关不变），竞态防护由 Node 半事件流守卫负责
    const onReset = () => {
        if (!ready || resetBusy || restoreBusy || submitting) return
        setNotice(null)
        setResetConfirmOpen(true)
    }
    const runReset = () => {
        setResetConfirmOpen(false)
        setResetBusy(true)
        props.resetModels()
            .then((result) => {
                if (result.ok) {
                    const changed = (result.value as { changed?: number } | undefined)?.changed ?? 0
                    setNotice({ text: t('resetDone', { count: changed }), tone: 'success' })
                } else {
                    setNotice({ text: t('resetFailed', { message: truncateMessage(result.error.message) }), tone: 'error' })
                }
            })
            .catch((error: unknown) => {
                setNotice({
                    text: t('resetFailed', { message: truncateMessage(error instanceof Error ? error.message : String(error)) }),
                    tone: 'error',
                })
            })
            .finally(() => {
                setResetBusy(false)
            })
    }
    // 恢复备份：与重置同形（次级样式 + 二次确认），仅回退「备份与当前都存在」的 provider+model
    const onRestore = () => {
        if (!ready || restoreBusy || resetBusy || submitting) return
        setNotice(null)
        setRestoreConfirmOpen(true)
    }
    const runRestore = () => {
        setRestoreConfirmOpen(false)
        setRestoreBusy(true)
        props.restoreModels()
            .then((result) => {
                if (result.ok) {
                    const changed = (result.value as { changed?: number } | undefined)?.changed ?? 0
                    setNotice({ text: t('restoreDone', { count: changed }), tone: 'success' })
                } else {
                    setNotice({ text: t('restoreFailed', { message: truncateMessage(result.error.message) }), tone: 'error' })
                }
            })
            .catch((error: unknown) => {
                setNotice({
                    text: t('restoreFailed', { message: truncateMessage(error instanceof Error ? error.message : String(error)) }),
                    tone: 'error',
                })
            })
            .finally(() => {
                setRestoreBusy(false)
            })
    }
    // 清空记忆：前端经自有 NS 的 settings scope 直写（与「保存」同一条写通道，立即生效、草稿不动）；
    // 失败要显式提示——否则开关已关而记忆未清，无从察觉
    const clearEfforts = () => {
        setClearConfirmOpen(false)
        void scope.mutate([{ op: 'set', path: [VERSION_KEY, 'efforts'], value: {} }])
            .then(() => { setNotice({ text: t('clearEffortsDone'), tone: 'success' }) })
            .catch(() => { setNotice({ text: t('clearEffortsFailed'), tone: 'error' }) })
    }

    // 结果提示挂在条件体之外：折叠不会吞掉在途/已到的结果
    const notices = notice !== null ? (
        <p
            className={notice.tone === 'error' ? 'dsh-mf-notice dsh-mf-noticeError' : 'dsh-mf-notice dsh-mf-noticeSuccess'}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            aria-live={notice.tone === 'error' ? undefined : 'polite'}
        >
            {notice.text}
        </p>
    ) : null
    // 正文（状态行 + 瓦片栅格 + footer）：卡片展开体与插件页正文共用，只换容器
    const body = (
        <>
            {!ready ? <p className="dsh-mf-line" role="status">{t('loading')}</p> : null}
            {ready && !snap.writable ? <p className="dsh-mf-line dsh-mf-warn" role="status">{t('readOnly')}</p> : null}
            {/* 四个布尔组由组枚举与键表派生，「排除提供方」形状不同单独分发；顺序见 TILE_ORDER */}
            <div className="dsh-mf-items">
                {TILE_ORDER.map((tile) => tile === 'excludes' ? (
                    <ExcludesTile
                        key={tile}
                        t={t}
                        flags={shown}
                        hits={hits}
                        open={tileOpen === tile}
                        disabled={!canWrite}
                        onToggle={() => { onTileToggle(tile) }}
                        onAdd={onAddExclude}
                        onRemove={onRemoveExclude}
                    />
                ) : (
                    <GroupTile
                        key={tile}
                        group={tile}
                        t={t}
                        flags={shown}
                        open={tileOpen === tile}
                        disabled={!canWrite}
                        onToggle={() => { onTileToggle(tile) }}
                        onMaster={() => { onMaster(tile) }}
                        onCell={(key) => { onCell(tile, key) }}
                    />
                ))}
            </div>
            <div className="dsh-mf-footer">
                <span className="dsh-mf-actions">
                    <button
                        type="button"
                        className="dsh-mf-force"
                        disabled={!ready || forceBusy || resetBusy || restoreBusy || submitting}
                        onClick={onForce}
                    >
                        {forceBusy ? t('forceBusy') : t('force')}
                    </button>
                    <button
                        type="button"
                        className="dsh-mf-force"
                        disabled={!ready || forceBusy || resetBusy || restoreBusy || submitting}
                        onClick={onReset}
                    >
                        {resetBusy ? t('resetBusy') : t('reset')}
                    </button>
                    <button
                        type="button"
                        className="dsh-mf-discard"
                        disabled={!ready || forceBusy || resetBusy || restoreBusy || submitting}
                        onClick={onRestore}
                    >
                        {restoreBusy ? t('restoreBusy') : t('restore')}
                    </button>
                </span>
                <span className="dsh-mf-actions">
                    {/* 放弃修改只在有未保存编辑时出现（保存后自动隐去）；保存中保持可见但禁用 */}
                    {dirty ? (
                        <button
                            type="button"
                            className="dsh-mf-discard"
                            disabled={submitting}
                            onClick={onDiscard}
                        >
                            {t('discard')}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="dsh-mf-save"
                        disabled={!canWrite || !dirty || submitting || forceBusy || resetBusy || restoreBusy}
                        onClick={onSave}
                    >
                        {submitting ? t('saving') : t('save')}
                    </button>
                </span>
            </div>
        </>
    )
    // 二次确认弹层：宿主 Modal + Button 原语（官方同页删除 provider 同款）；取消键 autoFocus——焦点落在可安全退出的一侧
    const confirms = (
        <>
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
            <Modal
                open={resetConfirmOpen}
                onClose={() => { setResetConfirmOpen(false) }}
                title={t('reset')}
                closeLabel={t('close')}
                description={t('resetConfirm')}
                footer={<>
                    <Button variant="outline" autoFocus onClick={() => { setResetConfirmOpen(false) }}>{t('forceCancel')}</Button>
                    <Button variant="outline" className="dsh-mf-confirmDanger" onClick={runReset}>{t('resetGo')}</Button>
                </>}
            />
            {/* 恢复确认键不上红 tint：操作不删用户任何东西，红色与语义不符 */}
            <Modal
                open={restoreConfirmOpen}
                onClose={() => { setRestoreConfirmOpen(false) }}
                title={t('restore')}
                closeLabel={t('close')}
                description={t('restoreConfirm')}
                footer={<>
                    <Button variant="outline" autoFocus onClick={() => { setRestoreConfirmOpen(false) }}>{t('forceCancel')}</Button>
                    <Button variant="outline" onClick={runRestore}>{t('restoreGo')}</Button>
                </>}
            />
            {/* 清空记忆确认：只问记忆去留（开关此时已转关）；确认键上红 tint——清空即删除类操作 */}
            <Modal
                open={clearConfirmOpen}
                onClose={() => { setClearConfirmOpen(false) }}
                title={t('clearEffortsTitle')}
                closeLabel={t('close')}
                description={t('clearEffortsConfirm')}
                footer={<>
                    <Button variant="outline" autoFocus onClick={() => { setClearConfirmOpen(false) }}>{t('clearEffortsKeep')}</Button>
                    <Button variant="outline" className="dsh-mf-confirmDanger" onClick={clearEfforts}>{t('clearEffortsGo')}</Button>
                </>}
            />
        </>
    )

    return (
        <Root className={open ? 'dsh-mf-card dsh-mf-cardOpen' : 'dsh-mf-card'}>
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
                <CHEVRON_DOWN className={open ? 'dsh-mf-chevron dsh-mf-chevronOpen' : 'dsh-mf-chevron'} />
            </button>
            {notices}
            {open ? <div className="dsh-mf-body">{body}</div> : null}
            {confirms}
        </Root>
    )
}
