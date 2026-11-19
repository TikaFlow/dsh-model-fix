import { useId, useRef, useState } from 'react'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { EXCLUDE_ID_PATTERN, GROUP_KEYS, groupValue, masterValue } from '@/client/model'
import type { Flags, Group, RowKey } from '@/client/model'
import { LOCAL_FLAG_IDS } from '@/client/local-settings'
import type { LocalFlags, LocalFlagId } from '@/client/local-settings'
import type { CardKey } from '@/client/locale-keys'
import { COLUMN_KEYS, HINT_KEYS, LOCAL_ROW_KEYS, LOCAL_TIP_KEYS, ROW_KEYS, TIP_KEYS } from '@/client/locale-keys'
import { TIP_MAX_WIDTH } from '@/client/card-styles'

const CHEVRON_DOWN = primitives.IconChevronDownOutlineRegular
const { Pill, Switch, Tag, StateDot, Tooltip, IconInfoOutlineRegular, IconTrashOutlineRegular } = primitives

type TileTranslate = TranslateNS<'settings.modelFix'>

/** 组内行数（真键 + 恒定展示行）达此值即改用 Pill 胶囊 */
const PILL_THRESHOLD = 5

/** 恒定不可改的展示行（「插件管理」）：不绑配置键，组总控、草稿、脏检测都看不见它 */
interface LockedRow {
    label: CardKey
    tip: CardKey
}

interface MatrixRow {
    id: string
    label: CardKey
    tip: CardKey
    checked: boolean
    disabled: boolean
    onToggle: () => void
}

function RowMatrix(props: {
    groupId: string
    title: string
    master: boolean
    disabled: boolean
    open: boolean
    hint: string
    lockedRows: readonly LockedRow[]
    rows: readonly MatrixRow[]
    t: TileTranslate
    onToggle: () => void
    onMaster: () => void
}) {
    const { t, open, lockedRows, rows } = props
    const uid = useId()
    const id = `${uid}-${props.groupId}`
    const usePills = lockedRows.length + rows.length >= PILL_THRESHOLD
    return (
        <div className="dsh-mf-item" role="group" data-open={open ? 'true' : undefined} aria-labelledby={`${id}-title`}>
            <div className="dsh-mf-itemHead">
                <button
                    type="button"
                    className="dsh-mf-itemToggle"
                    aria-expanded={open}
                    aria-controls={open ? `${id}-body` : undefined}
                    aria-labelledby={`${id}-title`}
                    onClick={props.onToggle}
                />
                <strong className="dsh-mf-itemTitle" id={`${id}-title`}>{props.title}</strong>
                <span className="dsh-mf-itemTrailing">
                    <Switch
                        className="dsh-mf-itemSwitch"
                        checked={props.master}
                        disabled={props.disabled}
                        label={`${props.title} ${t('masterAll')}`}
                        onChange={props.onMaster}
                    />
                    <CHEVRON_DOWN size={12} className="dsh-mf-itemChevron" />
                </span>
            </div>
            {open ? (
                <div className="dsh-mf-itemBody" id={`${id}-body`}>
                    <p className="dsh-mf-itemHint">{props.hint}</p>
                    {usePills ? (
                        <div className="dsh-mf-pillGroup" role="group" aria-label={`${props.title} ${t('masterAll')}`}>
                            {/* 宿主 Pill 不 forwardRef，Tooltip.cloneElement 注入的 ref 到不了 Pill 内部，
                                故每颗 pill 都用 span 承接 ref 锚点（两种行共用此写法） */}
                            {lockedRows.map((row) => (
                                <Tooltip key={row.label} label={t(row.tip)} side="top" maxWidth={TIP_MAX_WIDTH} portal>
                                    <span>
                                        <Pill active className="dsh-mf-pillLocked">{t(row.label)}</Pill>
                                    </span>
                                </Tooltip>
                            ))}
                            {rows.map((row) => (
                                <Tooltip key={row.id} label={t(row.tip)} side="top" maxWidth={TIP_MAX_WIDTH} portal>
                                    <span>
                                        <Pill
                                            active={row.checked}
                                            aria-pressed={row.checked}
                                            disabled={row.disabled}
                                            onClick={row.onToggle}
                                        >
                                            {t(row.label)}
                                        </Pill>
                                    </span>
                                </Tooltip>
                            ))}
                        </div>
                    ) : (
                        <>
                            {lockedRows.map((row) => (
                                <div key={row.label} className="dsh-mf-itemRow">
                                    <span className="dsh-mf-itemLabelGroup">
                                        <span className="dsh-mf-itemLabel">{t(row.label)}</span>
                                        <Tooltip label={t(row.tip)} side="top" maxWidth={TIP_MAX_WIDTH} portal>
                                            <button type="button" className="dsh-mf-help" aria-label={t(row.tip)}>
                                                <IconInfoOutlineRegular size={12} />
                                            </button>
                                        </Tooltip>
                                    </span>
                                    <Switch checked disabled label={`${t(row.label)} ${props.title}`} onChange={() => { /* 恒定展示行，无配置可写 */ }} />
                                </div>
                            ))}
                            {rows.map((row) => (
                                <div key={row.id} className="dsh-mf-itemRow">
                                    <span className="dsh-mf-itemLabelGroup">
                                        <span className="dsh-mf-itemLabel">{t(row.label)}</span>
                                        {/* 设置项释义用宿主 Tooltip 原语（锚点形态照官方 settings-form .helpButton）。portal 必需：
                                            瓦片 overflow:hidden 加 box-shadow 构成的层叠上下文会把气泡裁掉 */}
                                        <Tooltip label={t(row.tip)} side="top" maxWidth={TIP_MAX_WIDTH} portal>
                                            <button type="button" className="dsh-mf-help" aria-label={t(row.tip)}>
                                                <IconInfoOutlineRegular size={12} />
                                            </button>
                                        </Tooltip>
                                    </span>
                                    <Switch
                                        checked={row.checked}
                                        disabled={row.disabled}
                                        label={`${t(row.label)} ${props.title}`}
                                        onChange={row.onToggle}
                                    />
                                </div>
                            ))}
                        </>
                    )}
                </div>
            ) : null}
        </div>
    )
}

export function GroupTile(props: {
    group: Group
    t: TileTranslate
    flags: Flags
    open: boolean
    disabled: boolean
    onToggle: () => void
    onMaster: () => void
    onCell: (key: RowKey) => void
}) {
    const { group, t, flags } = props
    return (
        <RowMatrix
            groupId={group}
            t={t}
            title={t(COLUMN_KEYS[group])}
            hint={t(HINT_KEYS[group])}
            master={masterValue(flags, group)}
            disabled={props.disabled}
            open={props.open}
            lockedRows={[]}
            rows={GROUP_KEYS[group].map((key) => ({
                id: key,
                label: ROW_KEYS[key],
                tip: TIP_KEYS[key],
                checked: groupValue(flags, group, key),
                disabled: props.disabled,
                onToggle: () => { props.onCell(key) },
            }))}
            onToggle={props.onToggle}
            onMaster={props.onMaster}
        />
    )
}

/** 点一下立即生效：无草稿、不受 writable 门控 */
export function LocalTile(props: {
    t: TileTranslate
    flags: LocalFlags
    open: boolean
    onToggle: () => void
    onMaster: () => void
    onCell: (id: LocalFlagId) => void
}) {
    const { t, flags } = props
    return (
        <RowMatrix
            groupId="local"
            t={t}
            title={t('colLocal')}
            hint={t('hintLocal')}
            master={LOCAL_FLAG_IDS.every((id) => flags[id])}
            disabled={false}
            open={props.open}
            lockedRows={[{ label: 'rowShowInPluginManager', tip: 'tipShowInPluginManager' }]}
            rows={LOCAL_FLAG_IDS.map((id) => ({
                id,
                label: LOCAL_ROW_KEYS[id],
                tip: LOCAL_TIP_KEYS[id],
                checked: flags[id],
                disabled: false,
                onToggle: () => { props.onCell(id) },
            }))}
            onToggle={props.onToggle}
            onMaster={props.onMaster}
        />
    )
}

/** 「排除提供方」瓦片：动态集合而非布尔矩阵；summary 尾区为「N 命中」徽标，命中即该 id 存在于宿主 user 层。
 * 可先写尚未创建的提供方 id，待其创建后即生效。 */
export function ExcludesTile(props: {
    t: TileTranslate
    flags: Flags
    hits: ReadonlySet<string>
    open: boolean
    disabled: boolean
    onToggle: () => void
    onAdd: (id: string) => void
    onRemove: (id: string) => void
}) {
    const { t, open } = props
    const uid = useId()
    const id = `${uid}-excludes`
    const title = t('colExcludes')
    const [text, setText] = useState('')
    const [error, setError] = useState<CardKey | undefined>()
    const errorId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const commit = () => {
        const value = text.trim()
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
        inputRef.current?.focus()
    }
    return (
        <div className="dsh-mf-item" role="group" data-open={open ? 'true' : undefined} aria-labelledby={`${id}-title`}>
            <div className="dsh-mf-itemHead">
                <button
                    type="button"
                    className="dsh-mf-itemToggle"
                    aria-expanded={open}
                    aria-controls={open ? `${id}-body` : undefined}
                    aria-labelledby={`${id}-title`}
                    onClick={props.onToggle}
                />
                <strong className="dsh-mf-itemTitle" id={`${id}-title`}>{title}</strong>
                <span className="dsh-mf-itemTrailing">
                    {/* 官方 trailing 结构：[状态点][状态胶囊]，点在胶囊外；summary 的点纯装饰（徽标文字已带语义） */}
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
                        aria-describedby={error !== undefined ? errorId : undefined}
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
                    {error !== undefined ? <p className="dsh-mf-fieldError" id={errorId} role="alert">{t(error)}</p> : null}
                    {props.flags.excludes.map((excluded) => {
                        const hit = props.hits.has(excluded)
                        const stateText = t(hit ? 'excludeHit' : 'excludeUnmatched')
                        return (
                            <div key={excluded} className="dsh-mf-tagRow">
                                {hit ? <StateDot state="done" size={7} /> : null}
                                <Tag tone={hit ? 'success' : 'neutral'} className="dsh-mf-tag">
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
