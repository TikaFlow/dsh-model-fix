/**
 * 本插件三个配置席位中两个的 SlotMap 键（本地结构复制，type-only，构建期擦除）：
 * - `plugins.bundle.config`（0.1.6+ 插件管理页「已安装」组里本 bundle 详情页的配置段）原声明在
 *   @deepseek-ai/dsh-client-ui-plugin-manager，该包不在宿主模块表基线内（值导入会被构建纯度门禁拦下、
 *   运行期 require 亦不命中）⇒ 不引依赖、本地复制；
 * - `settings.plugin.item`（旧宿主「设置 → 插件 → 插件配置」的可配置插件卡）原声明在
 *   @deepseek-ai/dsh-client-ui-settings-plugins@0.1.2-rc.1；该包 0.1.6 起把官方配置页改注册进
 *   插件管理页、自身不再声明任何 SlotMap 键 ⇒ 旧席位键也改由本文件声明。
 * 两处与宿主 dsh-client-ui-plugin-manager 及 dsh-client-ui-settings-plugins@0.1.2-rc.1 的
 * lib/types/client/slot-contract.d.ts 逐字对齐，升宿主须复核。
 * 旧席位在新宿主上因无声明方而经 slots.inject 空转（卡片不出现），属预期。
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/**
 * 配置条目被页面索取的视图：`summary` 只渲染一行简介，`page` 渲染带保存控件的表单。
 * 宿主对 `plugins.bundle.config` 恒传 `page`；本插件不据其分支渲染——三席统一走卡片外壳（见 card.tsx）。
 */
export interface PluginConfigViewProps {
    /** `summary` 只渲染一行简介（页面把它放在标题下）；`page` 渲染表单本体 */
    readonly view: 'summary' | 'page'
}

/** 可配置插件卡槽的 owner props（该 section 不提供 owner props，与宿主声明一致） */
interface SettingsPluginItemOwnerProps {
    /** 标记字段：卡片的 owner props 有意为空 */
    children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /**
         * 一个已安装 bundle 自己的配置：以 bundle 的 **npm 包名**（profile manifest 的依赖键，
         * 不是 patch 的条目 id）为 key，渲在该 bundle 详情页的描述与 rows 之间；页面恒传 `view: 'page'`。
         */
        'plugins.bundle.config': {
            kind: 'keyed'
            scope: 'root'
            owner: PluginConfigViewProps
        }
        /** 插件配置选项卡内的一张插件卡（仅 0.1.2 系列宿主声明），以配置命名空间为 key */
        'settings.plugin.item': {
            kind: 'keyed'
            scope: 'root'
            owner: SettingsPluginItemOwnerProps
        }
    }
}
