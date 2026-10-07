/**
 * 「验证模型」弹层（浏览器半）：候选列表 + 实时记录区 + 底部动作行。
 *
 * 结构逐条照官方 models 页「获取可用模型」的候选框（title / desc / 候选列表 / 底部取消 + 采用），
 * 按需求去掉其「搜索 — 全选」工具条一行；改为列表下方一条 warn 额度提示，底部左侧加「验证推理级别」开关。
 *
 * 抽出来的理由：弹层是一块自足的展示，它的所有状态与动作都由卡片经 props 递进来
 * （勾选集、档位开关、记录区内容、发跑与中止的回调），自己不碰 Connection 也不发起探测。
 * 留在卡片里只会让那个已经很长的组件再长一百行，且弹层的形态改动（列表密度、记录区位置）
 * 与卡片的状态机毫无关系。关窗（遮罩 / Escape / ×）即中止在途验证这条纪律记在 props 上。
 */

import { useMemo } from 'react'
// primitives 由宿主模块表注入
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { TerminalBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { TIP_MAX_WIDTH, VERIFY_TERMINAL_LINES } from '@/client/card-styles'
import { groupAllPicked, verifyKey } from '@/client/model'
import type { VerifyCandidate } from '@/client/model'

const { Button, Modal, StateDot, Switch, TerminalBlock, Tooltip, IconInfoOutlineRegular } = primitives

/** 按提供方归组后的候选：一组 = 一个提供方 + 它的候选模型（组内顺序即录入顺序） */
export interface VerifyGroup {
    readonly provider: string
    readonly models: readonly VerifyCandidate[]
}

export interface VerifyDialogProps {
    t: TranslateNS<'settings.modelFix'>
    open: boolean
    /** 关窗即中止在途验证：连接一断，Node 半的执行循环随即早停，不会在用户离开之后继续烧额度 */
    onClose: () => void
    /** 在途（卡片 busy 判为 verify）：键就地变「停止」，列表与开关全禁 */
    running: boolean
    /** 无任何动作在途（卡片 busy 为空）：与「未勾选任何模型」一同决定发起键是否可点 */
    idle: boolean
    /** 候选按提供方归组；传原始候选也行，本层自会归组（归组是纯展示关切） */
    candidates: readonly VerifyCandidate[]
    picked: ReadonlySet<string>
    onTogglePick: (key: string) => void
    onToggleGroup: (models: readonly VerifyCandidate[]) => void
    efforts: boolean
    onEffortsChange: (efforts: boolean) => void
    /** 记录区抬头：总项数取自 opened 帧；0 意味还没发起过，故记录区整块不渲染 */
    total: number
    lines: readonly string[]
    terminalLabels: TerminalBlockLabels
    onRun: () => void
    onStop: () => void
}

export function VerifyDialog(props: VerifyDialogProps) {
    const t = props.t
    // 按提供方归组渲染：候选本就是「提供方内聚」的录入顺序，取相邻同提供方成组即可，无需再分桶
    const groups = useMemo<VerifyGroup[]>(() => {
        const grouped: { provider: string; models: VerifyCandidate[] }[] = []
        for (const candidate of props.candidates) {
            const last = grouped[grouped.length - 1]
            if (last !== undefined && last.provider === candidate.provider) last.models.push(candidate)
            else grouped.push({ provider: candidate.provider, models: [candidate] })
        }
        return grouped
    }, [props.candidates])
    return (
        <Modal
            open={props.open}
            onClose={props.onClose}
            title={t('verifyTitle')}
            closeLabel={t('close')}
            description={t('verifyDesc')}
            className="dsh-mf-verifyDialog"
            footer={
                /* 宿主 .footer 是单行 flex、无 wrap、且 justify-content 为 flex-end。弹层加宽后档位开关与两键
                    并排同一行、开关靠左两键靠右，故在 footer 内自绘容器覆盖宿主那三个数值。
                    记录区不在这一行下方——它已移入正文，与探测弹层同序（提示之下、开关之上） */
                <div className="dsh-mf-verifyActions">
                    <span className="dsh-mf-verifyOption">
                        <Switch
                            checked={props.efforts}
                            disabled={props.running}
                            label={t('verifyEfforts')}
                            onChange={props.onEffortsChange}
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
                        <Button variant="outline" data-modal-autofocus disabled={props.running} onClick={props.onClose}>{t('cancel')}</Button>
                        <Button
                            variant="outline"
                            className="dsh-mf-warn"
                            disabled={props.idle && props.picked.size === 0}
                            onClick={props.running ? props.onStop : props.onRun}
                        >
                            {/* 在途指示：宿主 Button 自身即 inline-flex + gap，指示器直接作首个子节点；
                                StateDot 的 ongoing 态就是侧边栏会话列表项左侧那个转圈（同原语、同动效） */}
                            {props.running ? <StateDot state="ongoing" /> : null}
                            {t(props.running ? 'verifyStop' : 'verifyGo')}
                        </Button>
                    </div>
                </div>
            }
        >
            {/* 正文各段的纵向间距一律 12px，由这层容器给出：宿主 .body 无 gap、段靠自身 margin，
                而 flex 容器里 margin 不折叠、紧挨两段会相加，逐处自给必然算错 */}
            <div className="dsh-mf-verifyBody">
                {groups.length === 0 ? (
                    <p className="dsh-mf-verifyEmpty" role="status">{t('verifyEmpty')}</p>
                ) : (
                    <ul className="dsh-mf-verifyList">
                        {groups.map((group) => [
                            <li key={`g-${group.provider}`} className="dsh-mf-verifyGroup">
                                {group.provider}
                                {/* 分组全选键：组件、尺寸与文案语义逐条照官方 candidateToolbar 的 ghost 小键 */}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="dsh-mf-verifyGroupAll"
                                    disabled={props.running}
                                    onClick={() => { props.onToggleGroup(group.models) }}
                                >
                                    {groupAllPicked(props.picked, group.models) ? t('verifyDeselectAll') : t('verifySelectAll')}
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
                                                checked={props.picked.has(key)}
                                                disabled={props.running}
                                                onChange={() => { props.onTogglePick(key) }}
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
                {/* 记录区排在提示之下：它是「正在发生的事」，提示是「这轮会做什么」，
                    两者挨着放才读得顺。首次发起才出现——opened 帧一到即有总项数，先于此则没有任何进度可展示 */}
                {props.total > 0 ? (
                    <TerminalBlock
                        command={t('verifyCommand', { total: String(props.total) })}
                        output={props.lines.join('\n')}
                        running={props.running}
                        maxLines={VERIFY_TERMINAL_LINES}
                        labels={props.terminalLabels}
                        className="dsh-mf-verifyLog"
                    />
                ) : null}
            </div>
        </Modal>
    )
}