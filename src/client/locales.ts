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
    forceFailed: '强制更新失败：{message}',
    reset: '重置推理级别',
    resetBusy: '重置中…',
    resetConfirm: '是否确认删除所有模型的推理级别？此操作无法撤销！',
    resetGo: '确认重置',
    resetDone: '已重置 {count} 个模型的推理级别。',
    resetFailed: '重置失败：{message}',
    restore: '恢复备份',
    restoreBusy: '恢复中…',
    restoreConfirm: '是否把模型配置恢复到插件启动前？',
    restoreGo: '确认恢复',
    restoreDone: '已恢复 {count} 个模型。',
    restoreFailed: '恢复失败：{message}',
    clearEffortsTitle: '清空推理级别记忆',
    clearEffortsConfirm: '关闭后不再记住新的推理级别，已记住的仍会自动恢复。是否现在清空这些已记住的级别？',
    clearEffortsKeep: '保留',
    clearEffortsGo: '清空',
    clearEffortsDone: '已清空推理级别记忆。',
    clearEffortsFailed: '清空记忆失败，已记住的级别仍在。',
    loading: '正在读取配置…',
    unavailable: '配置不可用（未检测到插件的宿主服务）',
    readOnly: '当前环境为只读，无法保存',
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
    forceFailed: 'Force update failed: {message}',
    reset: 'Reset reasoning efforts',
    resetBusy: 'Resetting…',
    resetConfirm: 'Confirm removal of reasoning efforts for all models? This cannot be undone!',
    resetGo: 'Reset',
    resetDone: 'Reset reasoning efforts for {count} model(s).',
    resetFailed: 'Reset failed: {message}',
    restore: 'Restore backup',
    restoreBusy: 'Restoring…',
    restoreConfirm: 'Restore model configuration to the state before plugin startup?',
    restoreGo: 'Restore',
    restoreDone: 'Restored {count} model(s).',
    restoreFailed: 'Restore failed: {message}',
    clearEffortsTitle: 'Clear remembered efforts',
    clearEffortsConfirm: 'While turned off, new levels are no longer remembered, but the ones already remembered keep auto-restoring. Clear the remembered levels now?',
    clearEffortsKeep: 'Keep',
    clearEffortsGo: 'Clear',
    clearEffortsDone: 'Remembered efforts cleared.',
    clearEffortsFailed: 'Failed to clear remembered efforts.',
    loading: 'Loading settings…',
    unavailable: 'Settings unavailable (host plugin service not found)',
    readOnly: 'Read-only environment; cannot save',
    star: 'Star',
    feedback: 'Feedback',
    issueBody: '--Describe the problem in one sentence--\n\n### What happened\n\n### Environment\n- Plugin version: {version}\n- DSH version: --e.g. 0.2.0--\n- OS: --e.g. Windows 11--\n\n### Steps to reproduce\n1. --What you did first--\n2. --What you did next--\n\n### Expected behavior',
}
