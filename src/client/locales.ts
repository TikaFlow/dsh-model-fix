/**
 * 卡片文案词典（浏览器半）。CARD_NS 并入 ui-slots 的 LocaleNamespaceMap 类型表，
 * 注册 slot 时声明 `locale: CARD_NS`，组件即可得到类型化的 `t`。
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { Group, RowKey } from './model'

/** 卡片词典命名空间 */
export const CARD_NS = 'settings.modelFix'

/** 卡片文案键集合 */
export type CardKey =
    | 'title'
    | 'description'
    | 'colAutoFill'
    | 'colAllowUpdate'
    | 'colCompat'
    | 'colExcludes'
    | 'masterAll'
    | 'hintAutoFill'
    | 'hintAllowUpdate'
    | 'hintCompat'
    | 'hintExcludes'
    | 'rowReasoning'
    | 'rowContext'
    | 'rowImage'
    | 'rowDisableDeveloper'
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
    | 'discard'
    | 'unsaved'
    | 'expand'
    | 'collapse'
    | 'force'
    | 'forceBusy'
    | 'forceConfirm'
    | 'forceCancel'
    | 'forceGo'
    | 'close'
    | 'forceDone'
    | 'forceNone'
    | 'forceFailed'
    | 'loading'
    | 'unavailable'
    | 'readOnly'

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
}

/** 配置组（瓦片）标题键映射 */
export const COLUMN_KEYS: Record<Group, CardKey> = {
    autoFill: 'colAutoFill',
    allowUpdate: 'colAllowUpdate',
    compat: 'colCompat',
}

/** 配置组释义键映射（瓦片展开体首行） */
export const HINT_KEYS: Record<Group, CardKey> = {
    autoFill: 'hintAutoFill',
    allowUpdate: 'hintAllowUpdate',
    compat: 'hintCompat',
}

export const zh: Record<CardKey, string> = {
    title: '模型参数填充',
    description: '配置提供方模型的参数填充、同步、兼容性与排除行为。',
    colAutoFill: '自动填充',
    colAllowUpdate: '允许更新',
    colCompat: '兼容性',
    colExcludes: '排除提供方',
    masterAll: '全部',
    hintAutoFill: '该参数空缺时自动填充',
    hintAllowUpdate: '按 models.dev 数据同步该参数：空缺时补填，不一致时覆盖',
    hintCompat: '调整与旧版 API 的兼容行为，作用于所有 openai-completions 提供方',
    hintExcludes: '列出的提供方本插件不做任何操作。排除仅在保存后生效，不会撤销此前已写入的内容。',
    rowReasoning: '推理级别',
    rowContext: '上下文与输出',
    rowImage: '图片输入',
    rowDisableDeveloper: '不使用 developer 角色',
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
    discard: '放弃修改',
    unsaved: '未保存',
    expand: '展开设置',
    collapse: '收起设置',
    force: '强制更新',
    forceBusy: '更新中…',
    forceConfirm: '将按 models.dev 目录当前值覆盖模型参数，此操作无法撤销。',
    forceCancel: '取消',
    forceGo: '确认更新',
    close: '关闭',
    forceDone: '已强制更新 {count} 个模型。',
    forceNone: '目录值与现有配置一致，无需变更。',
    forceFailed: '强制更新失败：{message}',
    loading: '正在读取配置…',
    unavailable: '配置不可用（未检测到插件的宿主服务）',
    readOnly: '当前环境为只读，无法保存',
}

export const en: Record<CardKey, string> = {
    title: 'Model field auto-fill',
    description: 'Configures how the plugin fills, syncs, and applies compatibility to provider models, and which providers to exclude.',
    colAutoFill: 'Auto fill',
    colAllowUpdate: 'Allow update',
    colCompat: 'Compatibility',
    colExcludes: 'Excluded providers',
    masterAll: 'all',
    hintAutoFill: 'Auto-fills the parameter when it is missing',
    hintAllowUpdate: 'Syncs the parameter with models.dev data: fills it when missing, overwrites when different',
    hintCompat: 'Adjusts compatibility with older APIs; applies to all openai-completions providers',
    hintExcludes: 'The plugin performs no operation at all on the listed providers. Exclusions take effect only after saving and never revert fields already written.',
    rowReasoning: 'Reasoning efforts',
    rowContext: 'Context & output',
    rowImage: 'Image input',
    rowDisableDeveloper: 'Never use the developer role',
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
    discard: 'Discard',
    unsaved: 'Unsaved',
    expand: 'Show settings',
    collapse: 'Hide settings',
    force: 'Force update',
    forceBusy: 'Updating…',
    forceConfirm: 'Overwrites model parameters with current models.dev catalog values. This cannot be undone.',
    forceCancel: 'Cancel',
    forceGo: 'Update',
    close: 'Close',
    forceDone: 'Force-updated {count} model(s).',
    forceNone: 'Catalog values match; nothing to update.',
    forceFailed: 'Force update failed: {message}',
    loading: 'Loading settings…',
    unavailable: 'Settings unavailable (host plugin service not found)',
    readOnly: 'Read-only environment; cannot save',
}
