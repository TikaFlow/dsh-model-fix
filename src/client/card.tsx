/**
 * 模型参数填充卡片（浏览器半）：复刻官方插件卡的可折叠卡片。四个挂载席位（模型页 footer / 插件详情页 /
 * 组件实例详情页 / 内置插件选项卡）共用同一外壳，差异只有折叠态策略（`defaultOpen`：三处详情席位默认展开
 * 且保存后不自动收起，footer 席默认收起、保存后自动收起）；详情页仍自绘自己的图标 / 面包屑 / 开关，
 * 卡片头部只管本卡。
 * 展开体为五张瓦片（顺序由 TILE_ORDER 单一分发）：四张布尔矩阵瓦片（自动填充 / 允许更新 / 兼容性 /
 * 用户体验）+ 一张动态集合瓦片（排除提供方，summary 尾区为「N 命中」徽标，0 命中也常驻、不得画成错误色）。
 * 瓦片手风琴：默认收起、同时只开一个。
 * 布尔瓦片的每一行标题带一个说明键：悬停或键盘聚焦时经宿主 Tooltip 气泡给出该设置项释义（组释义在首行、项释义在气泡）。
 * footer 左侧为强制更新 / 重置推理级别（危险键）/ 恢复备份（次级键）/ 验证模型（次级键）/ 探测式填充（次级键），右侧为取消（仅未保存时渲染）/ 保存；
 * 三把写回键与「清空记忆」均先弹宿主 Modal 二次确认，再经 Connection RPC 或 settings scope 请求 Node 半。
 * 「验证模型」则弹一个自带确认的候选框（逐条照官方 models 页「获取可用模型」的候选框，减去其搜索/全选工具条）：
 * 按提供方分组多选模型，配「验证推理级别」开关，对每个勾选模型声明的每个推理级别发起真实探测；
 * 结论只留在该弹层内（实时记录区的末行），不写卡片状态行——验证即用即弃，不留任何配置痕迹。
 * 「探测式填充」是它的写回版：没有候选框（范围由「探测所有 / 探测未填充」两键与「忽略排除」开关决定，
 * 模型列表取**点按钮那一刻**的最新值并当场冻结），正文依次是「实时记录区 → 探测范围一句 → 额度提示 → 两个开关」，
 * 两个范围的大小由那句提示交代（分别对应「探测所有 / 探测未填充」两键，键文本保持短）；
 * footer 只留 关闭 / 探测所有 / 探测未填充 三键（由宽到窄）；
 * 跑完把汇总与补全结果留在记录区并**延迟 PROBE_CLOSE_DELAY_MS 再关窗**，同一份结果另落卡片状态行。
 * 编辑只改本地草稿，「保存」才经 settings scope 原子写当前版本快照键（efforts 取写入当刻实时值，
 * 卡片不拥有该字段）；草稿跨折叠存活（header 挂「未保存」胶囊），写失败保持展开可重试。
 * 除验证外的操作结果一律走卡片内联状态行（挂在条件展开体之外，折叠不丢在途结果）。
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
// primitives 由宿主模块表注入
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { TerminalBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
// scope 类型来自本项目的 ConfigForm decode 包装层
import type { DecodedScope } from '@/client/scope'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import {
    EXCLUDE_ID_PATTERN,
    GROUP_KEYS,
    VERSION_KEY,
    addExclude,
    applyGroup,
    groupAllPicked,
    groupValue,
    isDirty,
    masterValue,
    providerIdsOf,
    probeCandidatesOf,
    probeTargetsOf,
    removeExclude,
    resolveHits,
    toggleCell,
    toggleGroupPicks,
    verifyCandidatesOf,
    verifyKey,
    verifyTargets,
} from '@/client/model'
import type { Flags, Group, RowKey, VerifyCandidate, VerifyTarget } from '@/client/model'
import type { CardKey } from '@/client/locales'
import { COLUMN_KEYS, HINT_KEYS, ROW_KEYS, TIP_KEYS } from '@/client/locales'
import { PLUGIN_NAME } from '@/shared/constants'
import { isProviderBlocking } from '@/shared/verify-progress'
import type { UnsupportedEffort, ProbeOutcome, VerifyProbedFrame, VerifyProgressUpdate, VerifySummary } from '@/shared/verify-progress'
import { DEFAULT_CONFIG as DEFAULT_FLAGS, toStored } from '@/shared/parse'

/** 瓦片 chevron：宿主 ui-primitives 导出的描边 chevron 图标 */
const CHEVRON_DOWN = primitives.IconChevronDownOutlineRegular
const { Button, Modal, Switch, Tag, StateDot, TerminalBlock, Tooltip, IconInfoOutlineRegular, IconTrashOutlineRegular } = primitives

/** 说明气泡宽度上限（px）：宿主 Tooltip 默认半视口，气泡会盖满整行开关区，故按瓦片列宽收窄 */
const TIP_MAX_WIDTH = 300

/** 验证记录区的行数上限 */
const VERIFY_TERMINAL_LINES = 8
/**
 * 探测跑完到关窗之间的展示延时（毫秒）：补全写回很快，不留时间用户就读不到刚跑出来的结论。
 * 取 2.5s 是一句结论读完的量级，不做成可配置项——它服务的是「别让结论一闪而过」，
 * 停留更久用户自己会关，更短则来不及读。
 */
const PROBE_CLOSE_DELAY_MS = 2_500

/** 宿主 TerminalBlock 的展示文案：该包无语言回退，字段缺一即类型报错，故整份照官方 terminalLabels(t) 提供 */
function terminalLabelsOf(t: TranslateNS<'settings.modelFix'>): TerminalBlockLabels {
    return {
        signal: (signal) => t('terminalSignal', { signal }),
        exitCode: (code) => t('terminalExitCode', { code: String(code) }),
        noExitCode: t('terminalNoExitCode'),
        running: t('terminalRunning'),
        failed: t('terminalFailed'),
        done: t('terminalDone'),
        copy: t('terminalCopy'),
        copied: t('terminalCopied'),
        noOutput: t('terminalNoOutput'),
        collapseAria: t('terminalCollapseAria'),
        collapse: t('terminalCollapse'),
        expandAria: (n) => t('terminalExpandAria', { n: String(n) }),
        expand: (n) => t('terminalExpand', { n: String(n) }),
    }
}

/** 每种探测结论对应的展示词；判别值与 `ProbeOutcome` 一一对应，漏一个即类型报错 */
const OUTCOME_KEYS: Record<ProbeOutcome, CardKey> = {
    usable: 'verifyOutUsable',
    'unsupported-effort': 'verifyOutUnsupported',
    unreachable: 'verifyOutUnreachable',
    quota: 'verifyOutQuota',
    credential: 'verifyOutCredential',
    'rate-limit': 'verifyOutRateLimit',
    timeout: 'verifyOutTimeout',
    other: 'verifyOutOther',
}

/**
 * 一条探测结论的记录行。
 *
 * provider 级失败（不可达 / 凭据无效）不带模型与档位——那不是某个模型的问题，是整组都不成立；
 * 带 `skipped` 时补一句「还剩几条没验」，免得用户把那一行当成全部结论。
 */
function verifyLineOf(frame: VerifyProbedFrame, t: TranslateNS<'settings.modelFix'>): string {
    const result = t(OUTCOME_KEYS[frame.outcome])
    const line = isProviderBlocking(frame.outcome)
        ? t('verifyLineProvider', { provider: frame.provider, result })
        : frame.effort === undefined
            ? t('verifyLinePlain', { provider: frame.provider, model: frame.model, result })
            : t('verifyLine', { provider: frame.provider, model: frame.model, effort: frame.effort, result })
    return frame.skipped === undefined ? line : `${line}${t('verifySkipped', { count: String(frame.skipped) })}`
}

/** 项目仓库与反馈入口：README「安装 / 问题反馈」同源，改地址只改这两行 */
const REPO_URL = 'https://github.com/TikaFlow/dsh-model-fix'
const ISSUES_URL = `${REPO_URL}/issues/new`
/** 行内展示的短地址（去掉协议前缀，不重复手写字面量） */
const REPO_LABEL = REPO_URL.replace(/^https?:\/\//, '')

/** 插件版本号：由 tsdown 构建期从 package.json 读入并 define 内联（浏览器半读不到磁盘，见 tsdown.config.ts） */
declare const __PLUGIN_VERSION__: string
const PLUGIN_VERSION = __PLUGIN_VERSION__

// ---------- 行内项目链接行的图标：Octicons（GitHub 官方图标集，MIT、可商用、纯 path 单色），统一 16×16 / viewBox 0 0 16 16 / `fill="currentColor"`（随 .dsh-mf-linkIcon 取宿主令牌色） ----------

/** 仓库图标：Octicons mark-github-16（https://primer.style/octicons/mark-github-16/） */
function IconGitHub() {
    return (
        <svg className="dsh-mf-linkIcon" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <path fill="currentColor" d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
        </svg>
    )
}

/** 版本标记图标：Octicons tag-16（https://primer.style/octicons/tag-16/） */
function IconTag() {
    return (
        <svg className="dsh-mf-linkIcon" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <path fill="currentColor" d="M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
        </svg>
    )
}

/** star 键图标：Octicons star-16（https://primer.style/octicons/star-16/） */
function IconStar() {
    return (
        <svg className="dsh-mf-linkIcon" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <path fill="currentColor" d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z" />
        </svg>
    )
}

/** 问题反馈键图标：Octicons issue-opened-16（https://primer.style/octicons/issue-opened-16/） */
function IconIssue() {
    return (
        <svg className="dsh-mf-linkIcon" viewBox="0 0 16 16" width="16" height="16" aria-hidden>
            <path fill="currentColor" d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
            <path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
        </svg>
    )
}

/** 瓦片渲染顺序：自动填充 / 允许更新 / 兼容性 / 排除提供方 / 用户体验 */
const TILE_ORDER: readonly (Group | 'excludes')[] = ['autoFill', 'allowUpdate', 'compat', 'excludes', 'userExperience']

/** 卡片组件 props（t 由 slots.register 的 locale 席位合成注入；scope/forceUpdate 由入口闭包传入） */
export interface CardProps {
    t: TranslateNS<'settings.modelFix'>
    scope: DecodedScope<Flags>
    /** 宿主 llm-pi-ai 命名空间：只取 snapshot.user 的提供方 id，判定排除项是否命中 */
    providersScope: DecodedScope<readonly unknown[]>
    /** 强制更新 RPC：channel 与端点在入口拼好，卡片只消费结果 */
    forceUpdate: () => Promise<ConnectionRpcResult<unknown>>
    /** 重置推理级别 RPC：仅剔除模型上的 reasoningEfforts（最大上下文 / 输出上限 / 图片模态可在模型页自行设置，不清除；excludes 命中跳过），配置段原样保留；返回受影响的模型数 */
    resetModels: () => Promise<ConnectionRpcResult<unknown>>
    /** 恢复备份 RPC：回退启动时备份（交集 provider+model）到当前配置；返回被恢复的模型数 */
    restoreModels: () => Promise<ConnectionRpcResult<unknown>>
    /** 验证模型：走进度流端点，对「模型 × 推理级别」各发一次最小请求（`needTest` 的模型另发一次不计数的探测作对照），逐条回调实时进度；整轮跑完回汇总，被中止（停止 / 关窗 / 断连）回 undefined */
    verifyModels: (
        models: readonly VerifyTarget[],
        onFrame: (frame: VerifyProgressUpdate) => void,
        signal: AbortSignal,
    ) => Promise<VerifySummary | undefined>
    /** 剔除不被支持的推理级别：入参是验证明细给出的「提供方 / 模型 / 档位」清单；返回实际剔掉的档位条数 */
    pruneEfforts: (targets: readonly UnsupportedEffort[]) => Promise<ConnectionRpcResult<unknown>>
    /**
     * 探测式填充：走进度流端点，Node 半先把候选档位临时预声明进配置、再对每个模型逐档各发一次最小请求，
     * 跑完按结论收敛写回（终帧的 `summary.fill` 带增删统计）。两个开关须与 Node 半的两次写回同值。
     * 被中止（停止 / 关窗 / 断连）回 undefined——中止不发终帧，且未跑完的模型一律还原成预声明之前的形态。
     */
    probeEfforts: (
        models: readonly VerifyTarget[],
        flags: { ignoreExcludes: boolean; dropUnsupported: boolean },
        onFrame: (frame: VerifyProgressUpdate) => void,
        signal: AbortSignal,
    ) => Promise<VerifySummary | undefined>
    /** 初始折叠态：插件详情页（plugins.bundle.config）、组件实例详情页（plugins.row.config）与「内置插件」选项卡（settings.plugins.tab）默认展开；模型页 footer 席不传即默认收起（与官方插件卡一致）。同时决定保存成功后是否自动收起——只在默认收起的席位上生效 */
    defaultOpen?: boolean
}

/** 内联状态行：文本 + 色调（成功＝官方 .savedNotice 绿，失败＝.error 红） */
interface Notice {
    text: string
    tone: 'success' | 'error'
}

const STYLE_ID = 'dsh-model-fix-card-css'

/**
 * 内嵌样式表（类名 dsh-mf- 前缀防撞）。取值逐条照官方同类组件：外层卡＝旧版宿主
 * 「设置 → 插件 → 内置插件」的插件卡；内层瓦片＝旧版宿主「设置 → 插件 → 插件列表」的
 * 插件行卡——两处基准均取旧版观感（用户裁定），仅两处例外采纳现行值：瓦片底色
 * `--dsw-alias-settings-card-fill`、瓦片行折叠钮焦点环（照现行 .cardContent）。
 * 颜色一律只用 --dsw-alias-* 令牌，
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
    // 展开体：左右内缩与 header 对齐；顶部 0.5px 分隔线隔开摘要与正文，12px 上边距撑开与瓦片的距离
    '.dsh-mf-body{margin:0 16px;padding:12px 0 8px;border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));display:flex;flex-direction:column;gap:12px}',
    // 状态行：内联承载一切结果反馈
    '.dsh-mf-notice{margin:0;padding:0 16px 12px;font-size:12px;line-height:18px}',
    '.dsh-mf-noticeSuccess{color:var(--dsw-alias-state-success-primary,#22c55e)}',
    '.dsh-mf-noticeError{color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mf-line{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-warn{color:var(--dsw-alias-state-warn-label,#dd8629)}',
    // 配置组瓦片：栅格、项卡外壳、描边/阴影、行与展开体逐条照官方「插件列表」项卡（ui-settings-plugin-inventory）。
    // 描边用官方 elevation 令牌链（0.5px 发丝画在 box-shadow 里），字面兜底复刻其计算结果——有令牌即同源换色，无令牌同观感
    '.dsh-mf-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:start;gap:10px}',
    '.dsh-mf-item{min-width:0;overflow:hidden;border:0;border-radius:14px;background:var(--dsw-alias-settings-card-fill,#fff);box-shadow:var(--dsw-elevation-stroke,0 0 0 0.5px var(--dsw-alias-border-l4,rgba(0,0,0,.16)))}',
    // 展开态（官方 data-open 驱动）：描边换最浅的 l1 并叠两层柔光，summary 行保留淡底
    '.dsh-mf-item[data-open="true"]{--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,rgba(0,0,0,.04));box-shadow:var(--dsw-elevation-panel,0 0 0 0.5px var(--dsw-alias-border-l1,rgba(0,0,0,.04)),0 3px 8px 0 rgba(0,0,0,.03),0 0 16px 0 rgba(0,0,0,.02))}',
    '.dsh-mf-item[data-open="true"]>.dsh-mf-itemHead{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
    '.dsh-mf-itemHead{box-sizing:border-box;position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:52px;padding:12px 14px;color:var(--dsw-alias-label-primary,#0f1115)}',
    '.dsh-mf-itemHead:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06))}',
    // 整行折叠按钮：透明覆盖层承担点击与键盘；尾区抬 z-index 关掉 pointer-events、只放开开关本体（无 button 嵌套）
    '.dsh-mf-itemToggle{position:absolute;inset:0;padding:0;border:none;border-radius:14px;background:none;cursor:pointer}',
    // 整行折叠钮照官方 .cardContent:focus-visible 补环：覆盖层 inset:0 与官方卡头按钮同范围，offset -2px 画行内缘（不被瓦片 overflow:hidden 裁剪）
    '.dsh-mf-itemToggle:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,rgb(65,118,230)));outline-offset:-2px}',
    '.dsh-mf-itemTitle{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px;font-weight:600}',
    '.dsh-mf-itemTrailing{position:relative;z-index:1;display:inline-flex;flex:none;align-items:center;gap:7px;pointer-events:none;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-itemSwitch{pointer-events:auto}',
    '.dsh-mf-itemChevron{flex:none;transition:transform 140ms var(--ds-ease-in-out,ease)}',
    '.dsh-mf-item[data-open="true"] .dsh-mf-itemChevron{transform:rotate(180deg)}',
    // 展开体填充官方 .cardDetails 的模块底色（与同页 .editor/.setupCard 同令牌），使展开内容读成内层面板
    '.dsh-mf-itemBody{border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));padding:10px 14px 12px;display:grid;gap:6px;background:var(--dsw-alias-bg-module-platform,#f5f6f7)}',
    '.dsh-mf-itemHint{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-itemRow{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary,#0f1115)}',
    // 行内标签组：照官方 settings-form .labelGroup（inline-flex、gap 4px、min-width:0），标签过长时省略号截断
    '.dsh-mf-itemLabelGroup{display:inline-flex;align-items:center;gap:4px;min-width:0}',
    '.dsh-mf-itemLabel{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    // 说明键：度量与形态照官方 settings-form .helpButton（24×24 无边框图标钮），hover 底色改取本卡 header 同款
    // interactive-bg-hover（官方写的 bg-layer-4 主题未定义，见本表抬头）
    '.dsh-mf-help{display:inline-flex;align-items:center;justify-content:center;flex:none;width:24px;height:24px;padding:0;border:0;border-radius:var(--dsw-radius-sm,8px);background:none;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}',
    '.dsh-mf-help:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mf-help:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,rgb(65,118,230)));outline-offset:1px}',
    // 输入框照 ModelsSection 的 .input，删除钮照同页 .iconButton（hover 用 .iconButtonDanger 变体）
    '.dsh-mf-input{box-sizing:border-box;width:100%;height:32px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.16));border-radius:var(--dsw-radius-md,12px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#0f1115);font:inherit;font-size:14px;line-height:22px}',
    '.dsh-mf-input:focus{border-color:var(--dsw-alias-state-business-primary,rgb(65,118,230));outline:none}',
    '.dsh-mf-input::placeholder{color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mf-input:disabled{opacity:.6;cursor:default}',
    '.dsh-mf-fieldError{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ec1313)}',
    // 一行一项：状态点在胶囊外（官方 trailing 同为 [点][胶囊] 兄弟节点）；删除钮 margin-left:auto 贴右成列
    '.dsh-mf-tagRow{position:relative;display:flex;align-items:center;gap:7px;min-width:0}',
    '.dsh-mf-tagText{min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '.dsh-mf-remove{box-sizing:border-box;flex:none;width:28px;height:28px;margin-left:auto;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:var(--dsw-radius-sm,8px);background:0 0;color:var(--dsw-alias-label-tertiary,#81858c);cursor:pointer}',
    '.dsh-mf-remove:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05));color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mf-remove:disabled{cursor:default;opacity:.4}',
    // 只给读屏器的状态文案：照同页 .hiddenLabel 的裁剪手法
    '.dsh-mf-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media (max-width:680px){.dsh-mf-items{grid-template-columns:minmax(0,1fr)}}',
    '@media (prefers-reduced-motion:reduce){.dsh-mf-itemChevron{transition:none}}',
    // 动作键行（强制更新 / 重置推理级别 / 恢复备份 / 验证模型）：独占一行、靠左起排，不设分割线——它承接上方瓦片，
    // 分隔线留给其下的取消/保存行；键渐多后在本行内换行落位，不相互挤压
    '.dsh-mf-bar{display:flex;align-items:center;justify-content:flex-start;gap:8px;padding:12px 0 0}',
    // 取消/保存行：分隔线之下靠右收尾。上间距取 8px（原 12px）——上一行动作键已经自带 12px 上间距，
    // 两段叠加使这条分割线离键过远；8px 是宿主 .section 内部相邻控件的档位
    '.dsh-mf-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:8px 0 0;border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}',
    '.dsh-mf-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    // footer 键度量照官方 SettingsForm .save（圆角 radius-md + focus 环同源）；force 红字透明底照
    // models 页 .dangerButton 语义；discard 官方无同款（SettingsForm 不设 discard 键），度量与 save 成对
    '.dsh-mf-discard,.dsh-mf-save,.dsh-mf-force{appearance:none;border:1px solid transparent;border-radius:var(--dsw-radius-md,12px);padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer}',
    '.dsh-mf-discard:focus-visible,.dsh-mf-save:focus-visible,.dsh-mf-force:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,rgb(65,118,230)));outline-offset:1px}',
    '.dsh-mf-discard{border-color:var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:none;color:var(--dsw-alias-label-secondary,#61666b)}',
    '.dsh-mf-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary,#0f1115);border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mf-save{background:var(--dsw-alias-label-primary,#0f1115);color:var(--dsw-alias-bg-layer-3,#fff)}',
    '.dsh-mf-force{background:none;color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mf-force:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05))}',
    '.dsh-mf-discard:disabled,.dsh-mf-save:disabled,.dsh-mf-force:disabled{opacity:.4;cursor:default}',
    // 卡片末尾的项目链接行（版权行语气）：border-top 即分割线。四段间距全部 12px ——
    // footer 的 padding-bottom 归零、间距整体让给本行的 padding-top，两条分割线各自到最近内容的距离相等
    '.dsh-mf-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 0 4px;border-top:0.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1))}',
    '.dsh-mf-metaLeft{display:inline-flex;align-items:center;gap:8px;min-width:0}',
    // 仓库地址与两个跳转键同为描边小片、一律 12px：这一行是版权/联系说明，不该有主次层级
    '.dsh-mf-chip{display:inline-flex;align-items:center;gap:6px;min-width:0;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:8px;padding:3px 10px;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#61666b);text-decoration:none;white-space:nowrap}',
    'a.dsh-mf-chip:hover{color:var(--dsw-alias-label-primary,#0f1115);border-color:var(--dsw-alias-label-dimmed,#e1e5ee)}',
    '.dsh-mf-chipAddress{overflow:hidden;text-overflow:ellipsis}',
    // 版本标记加一层底色：取开关关闭态轨道色 border-l3 的半透明，等同开关 :disabled（opacity .5）压到
    // 卡片底上的观感，而文字/图标仍取全强度（不能用 opacity 整体压，会连字一起变淡）
    '.dsh-mf-chipVersion{background:color-mix(in srgb, var(--dsw-alias-border-l3,rgba(0,0,0,.12)) 50%, transparent)}',
    '.dsh-mf-linkIcon{flex:none;display:block;width:12px;height:12px;color:currentColor}',
    // 危险确认键：官方 .deleteConfirm 写法（outline 按钮 + 红描边红字 + danger hover）
    '.dsh-mf-confirmDanger:not(:disabled){border-color:var(--dsw-alias-state-error-primary,#ec1313);color:var(--dsw-alias-state-error-primary,#ec1313)}',
    '.dsh-mf-confirmDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(236,19,19,.05))}',
    // 「验证模型」弹层：逐条照官方 models 页「获取可用模型」候选框（ModelsSection 的 fetchDialog / candidate* 类）。
    // 宿主滚动条变量无浅色真值可引，按官方原样透传、不自造字面量兜底
    '.dsh-mf-verifyDialog{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);max-width:520px}',
    '.dsh-mf-verifyList{display:flex;flex-direction:column;gap:2px;max-height:240px;margin:0;padding:0;list-style:none;overflow-y:auto}',
    // 验证弹层比宿主默认的 380px 宽一档：候选列表里的模型 id 常带斜杠（如 z-ai/glm-5），窄框里会折行、
    // 与右侧开关挤在一起。宿主 .dialog 的 width 同为单类选择器，本插件的 <style> 后于宿主样式表注入，
    // 同优先级下后者胜出，故能覆盖
    '.dsh-mf-verifyDialog{width:min(560px,100%)}',
    // 提供方分组头：官方候选框本无分组，此处一行标题标明下一批条目归属（零自造色，仅用宿主 label 令牌）。
    // 排布照官方 candidateToolbar——align-items:center + gap:8px 的 flex 行；右侧分组全选键 margin-left:auto 顶到行尾。
    // 纵向内边距取官方 candidateLabel 的 6px 8px，与候选行同档（原为 8px/4px，不在官方档位内）
    '.dsh-mf-verifyGroup{display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,#81858c)}',
    '.dsh-mf-verifyGroupAll{margin-left:auto}',
    '.dsh-mf-verifyRow{border-radius:var(--dsw-radius-md,12px)}',
    '.dsh-mf-verifyLabel{display:flex;align-items:center;gap:8px;padding:6px 8px;cursor:pointer}',
    '.dsh-mf-verifyId{flex:auto;min-width:0;overflow:hidden;font-family:var(--ds-font-family-code);font-size:13px;text-overflow:ellipsis;white-space:nowrap}',
    '.dsh-mf-verifyEmpty{margin:24px 0;color:var(--dsw-alias-label-secondary,#61666b);text-align:center;font-size:13px;line-height:20px}',
    // 额度提示：逐条同官方插件卡的 .notice——warn 语义、12px/18px，且作为 .section 的直接子元素靠 section 的 gap 定距，
    // 故上间距取 12px；不可套 candidateToolbar→candidateList 的 6px（那是「控件紧贴列表」的档，用在这里显得挤）
    '.dsh-mf-verifyQuota{margin:12px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label,#dd8629)}',
    // 档位开关：放在 body 内而非 footer——宿主 RiskConfirmation（敏感操作前置确认）正是这个排法，
    // 确认控件留在正文、footer 只放取消/确认两键；上间距逐条取其 .acknowledgement 的 margin-top:20px
    '.dsh-mf-verifyOption{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary,#61666b)}',
    // 探测弹层的两个开关并排：同属一组操作参数，按「小节内相邻块」的 12px 档定距；
    // 上间距取 20px——它们与上一段（额度提示）分属两块，逐条同其 .acknowledgement 的 margin-top:20px
    '.dsh-mf-verifyOptions{display:flex;align-items:center;gap:12px;min-width:0;margin:20px 0 0}',
    // 验证弹层 footer 的纵向容器与按钮行：宿主 .footer 是单行 flex 且无 wrap，整行块只能自己排。
    // 间距取宿主 .dialog 的列间距 20px（同层），按钮行三个数值逐条复刻宿主 .footer
    '.dsh-mf-verifyFoot{display:flex;flex-direction:column;gap:20px;width:100%}',
    '.dsh-mf-verifyActions{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%}',
    '.dsh-mf-verifyButtons{display:flex;align-items:center;gap:8px}',
    // 记录区上下边距：宿主 TerminalBlock 的 .block 自带 margin:16px 0，叠加本层 .dsh-mf-verifyFoot 的
    // 20px 列间距后达 36px，与按钮行脱节；收窄到 8px（上）与 0（下，末子元素不占位）
    '.dsh-mf-verifyLog{margin:8px 0 0}',
    // 注意语义键：卡片 footer 的「验证模型」触发键与弹层内的验证确认键共用，仅把描边/字色换成 warn 令牌；
    // hover 用其 10% 稀释（宿主无 warn 悬停底令牌，与 .dsh-mf-chipVersion 同一 color-mix 手法，不自造色值）。
    // 叠加在 .dsh-mf-discard 之上时靠 :not(:disabled) 的高特异性压过其默认描边/字色
    '.dsh-mf-warn:not(:disabled){border-color:var(--dsw-alias-state-warn-label,#dd8629);color:var(--dsw-alias-state-warn-label,#dd8629)}',
    '.dsh-mf-warn:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-warn-label,#dd8629) 10%, transparent)}',
].join('\n')

/** 幂等注入样式：每次渲染校验 DOM 实况——宿主 HMR 会按 data-plugin 摘走旧节点，节点在则同步内容 */
function ensureStyles(): void {
    if (typeof document === 'undefined') return
    let tag = document.getElementById(STYLE_ID)
    if (tag === null) {
        tag = document.createElement('style')
        tag.id = STYLE_ID
        tag.dataset.plugin = PLUGIN_NAME
        document.head.appendChild(tag)
    }
    if (tag.textContent !== STYLE_TEXT) tag.textContent = STYLE_TEXT
}

/** 截断失败信息：RPC 与异常消息可能极长（含 URL、响应片段），截断以保持状态行可读 */
function truncateMessage(value: string): string {
    return value.length > 120 ? `${value.slice(0, 119)}…` : value
}

/** 配置组瓦片（官方「插件列表」项卡同款）：summary 为组名 + 整组开关 + 折叠箭头，展开体为组释义 + 子开关行
 * （每行标题旁带一个说明键，气泡给该设置项释义）；
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
                    <Switch
                        className="dsh-mf-itemSwitch"
                        checked={masterValue(props.flags, group)}
                        disabled={props.disabled}
                        label={`${title} ${t('masterAll')}`}
                        onChange={props.onMaster}
                    />
                    <CHEVRON_DOWN size={12} className="dsh-mf-itemChevron" />
                </span>
            </div>
            {open ? (
                <div className="dsh-mf-itemBody" id={`${id}-body`}>
                    <p className="dsh-mf-itemHint">{t(HINT_KEYS[group])}</p>
                    {GROUP_KEYS[group].map((key) => {
                        const tip = t(TIP_KEYS[key])
                        return (
                            <div key={key} className="dsh-mf-itemRow">
                                <span className="dsh-mf-itemLabelGroup">
                                    <span className="dsh-mf-itemLabel">{t(ROW_KEYS[key])}</span>
                                    {/* 设置项释义用宿主 Tooltip 原语（悬停 / 键盘聚焦起气泡），锚点形态照官方 settings-form
                                     * 的 .helpButton（信息图标键）。portal 必需：瓦片 overflow:hidden 加上 box-shadow 构成的
                                     * 层叠上下文会把定位于锚点的气泡裁掉，气泡须挂到 body 上才不被行内裁剪 */}
                                    <Tooltip label={tip} side="right" maxWidth={TIP_MAX_WIDTH} portal>
                                        <button type="button" className="dsh-mf-help" aria-label={tip}>
                                            <IconInfoOutlineRegular size={12} />
                                        </button>
                                    </Tooltip>
                                </span>
                                <Switch
                                    checked={groupValue(props.flags, group, key)}
                                    disabled={props.disabled}
                                    label={`${t(ROW_KEYS[key])} ${title}`}
                                    onChange={() => { props.onCell(key) }}
                                />
                            </div>
                        )
                    })}
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
                    {/* 官方 trailing 结构：[状态点][状态胶囊]，点在胶囊外；summary 的点纯装饰（StateDot 自带 aria-hidden，徽标文字已带语义） */}
                    {props.hits.size > 0 ? <StateDot state="done" size={7} /> : null}
                    <Tag tone={props.hits.size > 0 ? 'success' : 'neutral'}>
                        {t('excludeHits', { count: props.hits.size })}
                    </Tag>
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
                                {hit ? <StateDot state="done" size={7} /> : null}
                                <Tag tone={hit ? 'success' : 'neutral'}>
                                    <span className="dsh-mf-tagText">{excluded}</span>
                                </Tag>
                                {/* 命中状态不能只靠颜色传达：StateDot 恒 aria-hidden，行内另留一份读屏状态文案 */}
                                <span className="dsh-mf-hidden">{stateText}</span>
                                <button
                                    type="button"
                                    className="dsh-mf-remove"
                                    aria-label={t('excludeRemove', { id: excluded })}
                                    disabled={props.disabled}
                                    onClick={() => { props.onRemove(excluded) }}
                                >
                                    <IconTrashOutlineRegular size={14} />
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
    // 验证候选与提供方 id 同源（同一份 llm-pi-ai user 层），故列表里出现的正是 fix 会遍历的那些模型
    const verifyCandidates = useMemo(
        () => verifyCandidatesOf(providersSnap.status === 'ready' ? providersSnap.user : undefined),
        [providersSnap],
    )
    // 按提供方归组渲染：候选本就是「提供方内聚」的录入顺序，取相邻同提供方成组即可，无需再分桶
    const verifyGroups = useMemo(() => {
        const groups: { provider: string; models: VerifyCandidate[] }[] = []
        for (const candidate of verifyCandidates) {
            const last = groups[groups.length - 1]
            if (last !== undefined && last.provider === candidate.provider) last.models.push(candidate)
            else groups.push({ provider: candidate.provider, models: [candidate] })
        }
        return groups
    }, [verifyCandidates])
    // draft === null 表示未编辑、跟随已存值；首次点击即冻结当前显示值为草稿
    const [draft, setDraft] = useState<Flags | null>(null)
    // 全部写操作（保存 / 强制更新 / 重置 / 恢复 / 清空记忆 / 验证）共用单一互斥标志：
    // 一者 in-flight 时其余入口与按钮全禁；后续新增动作只加成员，不必改既有互斥
    const [busy, setBusy] = useState<'save' | 'force' | 'reset' | 'restore' | 'clear' | 'verify' | 'probe' | 'prune' | null>(null)
    // 折叠态为卡片本地状态（读姿而非配置）：初始值取 defaultOpen（缺省收起、与官方插件卡一致）；草稿跨折叠存活
    const [open, setOpen] = useState(props.defaultOpen ?? false)
    // 保存后自动收起只对默认收起的席位有意义：默认展开的三席（插件详情页 / 组件实例详情页 / 内置插件选项卡）
    // 保存后保持展开，否则用户刚配完就被收起、还得再点一次才看得见结果
    const autoCollapse = props.defaultOpen !== true
    // 瓦片折叠态：官方手风琴语义（同时只开一个、默认全收起；各瓦片展开高度不同，同开两列底部参差）
    const [tileOpen, setTileOpen] = useState<string | null>(null)
    // 内联结果提示：常驻至下一次操作（官方 .savedNotice 无定时器，故不设自动淡出）
    const [notice, setNotice] = useState<Notice | null>(null)
    // 三个后端写回操作各控一个宿主 Modal 二次确认（执行态统一在 busy）
    const [confirmOpen, setConfirmOpen] = useState(false)
    const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
    const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
    // 「记住推理级别」关掉时的确认：是否清空已有记忆（前端直写，不走 RPC）
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
    // 剔除确认的目标：验证明细里**明确**被判「档位不支持」的条目，由 Node 半直接给出，
    // 浏览器半不自己从 results 里筛——两处口径一旦分叉就会漏剔或多剔。
    // 中止 / 出错 / 无此类结论时保持空数组，空数组即不弹窗
    const [pruneTargets, setPruneTargets] = useState<readonly UnsupportedEffort[]>([])
    // 「验证模型」弹层：勾选集（键见 verifyKey）、是否逐个档位验证；默认不预选——每次验证都花真实额度
    const [verifyOpen, setVerifyOpen] = useState(false)
    const [verifyPicked, setVerifyPicked] = useState<ReadonlySet<string>>(() => new Set())
    const [verifyEfforts, setVerifyEfforts] = useState(false)
    // 验证记录区：逐行追加探测结论，发起时清空；总项数取自 opened 帧，供记录区抬头显示
    const [verifyLines, setVerifyLines] = useState<readonly string[]>([])
    const [verifyTotal, setVerifyTotal] = useState(0)
    // 本轮是否以中止收场：跑完与失败都留在窗内，只有停止键会中止，故记录区的 settle 措辞按它分「完成 / 已停止」
    const [verifyStopped, setVerifyStopped] = useState(false)
    // 在途的 AbortController：点停止、关窗与组件卸载都靠它中止——中止经 signal 传导到 Node 半的执行循环
    const verifyAbort = useRef<AbortController | null>(null)
    // 卸载即中止在途验证：连接随之断开，宿主 Connection 把断开传导成 request.signal，执行循环随即早停
    useEffect(() => () => { verifyAbort.current?.abort() }, [])
    // 中止不落宿主那个 error 态的「失败」——用户主动停止不是失败，故改 done 态 + 中性措辞「已停止」
    const verifyTerminalLabels = useMemo<TerminalBlockLabels>(
        () => ({ ...terminalLabelsOf(t), done: verifyStopped ? t('verifyStopped') : t('terminalDone') }),
        [t, verifyStopped],
    )
    const saveStarted = useRef(false)

    // 「探测式填充」弹层：两个开关 + 点开弹层那一刻冻结的候选清单（两个键各一份）+ 记录区。
    // 候选清单冻结在点开时而非渲染时：模型列表要取**点按钮那一刻**的最新值，
    // 弹层开着期间用户改了配置也不影响本轮（否则记录区的总项数与实际发的不一致）
    const [probeOpen, setProbeOpen] = useState(false)
    const [probeIgnoreExcludes, setProbeIgnoreExcludes] = useState(false)
    const [probeDropUnsupported, setProbeDropUnsupported] = useState(false)
    const [probePlan, setProbePlan] = useState<{ unfilled: readonly VerifyTarget[]; all: readonly VerifyTarget[] } | null>(null)
    // 本轮跑的是哪个键：在途那个键就地变「停止」，故得记住发起时的选择
    const [probeScope, setProbeScope] = useState<'unfilled' | 'all' | null>(null)
    const [probeLines, setProbeLines] = useState<readonly string[]>([])
    const [probeTotal, setProbeTotal] = useState(0)
    const [probeStopped, setProbeStopped] = useState(false)
    // 在途的 AbortController：点停止、关窗与组件卸载都靠它中止
    const probeAbort = useRef<AbortController | null>(null)
    // 跑完到关窗之间的展示延时：补全写回很快，不留时间用户就读不到刚跑出来的结论。
    // 定时器挂 ref 是为了关窗 / 卸载时能撤掉它——否则用户已经走了，回调还会把弹层状态再改一次
    const probeClosing = useRef<ReturnType<typeof setTimeout> | null>(null)
    // 卸载即中止在途探测并撤掉关窗定时器（与验证同一条纪律）
    useEffect(() => () => {
        probeAbort.current?.abort()
        if (probeClosing.current !== null) clearTimeout(probeClosing.current)
    }, [])
    const probeTerminalLabels = useMemo<TerminalBlockLabels>(
        () => ({ ...terminalLabelsOf(t), done: probeStopped ? t('verifyStopped') : t('terminalDone') }),
        [t, probeStopped],
    )

    const saved = snap.value
    const shown = draft ?? saved ?? DEFAULT_FLAGS
    const ready = snap.status === 'ready' && saved !== undefined
    const canWrite = ready && snap.writable === true
    const dirty = draft !== null && saved !== undefined && isDirty(draft, saved)
    // 命中集合按草稿算（编辑中即所见即所得），未命中项同样生效，只是当前无同名提供方
    const hits = useMemo(() => resolveHits(shown.excludes, providerIds), [shown.excludes, providerIds])
    // 两个探测键各自的模型数（点开弹层时冻结的那份计划）：为 0 的键禁用，不做「点了没反应」
    const unfilledCount = probePlan?.unfilled.length ?? 0
    const allCount = probePlan?.all.length ?? 0
    /** 探测弹层的两个发起键：在途那个就地变成「停止」，另一个禁用——弹层只有这两个入口，收起它们就只剩关闭 */
    const probeButton = (scope: 'unfilled' | 'all', count: number) => {
        const running = busy === 'probe' && probeScope === scope
        return (
            <Button
                variant="outline"
                className="dsh-mf-warn"
                disabled={running ? false : busy !== null || count === 0}
                onClick={running ? stopProbe : () => { runProbe(scope === 'unfilled') }}
            >
                {/* 在途指示：宿主 Button 自身即 inline-flex + gap，指示器直接作首个子节点。
                    键文本保持短——两个范围的大小由正文那句提示交代，不往键上堆 */}
                {running ? <StateDot state="ongoing" /> : null}
                {t(running ? 'probeStop' : scope === 'unfilled' ? 'probeUnfilled' : 'probeAll')}
            </Button>
        )
    }

    // 保存成功（保存结束且 dirty 归 false）后自动收起，仅限默认收起的席位；
    // 写失败保留草稿与展开态可重试。其余动作的 busy 起止不触碰 saveStarted，不会误收起
    useEffect(() => {
        if (busy === 'save') {
            saveStarted.current = true
            return
        }
        if (busy !== null) return
        if (!saveStarted.current) return
        saveStarted.current = false
        if (!dirty && autoCollapse) setOpen(false)
    }, [busy, dirty, autoCollapse])

    // 配置服务不可用：保留静态外壳（无展开语义）便于发现与排查
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
    // 整组总控：显示值取 masterValue（全开才显示开，部分选中显示关，点击即补全为开）；点击取反并把该组全部行设为同一值
    // （总开关无对应存储，只是批量操作）
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
        if (!canWrite || !dirty || busy) return
        setNotice(null)
        setBusy('save')
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
                setBusy(null)
            })
    }
    // 取消：草稿归 null 即回到「跟随已存值」形态，dirty 随之消失（不发任何写）
    const onDiscard = () => {
        if (busy === 'save') return
        setNotice(null)
        setDraft(null)
    }
    // 危险操作先弹 Modal 二次确认；不依赖 canWrite/dirty（不改配置，只按目录覆盖写回模型字段）
    const onForce = () => {
        if (!ready || busy) return
        setNotice(null)
        setConfirmOpen(true)
    }
    const runForce = () => {
        setConfirmOpen(false)
        setBusy('force')
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
                setBusy(null)
            })
    }
    // 重置推理级别：与强制更新同形（危险键 + 二次确认）；配置段零写入（开关不变），竞态防护由 Node 半事件流守卫负责
    const onReset = () => {
        if (!ready || busy) return
        setNotice(null)
        setResetConfirmOpen(true)
    }
    const runReset = () => {
        setResetConfirmOpen(false)
        setBusy('reset')
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
                setBusy(null)
            })
    }
    // 恢复备份：与重置同形（次级样式 + 二次确认），仅回退「备份与当前都存在」的 provider+model
    const onRestore = () => {
        if (!ready || busy) return
        setNotice(null)
        setRestoreConfirmOpen(true)
    }
    const runRestore = () => {
        setRestoreConfirmOpen(false)
        setBusy('restore')
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
                setBusy(null)
            })
    }
    // 验证模型：弹层自身已含 warn 提示与 warn 语义的确认键，构成自确认，故不再叠加二次确认弹层。
    // 只清掉上一次操作的结果、结果本身留在弹层内（那行挂在条件展开体之外，折叠不丢在途结果）
    const onVerify = () => {
        if (!ready || busy) return
        setNotice(null)
        setVerifyOpen(true)
    }
    const runVerify = () => {
        if (busy) return
        // 记下本次的档位开关取值：结果回来时不能现读，否则用户在途中拨了开关，文案就会张冠李戴
        const allEfforts = verifyEfforts
        // 每次发起都清空记录，免得上一轮（尤其被用户停止的那轮）的残留行混进这一轮
        setVerifyLines([])
        setVerifyTotal(0)
        setVerifyStopped(false)
        setBusy('verify')
        const controller = new AbortController()
        verifyAbort.current = controller
        props.verifyModels(verifyTargets(verifyCandidates, verifyPicked, allEfforts), (frame) => {
            if (frame.type === 'opened') {
                setVerifyTotal(frame.total)
                return
            }
            setVerifyLines((current) => [...current, verifyLineOf(frame, t)])
        }, controller.signal)
            .then((summary) => {
                // undefined = 被中止（点停止 / 关窗 / 断连）。那不是失败：保留进度与弹层，由用户决定要不要重跑
                if (summary === undefined) {
                    setVerifyStopped(true)
                    return
                }
                // 两档口径各取各的数：关档位时只有模型数可言，开档位时级别分母取 plannedEfforts——
                // 没声明档位的模型验的是模型本身、不占级别，用 planned（含它那条）会让分母虚高。
                // 而档位开关开着却一个级别都没计划时（勾选的模型都没声明档位），级别那行只会显示「[0/0]」，故退回模型口径
                const stats = t(allEfforts && summary.plannedEfforts > 0 ? 'verifyDoneLevels' : 'verifyDoneModels', {
                    models: summary.models,
                    tested: summary.tested,
                    efforts: summary.efforts,
                    levels: summary.plannedEfforts,
                })
                // 结论只留在弹层内，不写卡片状态行：弹层跑完不关、结论又追加成记录区末行，
                // 用户当场就看得见；同步到卡片是「渗透」——关窗即随记录一起丢弃，那行反馈没有归属
                // 明细由 Node 半直接给出（只收明确判为不支持的），前端不自己从 results 里筛——
                // 两处口径一旦分叉就会漏剔或多剔。中止时压根到不了这里，故不会误弹
                setPruneTargets(summary.unsupportedEfforts)
                setVerifyLines((current) => [...current, t('verifyFinished', { result: stats })])
            })
            .catch((error: unknown) => {
                const stats = t('verifyFailed', { message: truncateMessage(error instanceof Error ? error.message : String(error)) })
                setVerifyLines((current) => [...current, t('verifyFinished', { result: stats })])
            })
            .finally(() => {
                verifyAbort.current = null
                setBusy(null)
            })
    }
    // 停止：中止在途验证。连接随之断开，Node 半的执行循环随即早停，不再消耗额度。
    // 不顺手关窗——已验到哪一步值得留在记录里，用户看完可以原地重跑
    const stopVerify = () => { verifyAbort.current?.abort() }
    /**
     * 按当前状态算两份候选计划（未填充 / 全部）：模型列表取**此刻**的最新值。
     *
     * 排除值用卡片当前显示的那份（与「命中」判定同源，故所见即所得）；`ignoreExcludes` 由调用方给，
     * 它同时传下去管 Node 半的两次写回，两边必须是同一个值。
     */
    const probePlanOf = (ignoreExcludes: boolean) => {
        const user = providersSnap.status === 'ready' ? providersSnap.user : undefined
        const pick = (unfilledOnly: boolean): readonly VerifyTarget[] => probeTargetsOf(probeCandidatesOf(user, {
            excludes: shown.excludes,
            ignoreExcludes,
            unfilledOnly,
        }))
        return { unfilled: pick(true), all: pick(false) }
    }
    /** 探测式填充：点开弹层并当场冻结计划。弹层开着期间配置再变也不改本轮（记录区的总项数照这份计划走） */
    const onProbe = () => {
        if (busy !== null) return
        setProbePlan(probePlanOf(probeIgnoreExcludes))
        setProbeOpen(true)
    }
    // 切「忽略排除」要重算计划：探测范围随它变，两个键上标的模型数与记录区的总项数不跟着变，
    // 用户看到的数字就和实际会探的模型对不上了
    const toggleIgnoreExcludes = (value: boolean) => {
        setProbeIgnoreExcludes(value)
        setProbePlan(probePlanOf(value))
    }
    /**
     * 跑一轮探测式填充。
     *
     * 跑完不立刻关窗：Node 半在终帧之前已把档位按结论收敛写回（终帧的 `summary.fill` 带增删统计），
     * 写回很快，不留一点时间的话用户刚看到记录区就被关掉，结论等于没给。故先把收尾行与补全结果
     * 追加进记录区，延时 PROBE_CLOSE_DELAY_MS 再关窗，并把同一份结果落到卡片状态行。
     * 在途被中止则不写回统计也不关窗：未跑完的模型已被 Node 半还原成本轮开始前的形态，
     * 留在窗里让用户看见「探到哪一步」比报一个半截结论诚实。
     */
    const runProbe = (unfilledOnly: boolean) => {
        if (busy !== null || probePlan === null) return
        const models = unfilledOnly ? probePlan.unfilled : probePlan.all
        if (models.length === 0) return
        // 重跑先撤掉上一次的关窗定时器：否则它在第二次探测跑到一半时把窗关了
        if (probeClosing.current !== null) {
            clearTimeout(probeClosing.current)
            probeClosing.current = null
        }
        setProbeLines([])
        setProbeTotal(0)
        setProbeStopped(false)
        setBusy('probe')
        const controller = new AbortController()
        probeAbort.current = controller
        setProbeScope(unfilledOnly ? 'unfilled' : 'all')
        // 「剔除不支持」只对「探测所有」有意义：未填充的模型本来就没声明过档位，判不支持的那些
        // 压根不会写进去，没什么可剔。故这一档在这里被强制按关处理，不把用户的选择悄悄带进下一轮
        props.probeEfforts(models, { ignoreExcludes: probeIgnoreExcludes, dropUnsupported: unfilledOnly ? false : probeDropUnsupported }, (frame) => {
            if (frame.type === 'opened') {
                setProbeTotal(frame.total)
                return
            }
            setProbeLines((current) => [...current, verifyLineOf(frame, t)])
        }, controller.signal)
            .then((summary) => {
                if (summary === undefined) {
                    setProbeStopped(true)
                    return
                }
                const fill = summary.fill
                const stats = t('probeDone', {
                    models: String(summary.tested),
                    levels: String(summary.plannedEfforts),
                    usable: String(summary.efforts),
                    unsupported: String(summary.unsupported),
                })
                const filled = t('probeFilled', {
                    models: String(fill?.models ?? 0),
                    added: String(fill?.added ?? 0),
                    removed: String(fill?.removed ?? 0),
                })
                setNotice({ text: filled, tone: 'success' })
                setProbeLines((current) => [...current, stats, filled, t('probeClosing')])
                probeClosing.current = setTimeout(() => {
                    probeClosing.current = null
                    closeProbe()
                }, PROBE_CLOSE_DELAY_MS)
            })
            .catch((error: unknown) => {
                const failed = t('probeFillFailed', { message: truncateMessage(error instanceof Error ? error.message : String(error)) })
                setNotice({ text: failed, tone: 'error' })
                setProbeLines((current) => [...current, failed])
                probeClosing.current = setTimeout(() => {
                    probeClosing.current = null
                    closeProbe()
                }, PROBE_CLOSE_DELAY_MS)
            })
            .finally(() => {
                probeAbort.current = null
                setProbeScope(null)
                setBusy(null)
            })
    }
    // 停止：中止在途探测。连接随之断开，Node 半的执行循环随即早停，不再消耗额度。
    // 不顺手关窗——已探到哪一步值得留在记录里
    const stopProbe = () => { probeAbort.current?.abort() }
    // 关闭即丢弃本轮记录与计划，并把两个开关一并复位（下次打开回到「关」的初始态）。
    // 与验证弹层同一处理（a8900c8）：开关是本轮的模式选择，留着会让下次打开时的模型数
    // 与用户当下看到的开关状态对不上——尤其「忽略排除」直接决定候选范围。
    // 在途时关窗同时中止并撤掉关窗定时器；遮罩 / Escape / × / 「关闭」键四种关闭都汇到 Modal 的 onClose 与该键
    const closeProbe = () => {
        probeAbort.current?.abort()
        if (probeClosing.current !== null) {
            clearTimeout(probeClosing.current)
            probeClosing.current = null
        }
        setProbeOpen(false)
        setProbePlan(null)
        setProbeScope(null)
        setProbeLines([])
        setProbeTotal(0)
        setProbeStopped(false)
        setProbeIgnoreExcludes(false)
        setProbeDropUnsupported(false)
    }
    // 关闭即丢弃本次勾选与记录，并把档位开关一并复位（下次打开回到未预选、无记录、开关关闭的初始态）
    // 在途时关窗同时中止：验证即用即弃，用户已经离开就没必要继续烧额度。
    // 遮罩 / Escape / × 三种关闭都汇到 Modal 的 onClose，故中止只此一处；跑完后控制器已置空，是空操作
    const closeVerify = () => {
        verifyAbort.current?.abort()
        setVerifyOpen(false)
        setVerifyPicked(new Set())
        setVerifyLines([])
        setVerifyTotal(0)
        setVerifyEfforts(false)
    }
    // 剔除确认的关闭即丢弃目标：不写任何配置，清空即自然不再弹出（不另设开关态，避免两个状态不同步）
    const closePrune = () => { setPruneTargets([]) }
    /**
     * 剔除不被支持的推理级别：经 Node 半写回。
     *
     * 读取最新配置、revision 围栏与冲突重试、只认目标里当前仍在档位表中的那些、事件流守卫——全在那边，
     * 浏览器半只负责发请求与展示结果；剔除条数照实显示，为 0 也不例外——目标在剔除期间已被用户改掉，
     * 或其提供方正在排除列表里（排除提供方在 `planPruneEfforts` 中整组跳过，不撤销已写入的内容）。
     *
     * 无论成败都关掉两层弹层（剔除确认 + 其下的验证弹层）：结果写在卡片状态行上，
     * 弹层不关用户看不到，那条反馈等于没有。
     */
    const pruneEfforts = () => {
        if (busy) return
        setBusy('prune')
        props.pruneEfforts(pruneTargets)
            .then((result) => {
                if (result.ok) {
                    const pruned = (result.value as { pruned?: number } | undefined)?.pruned ?? 0
                    setNotice({ text: t('pruneDone', { count: String(pruned) }), tone: 'success' })
                } else {
                    setNotice({ text: t('pruneFailed', { message: truncateMessage(result.error.message) }), tone: 'error' })
                }
            })
            .catch((error: unknown) => {
                setNotice({
                    text: t('pruneFailed', { message: truncateMessage(error instanceof Error ? error.message : String(error)) }),
                    tone: 'error',
                })
            })
            .finally(() => {
                setBusy(null)
                closePrune()
                closeVerify()
            })
    }
    const toggleVerifyPick = (key: string) => {
        setVerifyPicked((current) => {
            const next = new Set(current)
            if (!next.delete(key)) next.add(key)
            return next
        })
    }
    // 分组全选：点击方向与按钮文案同走 groupAllPicked（判据只此一处，两边各判一次会反直觉）
    const toggleVerifyGroup = (models: readonly VerifyCandidate[]) => {
        setVerifyPicked((current) => toggleGroupPicks(current, models))
    }
    // 清空记忆：前端经自有 NS 的 settings scope 直写（与「保存」同一条写通道，立即生效、草稿不动）；
    // 失败要显式提示——否则开关已关而记忆未清，无从察觉。与保存共用 busy 互斥：
    // 保存整段写含 efforts 实时值，两者并发时后落者会把先落者覆盖掉
    const clearEfforts = () => {
        if (busy) return
        setClearConfirmOpen(false)
        setBusy('clear')
        void scope.mutate([{ op: 'set', path: [VERSION_KEY, 'efforts'], value: {} }])
            .then((accepted) => { setNotice({ text: t(accepted ? 'clearEffortsDone' : 'clearEffortsFailed'), tone: accepted ? 'success' : 'error' }) })
            .catch(() => { setNotice({ text: t('clearEffortsFailed'), tone: 'error' }) })
            .finally(() => { setBusy(null) })
    }

    // 结果提示挂在条件体之外：折叠不会吞掉在途/已到的结果
    const isError = notice?.tone === 'error'
    const notices = notice !== null ? (
        <p
            className={isError ? 'dsh-mf-notice dsh-mf-noticeError' : 'dsh-mf-notice dsh-mf-noticeSuccess'}
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? undefined : 'polite'}
        >
            {notice.text}
        </p>
    ) : null
    // 反馈链接预填版本 + 标准 issue 模板：用户点开即在正文里看到骨架，不必回忆要写哪几项
    const issuesHref = `${ISSUES_URL}?body=${encodeURIComponent(t('issueBody', { version: PLUGIN_VERSION }))}`
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
            {/* 动作键独占一行、置于分隔线之上：键数增长后不再与取消/保存挤在同一行 */}
            <div className="dsh-mf-bar">
                <span className="dsh-mf-actions">
                    <button
                        type="button"
                        className="dsh-mf-force"
                        disabled={!ready || busy !== null}
                        onClick={onForce}
                    >
                        {busy === 'force' ? t('forceBusy') : t('force')}
                    </button>
                    <button
                        type="button"
                        className="dsh-mf-force"
                        disabled={!ready || busy !== null}
                        onClick={onReset}
                    >
                        {busy === 'reset' ? t('resetBusy') : t('reset')}
                    </button>
                    <button
                        type="button"
                        className="dsh-mf-discard"
                        disabled={!ready || busy !== null}
                        onClick={onRestore}
                    >
                        {busy === 'restore' ? t('restoreBusy') : t('restore')}
                    </button>
                    {/* 验证模型：弹层自带额度提示与 warn 语义确认键，已构成自确认，故不再叠二次确认弹层；
                       触发键本身也取 warn 语义——点开即进入会花额度的流程，警示前移到入口 */}
                    <button
                        type="button"
                        className="dsh-mf-discard dsh-mf-warn"
                        disabled={!ready || busy !== null}
                        onClick={onVerify}
                    >
                        {t('verify')}
                    </button>
                    {/* 探测式填充：与验证同一 warn 语义（点开即进入会花额度、且会写回配置的流程）。
                        它放在验证之后——两者都花额度，但验证只读、探测写回，后者需要用户已经读过验证的结论 */}
                    <button
                        type="button"
                        className="dsh-mf-discard dsh-mf-warn"
                        disabled={!ready || busy !== null}
                        onClick={onProbe}
                    >
                        {t('probe')}
                    </button>
                </span>
            </div>
            <div className="dsh-mf-footer">
                <span className="dsh-mf-actions">
                    {/* 取消键只在有未保存编辑时出现（保存后自动隐去）；保存中保持可见但禁用 */}
                    {dirty ? (
                        <button
                            type="button"
                            className="dsh-mf-discard"
                            disabled={busy === 'save'}
                            onClick={onDiscard}
                        >
                            {t('cancel')}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className="dsh-mf-save"
                        disabled={!canWrite || !dirty || busy !== null}
                        onClick={onSave}
                    >
                        {busy === 'save' ? t('saving') : t('save')}
                    </button>
                </span>
            </div>
            {/* 分割线 + 仓库地址 + 两个跳转键：整行同一套描边小片（.dsh-mf-chip），不做主次层级 */}
            <div className="dsh-mf-meta">
                <span className="dsh-mf-metaLeft">
                    <a className="dsh-mf-chip dsh-mf-chipAddress" href={REPO_URL} target="_blank" rel="noreferrer noopener"><IconGitHub />{REPO_LABEL}</a>
                    {/* 版本标记只读，不做成链接 */}
                    <span className="dsh-mf-chip dsh-mf-chipVersion"><IconTag />v{PLUGIN_VERSION}</span>
                </span>
                <span className="dsh-mf-actions">
                    <a className="dsh-mf-chip" href={REPO_URL} target="_blank" rel="noreferrer noopener"><IconStar />{t('star')}</a>
                    <a className="dsh-mf-chip" href={issuesHref} target="_blank" rel="noreferrer noopener"><IconIssue />{t('feedback')}</a>
                </span>
            </div>
        </>
    )
    // 二次确认弹层：宿主 Modal + Button 原语（官方同页删除 provider 同款）；取消键标 data-modal-autofocus——焦点落在可安全退出的一侧（React autoFocus 抢在宿主模态层存触发控件之前，会毁掉关闭后的回焦）
    const confirms = (
        <>
            <Modal
                open={confirmOpen}
                onClose={() => { setConfirmOpen(false) }}
                title={t('force')}
                closeLabel={t('close')}
                description={t('forceConfirm')}
                footer={<>
                    <Button variant="outline" data-modal-autofocus onClick={() => { setConfirmOpen(false) }}>{t('cancel')}</Button>
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
                    <Button variant="outline" data-modal-autofocus onClick={() => { setResetConfirmOpen(false) }}>{t('cancel')}</Button>
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
                    <Button variant="outline" data-modal-autofocus onClick={() => { setRestoreConfirmOpen(false) }}>{t('cancel')}</Button>
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
                    <Button variant="outline" data-modal-autofocus onClick={() => { setClearConfirmOpen(false) }}>{t('clearEffortsKeep')}</Button>
                    <Button variant="outline" className="dsh-mf-confirmDanger" disabled={busy !== null} onClick={clearEfforts}>{t('clearEffortsGo')}</Button>
                </>}
            />
            {/* 剔除确认：结构照「清空推理级别记忆」那层二次确认，只把两键文案换成「剔除」。
                出现与否只看 pruneTargets 是否为空——中止、出错、或没有明确判为档位不支持的结论时都不弹 */}
            <Modal
                open={pruneTargets.length > 0}
                onClose={closePrune}
                title={t('pruneTitle')}
                closeLabel={t('close')}
                description={t('pruneConfirm', { count: String(pruneTargets.length) })}
                footer={<>
                    <Button variant="outline" data-modal-autofocus onClick={closePrune}>{t('cancel')}</Button>
                    <Button variant="outline" className="dsh-mf-confirmDanger" disabled={busy !== null} onClick={pruneEfforts}>{t('pruneGo')}</Button>
                </>}
            />
            {/* 「验证模型」弹层：结构逐条照官方 models 页「获取可用模型」的候选框（title / desc / 候选列表 / 底部取消 + 采用），
                按需求去掉其「搜索 — 全选」工具条一行；改为列表下方一条 warn 额度提示，底部左侧加「验证所有推理级别」开关。
                关窗（遮罩 / Escape / ×）即中止在途验证：连接一断，Node 半的执行循环随即早停，不会在用户离开之后继续烧额度 */}
            <Modal
                open={verifyOpen}
                onClose={closeVerify}
                title={t('verifyTitle')}
                closeLabel={t('close')}
                description={t('verifyDesc')}
                className="dsh-mf-verifyDialog"
                footer={<div className="dsh-mf-verifyFoot">
                    {/* 宿主 .footer 是单行 flex、无 wrap、且 justify-content 为 flex-end。弹层加宽后档位开关与两键
                        并排同一行、开关靠左两键靠右，故在 footer 内自绘容器覆盖宿主那三个数值；
                        纵向容器留着，因为记录区仍在这一行下方 */}
                    <div className="dsh-mf-verifyActions">
                        <span className="dsh-mf-verifyOption">
                            <Switch
                                checked={verifyEfforts}
                                disabled={busy === 'verify'}
                                label={t('verifyEfforts')}
                                onChange={setVerifyEfforts}
                            />
                            <span>{t('verifyEfforts')}</span>
                            {/* 释义走宿主 Tooltip 原语，锚点复刻瓦片内的 .helpButton；portal 必需（模态层自建层叠上下文会裁掉气泡） */}
                            <Tooltip label={t('verifyEffortsTip')} side="top" maxWidth={TIP_MAX_WIDTH} portal>
                                <button type="button" className="dsh-mf-help" aria-label={t('verifyEffortsTip')}>
                                    <IconInfoOutlineRegular size={12} />
                                </button>
                            </Tooltip>
                        </span>
                        <div className="dsh-mf-verifyButtons">
                            <Button variant="outline" data-modal-autofocus disabled={busy === 'verify'} onClick={closeVerify}>{t('cancel')}</Button>
                            <Button
                                variant="outline"
                                className="dsh-mf-warn"
                                disabled={busy === null && verifyPicked.size === 0}
                                onClick={busy === 'verify' ? stopVerify : runVerify}
                            >
                                {/* 在途指示：宿主 Button 自身即 inline-flex + gap，指示器直接作首个子节点；
                                    StateDot 的 ongoing 态就是侧边栏会话列表项左侧那个转圈（同原语、同动效） */}
                                {busy === 'verify' ? <StateDot state="ongoing" /> : null}
                                {t(busy === 'verify' ? 'verifyStop' : 'verifyGo')}
                            </Button>
                        </div>
                    </div>
                    {/* 记录区置于按钮行下方，与官方安装弹层同序（那边是 wizardFoot 在前、detailsBody 在后）。
                        首次发起才出现：opened 帧一到即有总项数，先于此则没有任何进度可展示 */}
                    {verifyTotal > 0 ? (
                        <TerminalBlock
                            command={t('verifyCommand', { total: String(verifyTotal) })}
                            output={verifyLines.join('\n')}
                            running={busy === 'verify'}
                            maxLines={VERIFY_TERMINAL_LINES}
                            labels={verifyTerminalLabels}
                            className="dsh-mf-verifyLog"
                        />
                    ) : null}
                </div>}
            >
                {verifyGroups.length === 0 ? (
                    <p className="dsh-mf-verifyEmpty" role="status">{t('verifyEmpty')}</p>
                ) : (
                    <ul className="dsh-mf-verifyList">
                        {verifyGroups.map((group) => [
                            <li key={`g-${group.provider}`} className="dsh-mf-verifyGroup">
                                {group.provider}
                                {/* 分组全选键：组件、尺寸与文案语义逐条照官方 candidateToolbar 的 ghost 小键 */}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="dsh-mf-verifyGroupAll"
                                    disabled={busy === 'verify'}
                                    onClick={() => { toggleVerifyGroup(group.models) }}
                                >
                                    {groupAllPicked(verifyPicked, group.models) ? t('verifyDeselectAll') : t('verifySelectAll')}
                                </Button>
                            </li>,
                            ...group.models.map((candidate) => {
                                const key = verifyKey(candidate.provider, candidate.model)
                                return (
                                    <li key={key} className="dsh-mf-verifyRow">
                                        {/* 官方候选行同构：label 内 checkbox + 等宽模型 id，点整行即切换 */}
                                        <label className="dsh-mf-verifyLabel">
                                            <input
                                                type="checkbox"
                                                checked={verifyPicked.has(key)}
                                                disabled={busy === 'verify'}
                                                onChange={() => { toggleVerifyPick(key) }}
                                            />
                                            <span className="dsh-mf-verifyId" title={candidate.model}>{candidate.model}</span>
                                        </label>
                                    </li>
                                )
                            }),
                        ])}
                    </ul>
                )}
                <p className="dsh-mf-verifyQuota">{t('verifyQuota')}</p>
            </Modal>
            {/* 「探测式填充」弹层：没有候选列表——范围由两个键与「忽略排除」开关决定，故正文依次是
                记录区（首次发起才出现，与验证同纪律）→ 额度提示 → 两个开关；
                footer 只留三键，直接吃宿主 .footer 的 flex-end 右对齐，不必自绘行容器。
                关窗（遮罩 / Escape / × / 关闭键）即中止在途探测，Node 半随即早停并把未跑完的模型还原 */}
            <Modal
                open={probeOpen}
                onClose={closeProbe}
                title={t('probeTitle')}
                closeLabel={t('close')}
                description={t('probeDesc')}
                className="dsh-mf-verifyDialog"
                footer={<div className="dsh-mf-verifyButtons">
                    {/* 关闭键在途不禁用：它是本弹层唯一的常驻出口，遮罩 / Escape / × 也都中止，
                        键却禁着就只剩「干等」一条路（验证那边有「停止」键顶替，故那边禁） */}
                    <Button variant="outline" data-modal-autofocus onClick={closeProbe}>{t('close')}</Button>
                    {/* 由宽到窄：先「全部」后「未填充」，两个键各带自己的模型数，
                        从大到小读下来就是这一轮的范围由大到小的收窄 */}
                    {probeButton('all', allCount)}
                    {probeButton('unfilled', unfilledCount)}
                </div>}
            >
                {/* 记录区在上、两行提示在下：记录是「正在发生的事」，提示是「这轮会做什么」，
                    顺序与阅读时机一致；反过来就成了在两段静态说明中间夹一块滚动区域 */}
                {probeTotal > 0 ? (
                    <TerminalBlock
                        command={t('probeCommand', { total: String(probeTotal) })}
                        output={probeLines.join('\n')}
                        running={busy === 'probe'}
                        maxLines={VERIFY_TERMINAL_LINES}
                        labels={probeTerminalLabels}
                        className="dsh-mf-verifyLog"
                    />
                ) : null}
                {/* 探测范围一句说清：两个数分别对应 footer 那两个键（全量 / 未填充），键文本保持短。
                    两个范围都为空时改说「为何为空」——用户多半是先把提供方排除了 */}
                {unfilledCount === 0 && allCount === 0 ? (
                    <p className="dsh-mf-verifyEmpty" role="status">{t('probeEmpty')}</p>
                ) : (
                    <p className="dsh-mf-verifyQuota">{t('probePlan', {
                        models: String(allCount),
                        unfilled: String(unfilledCount),
                    })}</p>
                )}
                <p className="dsh-mf-verifyQuota">{t('probeQuota')}</p>
                {/* 两个开关放正文末尾而非 footer：它们是这一轮的参数（探测范围与收敛口径），
                    与正文里正在发生的事同处一屏，改动即刻可见；footer 因此只剩「关闭 / 探测」，
                    与其余弹层「footer 只放取消与确认」的形态一致 */}
                <div className="dsh-mf-verifyOptions">
                    <span className="dsh-mf-verifyOption">
                        <Switch
                            checked={probeIgnoreExcludes}
                            disabled={busy === 'probe'}
                            label={t('probeIgnoreExcludes')}
                            onChange={toggleIgnoreExcludes}
                        />
                        <span>{t('probeIgnoreExcludes')}</span>
                        {/* 释义走宿主 Tooltip 原语，锚点复刻瓦片内的 .helpButton；portal 必需（模态层自建层叠上下文会裁掉气泡） */}
                        <Tooltip label={t('probeIgnoreExcludesTip')} side="top" maxWidth={TIP_MAX_WIDTH} portal>
                            <button type="button" className="dsh-mf-help" aria-label={t('probeIgnoreExcludesTip')}>
                                <IconInfoOutlineRegular size={12} />
                            </button>
                        </Tooltip>
                    </span>
                    <span className="dsh-mf-verifyOption">
                        <Switch
                            checked={probeDropUnsupported}
                            // 跑「未填充」时一并禁掉：这一轮压根不读它（见 runProbe），让开关显形地失效，
                            // 好过留一个亮着的开关骗人——用户在途时看得见这一轮是「只增不剔」
                            disabled={busy === 'probe' || probeScope === 'unfilled'}
                            label={t('probeDropUnsupported')}
                            onChange={setProbeDropUnsupported}
                        />
                        <span>{t('probeDropUnsupported')}</span>
                        <Tooltip label={t('probeDropUnsupportedTip')} side="top" maxWidth={TIP_MAX_WIDTH} portal>
                            <button type="button" className="dsh-mf-help" aria-label={t('probeDropUnsupportedTip')}>
                                <IconInfoOutlineRegular size={12} />
                            </button>
                        </Tooltip>
                    </span>
                </div>
            </Modal>
        </>
    )

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
                {dirty ? <Tag tone="neutral">{t('unsaved')}</Tag> : null}
                <CHEVRON_DOWN className={open ? 'dsh-mf-chevron dsh-mf-chevronOpen' : 'dsh-mf-chevron'} />
            </button>
            {notices}
            {open ? <div className="dsh-mf-body">{body}</div> : null}
            {confirms}
        </div>
    )
}
