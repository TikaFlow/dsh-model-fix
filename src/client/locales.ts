/**
 * 卡片文案词典（浏览器半）。CARD_NS 并入 ui-slots 的 LocaleNamespaceMap 类型表，
 * 注册 slot 时声明 `locale: CARD_NS`，组件即可得到类型化的 `t`。
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { Group, RowKey } from '@/client/model'

/** 卡片词典命名空间 */
export const CARD_NS = 'settings.modelFix'

/** 卡片文案键集合 */
export type CardKey =
    | 'title'
    | 'tabLabel'
    | 'description'
    | 'colAutoFill'
    | 'colAllowUpdate'
    | 'colCompat'
    | 'colExcludes'
    | 'colUserExperience'
    | 'masterAll'
    | 'hintAutoFill'
    | 'hintAllowUpdate'
    | 'hintCompat'
    | 'hintExcludes'
    | 'hintUserExperience'
    | 'rowReasoning'
    | 'rowContext'
    | 'rowImage'
    | 'rowDisableDeveloper'
    | 'rowRememberEfforts'
    | 'rowDefaultHigh'
    | 'rowForgetRemoved'
    | 'tipReasoning'
    | 'tipContext'
    | 'tipImage'
    | 'tipDisableDeveloper'
    | 'tipRememberEfforts'
    | 'tipDefaultHigh'
    | 'tipForgetRemoved'
    | 'excludePlaceholder'
    | 'excludeAdd'
    | 'excludeInvalid'
    | 'excludeDuplicate'
    | 'excludeHits'
    | 'excludeHit'
    | 'excludeUnmatched'
    | 'excludeRemove'
    | 'save'
    | 'saving'
    | 'saveDone'
    | 'cancel'
    | 'unsaved'
    | 'expand'
    | 'collapse'
    | 'force'
    | 'forceBusy'
    | 'forceConfirm'
    | 'forceGo'
    | 'close'
    | 'forceDone'
    | 'forceNone'
    | 'forceFailed'
    | 'reset'
    | 'resetBusy'
    | 'resetConfirm'
    | 'resetGo'
    | 'resetDone'
    | 'resetFailed'
    | 'restore'
    | 'restoreBusy'
    | 'restoreConfirm'
    | 'restoreGo'
    | 'restoreDone'
    | 'restoreFailed'
    | 'verify'
    | 'verifyTitle'
    | 'verifyDesc'
    | 'verifyQuota'
    | 'verifyEfforts'
    | 'verifyEffortsTip'
    | 'verifyGo'
    | 'verifyStop'
    | 'verifySelectAll'
    | 'verifyDeselectAll'
    | 'verifyEmpty'
    | 'verifyCommand'
    | 'verifyLine'
    | 'verifyLinePlain'
    | 'verifyLineProvider'
    | 'verifySkipped'
    | 'verifyOutUsable'
    | 'verifyOutUnsupported'
    | 'verifyOutUnreachable'
    | 'verifyOutQuota'
    | 'verifyOutCredential'
    | 'verifyOutRateLimit'
    | 'verifyOutTimeout'
    | 'verifyOutOther'
    | 'verifyStopped'
    | 'verifyDoneAll'
    | 'verifyDoneLowest'
    | 'verifyFailed'
    | 'verifyFinished'
    | 'pruneTitle'
    | 'pruneConfirm'
    | 'pruneGo'
    | 'pruneDone'
    | 'pruneFailed'
    // 宿主 TerminalBlock 的展示文案：键名与 terminalLabels(t) 逐条对齐官方安装页的映射（ui-plugin-manager/…/locales.ts:152-164）
    | 'terminalSignal'
    | 'terminalExitCode'
    | 'terminalNoExitCode'
    | 'terminalRunning'
    | 'terminalFailed'
    | 'terminalDone'
    | 'terminalCopy'
    | 'terminalCopied'
    | 'terminalNoOutput'
    | 'terminalCollapseAria'
    | 'terminalCollapse'
    | 'terminalExpandAria'
    | 'terminalExpand'
    | 'clearEffortsTitle'
    | 'clearEffortsConfirm'
    | 'clearEffortsKeep'
    | 'clearEffortsGo'
    | 'clearEffortsDone'
    | 'clearEffortsFailed'
    | 'loading'
    | 'unavailable'
    | 'readOnly'
    | 'star'
    | 'feedback'
    | 'issueBody'

declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'settings.modelFix': CardKey
    }
}

/** 组内行键的展示文案映射（组件按 GROUP_KEYS 取键） */
export const ROW_KEYS: Record<RowKey, CardKey> = {
    reasoning: 'rowReasoning',
    context: 'rowContext',
    image: 'rowImage',
    disableDeveloper: 'rowDisableDeveloper',
    rememberEfforts: 'rowRememberEfforts',
    defaultHigh: 'rowDefaultHigh',
    forgetRemoved: 'rowForgetRemoved',
}

/** 配置组（瓦片）标题键映射 */
export const COLUMN_KEYS: Record<Group, CardKey> = {
    autoFill: 'colAutoFill',
    allowUpdate: 'colAllowUpdate',
    compat: 'colCompat',
    userExperience: 'colUserExperience',
}

/** 配置组释义键映射（瓦片展开体首行） */
export const HINT_KEYS: Record<Group, CardKey> = {
    autoFill: 'hintAutoFill',
    allowUpdate: 'hintAllowUpdate',
    compat: 'hintCompat',
    userExperience: 'hintUserExperience',
}

/** 行内设置项的 tooltip 释义键映射（瓦片展开体每行的帮助气泡） */
export const TIP_KEYS: Record<RowKey, CardKey> = {
    reasoning: 'tipReasoning',
    context: 'tipContext',
    image: 'tipImage',
    disableDeveloper: 'tipDisableDeveloper',
    rememberEfforts: 'tipRememberEfforts',
    defaultHigh: 'tipDefaultHigh',
    forgetRemoved: 'tipForgetRemoved',
}

export const zh: Record<CardKey, string> = {
    title: '模型参数填充',
    tabLabel: '模型填充',
    description: '配置提供方模型的参数填充、同步、兼容性、排除与推理级别记忆行为。',
    colAutoFill: '自动填充',
    colAllowUpdate: '允许更新',
    colCompat: '兼容性',
    colExcludes: '排除提供方',
    colUserExperience: '用户体验',
    masterAll: '全部',
    hintAutoFill: '该参数空缺时自动填充',
    hintAllowUpdate: '按 models.dev 数据同步该参数：空缺时补填，不一致时覆盖',
    hintCompat: '调整与旧版 API 的兼容行为，作用于所有 openai-completions 提供方',
    hintExcludes: '列出的提供方本插件不做任何操作。排除仅在保存后生效，不会撤销此前已写入的内容。',
    hintUserExperience: '调整插件的交互体验行为，对所有提供方一律生效，不排除任何提供方。',
    rowReasoning: '推理级别',
    rowContext: '上下文与输出',
    rowImage: '图片输入',
    rowDisableDeveloper: '不使用 developer 角色',
    rowRememberEfforts: '记住推理级别',
    rowDefaultHigh: '默认使用 high',
    rowForgetRemoved: '忘记已删除模型',
    tipReasoning: '该模型可选的推理档位（如 high、medium、low），写入后模型页才能选择推理级别。',
    tipContext: '模型的上下文窗口长度（contextWindow）与单次回复的输出上限（maxTokens）决定能装下多少历史、一次回答能有多长。',
    tipImage: '模型的输入模态。目录标注支持图片时写入 ["text","image"]，模型页即可选择图片模态。',
    tipDisableDeveloper: '禁用 developer 角色，系统提示退回旧版兼容的 system 角色。',
    tipRememberEfforts: '按模型记住你手动选择的推理级别，切换模型时自动恢复。',
    tipDefaultHigh: '切换到某模型时，若它未设推理级别、也没有它的记忆，且该模型支持 high，则自动设为 high。',
    tipForgetRemoved: '删除模型或提供方时，一并清除其推理级别记忆。',
    excludePlaceholder: 'acme-gateway',
    excludeAdd: '添加排除的提供方',
    excludeInvalid: '需以小写字母开头，之后可用小写字母、数字和短横线。',
    excludeDuplicate: '该提供方已在排除列表中。',
    excludeHits: '{count} 命中',
    excludeHit: '已命中：该提供方当前存在，本插件不对其做任何操作',
    excludeUnmatched: '未命中：暂无同名提供方，创建后即生效',
    excludeRemove: '从排除列表移除 {id}',
    save: '保存',
    saving: '保存中…',
    saveDone: '配置已保存。',
    cancel: '取消',
    unsaved: '未保存',
    expand: '展开设置',
    collapse: '收起设置',
    force: '强制更新',
    forceBusy: '更新中…',
    forceConfirm: '将按 models.dev 目录当前值覆盖模型参数，此操作无法撤销。',
    forceGo: '确认更新',
    close: '关闭',
    forceDone: '已强制更新 {count} 个模型。',
    forceNone: '目录值与现有配置一致，无需变更。',
    forceFailed: '强制更新失败：{message}。',
    reset: '重置推理级别',
    resetBusy: '重置中…',
    resetConfirm: '是否确认删除所有模型的推理级别？此操作无法撤销！',
    resetGo: '确认重置',
    resetDone: '已重置 {count} 个模型的推理级别。',
    resetFailed: '重置失败：{message}。',
    restore: '恢复备份',
    restoreBusy: '恢复中…',
    restoreConfirm: '是否把模型配置恢复到插件启动前？',
    restoreGo: '确认恢复',
    restoreDone: '已恢复 {count} 个模型。',
    restoreFailed: '恢复失败：{message}。',
    verify: '验证模型',
    verifyTitle: '选择要验证的模型',
    verifyDesc: '勾选后将逐个发起请求，确认提供方是否真的受理；验证所耗时间随模型数量增加。',
    verifyQuota: '验证会发起真实请求，可能消耗少量额度。',
    verifyEfforts: '验证推理级别',
    // 关档位不等于端点不推理——它可能有自己的默认级别，故措辞要说清「不发参数」而非「不验证」
    verifyEffortsTip: '开启后逐个验证模型声明的全部推理级别，请求数成倍增加；关闭时不携带推理级别，但这不代表端点不会推理——它可能有自己的默认级别。',
    verifyGo: '验证',
    verifyStop: '停止',
    // 分组全选文案照官方「获取可用模型」的 fetchSelectAll / fetchDeselectAll
    verifySelectAll: '全选',
    verifyDeselectAll: '取消全选',
    // 记录区逐行文案：provider 级失败不带模型与档位（那不是某个模型的问题），只交代整组结论。
    // 层级一律用冒号而非斜杠分隔——模型 id 本身就含斜杠（如 z-ai/glm-5），拿它当分隔符读不出层级
    verifyCommand: '验证 {total} 项',
    verifyLine: '{provider}: {model} @ {effort}：{result}',
    verifyLinePlain: '{provider}: {model}：{result}',
    verifyLineProvider: '{provider}：{result}',
    verifySkipped: '（已跳过 {count} 项）',
    verifyOutUsable: '可用',
    verifyOutUnsupported: '不支持该推理等级',
    verifyOutUnreachable: '无法连接',
    verifyOutQuota: '额度耗尽',
    verifyOutCredential: '凭据无效',
    verifyOutRateLimit: '触发限流，未得出结论',
    verifyOutTimeout: '超时，未得出结论',
    verifyOutOther: '不可用',
    verifyStopped: '已停止',
    // 收尾统计分两档，与档位开关的两种模式对应：
    // 关（verifyDoneLowest）报「勾选了几个 / 跑通了几个模型」——请求本就不带档位，没有级别可报；
    // 开（verifyDoneAll）报「勾选了几个模型 / 几个可用 / 几个计划」，分母取 plannedEfforts——
    // 没声明档位的模型验的是模型本身、不占级别，故 planned（含它那条）不能当分母。模型数一律取 tested
    // （计划里的去重模型数，而非 report.models 的可用模型数——全档位失败的模型不计入那个数，会让总数小于用户勾选数）
    verifyDoneAll: '{tested}个模型的{efforts} / {levels}个推理级别验证可用',
    verifyDoneLowest: '勾选{tested}个模型，其中{models}个可用',
    verifyFailed: '验证失败：{message}',
    // 收尾末行：逐条记录只交代过程，不交代「总共怎么样」，否则用户只能自己数末行才知道结论
    verifyFinished: '验证结束：{result}',
    // 剔除确认：只有明确判为「档位不支持」的才进这里；超时/限流/额度耗尽一概不算
    pruneTitle: '剔除不被支持的推理级别',
    pruneConfirm: '验证发现 {count} 个推理级别不被支持，是否从模型配置中剔除？',
    pruneGo: '剔除',
    pruneDone: '已剔除 {count} 个不被支持的推理级别。',
    pruneFailed: '剔除失败：{message}。',
    terminalSignal: '信号 {signal}',
    terminalExitCode: '退出码 {code}',
    terminalNoExitCode: '未正常退出',
    terminalRunning: '运行中',
    terminalFailed: '失败',
    terminalDone: '已完成',
    terminalCopy: '复制',
    terminalCopied: '复制成功',
    terminalNoOutput: '无输出',
    terminalCollapseAria: '收起输出',
    terminalCollapse: '收起',
    terminalExpandAria: '展开其余 {n} 行输出',
    terminalExpand: '… 其余 {n} 行',
    verifyEmpty: '暂无模型，请先在「模型」设置中添加模型。',
    clearEffortsTitle: '清空推理级别记忆',
    clearEffortsConfirm: '关闭后不再记住新的推理级别，已记住的仍会自动恢复。是否现在清空这些已记住的级别？',
    clearEffortsKeep: '保留',
    clearEffortsGo: '清空',
    clearEffortsDone: '已清空推理级别记忆。',
    clearEffortsFailed: '清空记忆失败，已记住的级别仍在。',
    loading: '正在读取配置…',
    unavailable: '配置不可用（未检测到插件的宿主服务）。',
    readOnly: '当前环境为只读，无法保存。',
    star: '点个 star',
    feedback: '问题反馈',
    issueBody: '--用一句话描述你遇到的问题--\n\n### 问题现象\n\n### 环境\n- 插件版本：{version}\n- DSH 版本：--如 0.2.0--\n- 操作系统：--如 Windows 11--\n\n### 复现步骤\n1. --第一步做了什么--\n2. --第二步做了什么--\n\n### 期望行为',
}

export const en: Record<CardKey, string> = {
    title: 'Model field auto-fill',
    tabLabel: 'Model fill',
    description: 'Configures how the plugin fills, syncs, and applies compatibility to provider models, which providers to exclude, and how reasoning efforts are remembered.',
    colAutoFill: 'Auto fill',
    colAllowUpdate: 'Allow update',
    colCompat: 'Compatibility',
    colExcludes: 'Excluded providers',
    colUserExperience: 'User experience',
    masterAll: 'all',
    hintAutoFill: 'Auto-fills the parameter when it is missing',
    hintAllowUpdate: 'Syncs the parameter with models.dev data: fills it when missing, overwrites when different',
    hintCompat: 'Adjusts compatibility with older APIs; applies to all openai-completions providers',
    hintExcludes: 'The plugin performs no operation at all on the listed providers. Exclusions take effect only after saving and never revert fields already written.',
    hintUserExperience: 'Adjusts the plugin interaction experience. Applies to all providers alike; excludes none.',
    rowReasoning: 'Reasoning efforts',
    rowContext: 'Context & output',
    rowImage: 'Image input',
    rowDisableDeveloper: 'Never use the developer role',
    rowRememberEfforts: 'Remember reasoning efforts',
    rowDefaultHigh: 'Default to high',
    rowForgetRemoved: 'Forget removed models',
    tipReasoning: 'The reasoning levels this model offers (e.g. high, medium, low); writing them is what lets the model page offer a reasoning-level choice.',
    tipContext: 'The model context window (contextWindow) and the per-response output cap (maxTokens) decide how much history fits and how long one answer can be.',
    tipImage: 'Input modalities of the model. When the catalog marks image support, ["text","image"] is written and the model page can offer the image modality.',
    tipDisableDeveloper: 'Disables the developer role; system prompts fall back to the older compatible system role.',
    tipRememberEfforts: 'Remembers the reasoning level you pick per model and restores it when you switch models.',
    tipDefaultHigh: 'When switching to a model that has no reasoning level set, no memory of it, and support for high, its level is set to high.',
    tipForgetRemoved: 'Deleting a model or a provider also clears its remembered reasoning levels.',
    excludePlaceholder: 'acme-gateway',
    excludeAdd: 'Add an excluded provider',
    excludeInvalid: 'Start with a lowercase letter; then lowercase letters, digits, and dashes.',
    excludeDuplicate: 'This provider is already excluded.',
    excludeHits: '{count} matched',
    excludeHit: 'Matched: this provider exists and the plugin performs no operation on it',
    excludeUnmatched: 'Not matched: no such provider yet; it takes effect once created',
    excludeRemove: 'Remove {id} from the exclusion list',
    save: 'Save',
    saving: 'Saving…',
    saveDone: 'Settings saved.',
    cancel: 'Cancel',
    unsaved: 'Unsaved',
    expand: 'Show settings',
    collapse: 'Hide settings',
    force: 'Force update',
    forceBusy: 'Updating…',
    forceConfirm: 'Overwrites model parameters with current models.dev catalog values. This cannot be undone.',
    forceGo: 'Update',
    close: 'Close',
    forceDone: 'Force-updated {count} model(s).',
    forceNone: 'Catalog values match; nothing to update.',
    forceFailed: 'Force update failed: {message}.',
    reset: 'Reset reasoning efforts',
    resetBusy: 'Resetting…',
    resetConfirm: 'Confirm removal of reasoning efforts for all models? This cannot be undone!',
    resetGo: 'Reset',
    resetDone: 'Reset reasoning efforts for {count} model(s).',
    resetFailed: 'Reset failed: {message}.',
    restore: 'Restore backup',
    restoreBusy: 'Restoring…',
    restoreConfirm: 'Restore model configuration to the state before plugin startup?',
    restoreGo: 'Restore',
    restoreDone: 'Restored {count} model(s).',
    restoreFailed: 'Restore failed: {message}.',
    verify: 'Verify models',
    verifyTitle: 'Choose models to verify',
    verifyDesc: 'Each chosen model gets a request to confirm the provider really accepts it; verification takes longer with more models.',
    verifyQuota: 'Verification sends real requests and may use a small amount of your quota.',
    verifyEfforts: 'Verify reasoning efforts',
    // Turning the switch off means "send no parameter", not "the endpoint will not reason"
    verifyEffortsTip: 'Verifies every reasoning effort the model declares, multiplying the request count; when off, no reasoning effort is sent — which does not mean the endpoint will not reason, as it may have its own default.',
    verifyGo: 'Verify',
    verifyStop: 'Stop',
    // Group select-all wording mirrors the official "Fetch available models" fetchSelectAll / fetchDeselectAll
    verifySelectAll: 'Select all',
    verifyDeselectAll: 'Deselect all',
    verifyEmpty: 'No models yet. Add models on the Models settings page first.',
    // Per-line log copy: provider-level failures carry no model/effort (not a per-model issue).
    // Levels are colon-separated rather than slash-separated — model ids themselves contain slashes (e.g. z-ai/glm-5)
    verifyCommand: 'Verify {total} item(s)',
    verifyLine: '{provider}: {model} @ {effort}: {result}',
    verifyLinePlain: '{provider}: {model}: {result}',
    verifyLineProvider: '{provider}: {result}',
    verifySkipped: '({count} skipped)',
    verifyOutUsable: 'usable',
    verifyOutUnsupported: 'reasoning effort not supported',
    verifyOutUnreachable: 'unreachable',
    verifyOutQuota: 'quota exhausted',
    verifyOutCredential: 'invalid credential',
    verifyOutRateLimit: 'rate limited, no conclusion',
    verifyOutTimeout: 'timed out, no conclusion',
    verifyOutOther: 'unavailable',
    verifyStopped: 'Stopped',
    // Closing stats come in two flavours, matching the two states of the effort switch: with it off the requests
    // carry no effort at all, so the line reports checked / usable models; with it on it reports checked models
    // plus usable / planned efforts, the denominator being plannedEfforts (models that declare no effort are
    // verified as models, so they do not occupy an effort slot). The model count is always tested (distinct
    // models in the plan), not report.models (usable models only, which drops models whose every effort failed)
    verifyDoneAll: '{efforts} / {levels} reasoning effort(s) across {tested} model(s) are usable',
    verifyDoneLowest: 'Checked {tested} model(s), {models} usable',
    verifyFailed: 'Verification failed: {message}',
    // Closing line: the per-probe log only narrates the run, so it never states the overall result
    verifyFinished: 'Verification finished: {result}',
    // Prune confirmation: only entries judged outright unsupported land here — timeouts, rate limits and
    // exhausted quota never do
    pruneTitle: 'Remove unsupported reasoning efforts',
    pruneConfirm: 'Verification found {count} reasoning effort(s) that are not supported. Remove them from the model configuration?',
    pruneGo: 'Remove',
    pruneDone: 'Removed {count} unsupported reasoning effort(s).',
    pruneFailed: 'Failed to remove: {message}.',
    terminalSignal: 'signal {signal}',
    terminalExitCode: 'exit code {code}',
    terminalNoExitCode: 'no exit code',
    terminalRunning: 'Running',
    terminalFailed: 'Failed',
    terminalDone: 'Done',
    terminalCopy: 'Copy',
    terminalCopied: 'Copied',
    terminalNoOutput: 'No output',
    terminalCollapseAria: 'Collapse output',
    terminalCollapse: 'Collapse',
    terminalExpandAria: 'Expand the remaining {n} output lines',
    terminalExpand: '… {n} more lines',
    clearEffortsTitle: 'Clear remembered efforts',
    clearEffortsConfirm: 'While turned off, new levels are no longer remembered, but the ones already remembered keep auto-restoring. Clear the remembered levels now?',
    clearEffortsKeep: 'Keep',
    clearEffortsGo: 'Clear',
    clearEffortsDone: 'Remembered efforts cleared.',
    clearEffortsFailed: 'Failed to clear remembered efforts.',
    loading: 'Loading settings…',
    unavailable: 'Settings unavailable (host plugin service not found).',
    readOnly: 'Read-only environment; cannot save.',
    star: 'Star',
    feedback: 'Feedback',
    issueBody: '--Describe the problem in one sentence--\n\n### What happened\n\n### Environment\n- Plugin version: {version}\n- DSH version: --e.g. 0.2.0--\n- OS: --e.g. Windows 11--\n\n### Steps to reproduce\n1. --What you did first--\n2. --What you did next--\n\n### Expected behavior',
}
