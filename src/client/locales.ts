/**
 * 卡片文案词典（浏览器半）。CARD_NS 并入 ui-slots 的 LocaleNamespaceMap 类型表，
 * 注册 slot 时声明 `locale: CARD_NS`，组件即可得到类型化的 `t`。
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** 卡片词典命名空间 */
export const CARD_NS = 'settings.modelReasoning'

/** 卡片文案键集合 */
export type CardKey =
    | 'title'
    | 'description'
    | 'colAutoFill'
    | 'colAllowUpdate'
    | 'masterAll'
    | 'hintAutoFill'
    | 'hintAllowUpdate'
    | 'rowReasoning'
    | 'rowContext'
    | 'rowImage'
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
        'settings.modelReasoning': CardKey
    }
}

/** 行/列键的展示文案映射（组件按 FIELD_KEYS / 列枚举取键） */
export const ROW_KEYS: Record<'reasoning' | 'context' | 'image', CardKey> = {
    reasoning: 'rowReasoning',
    context: 'rowContext',
    image: 'rowImage',
}

/** 列名键映射 */
export const COLUMN_KEYS: Record<'autoFill' | 'allowUpdate', CardKey> = {
    autoFill: 'colAutoFill',
    allowUpdate: 'colAllowUpdate',
}

/** 配置组释义键映射（瓦片展开体首行） */
export const HINT_KEYS: Record<'autoFill' | 'allowUpdate', CardKey> = {
    autoFill: 'hintAutoFill',
    allowUpdate: 'hintAllowUpdate',
}

export const zh: Record<CardKey, string> = {
    title: '模型参数填充',
    description: '控制自定义提供商模型的参数自动填充与按 models.dev 同步。',
    colAutoFill: '自动填充',
    colAllowUpdate: '允许更新',
    masterAll: '全部',
    hintAutoFill: '该参数空缺时自动填充',
    hintAllowUpdate: '按 models.dev 数据同步该参数：空缺时补填，不一致时覆盖',
    rowReasoning: '推理级别',
    rowContext: '上下文与输出',
    rowImage: '图片输入',
    save: '保存',
    saving: '保存中…',
    saveDone: '配置已保存。',
    discard: '放弃修改',
    unsaved: '未保存',
    expand: '展开设置',
    collapse: '收起设置',
    force: '强制更新',
    forceBusy: '更新中…',
    forceConfirm: '将按 models.dev 目录当前值强制覆盖模型参数（可能覆盖手动配置的参数）。',
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
    description: 'Controls auto-fill of custom provider model fields and syncing them with models.dev.',
    colAutoFill: 'Auto fill',
    colAllowUpdate: 'Allow update',
    masterAll: 'all',
    hintAutoFill: 'Auto-fills the parameter when it is missing',
    hintAllowUpdate: 'Syncs the parameter with models.dev data: fills it when missing, overwrites when different',
    rowReasoning: 'Reasoning efforts',
    rowContext: 'Context & output',
    rowImage: 'Image input',
    save: 'Save',
    saving: 'Saving…',
    saveDone: 'Settings saved.',
    discard: 'Discard',
    unsaved: 'Unsaved',
    expand: 'Show settings',
    collapse: 'Hide settings',
    force: 'Force update',
    forceBusy: 'Updating…',
    forceConfirm: 'Overwrite model parameters with current models.dev catalog values (manual configuration may be overwritten).',
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
