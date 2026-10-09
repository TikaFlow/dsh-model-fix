# UI 无痕融合纪律

`AGENTS.md` 只留总纲一句与索引，正文在此；仅供开发查阅，不进 `files`。

总纲：**官方用导出组件就用同一组件；官方自绘且无同款导出原语（或不导出）就在本地逐字复刻其源码——数值零自造**，只有数据、文本与业务逻辑属于我们。运行时值导入宿主原语的理由、风险面（#130）与缓释见 [`host-api.md`](host-api.md) 的「宿主类型导入清单」。

- 颜色只用宿主 `--dsw-alias-*` 令牌；字面量兜底与无真值令牌的取舍规则见 `card-styles.ts` 文件头注释。
- 取值基准是"同一类组件"而非"同一页面"：外层卡照「内置插件」的插件卡，内层配置组瓦片照「插件列表」的插件行卡。**具体数值一律以 `card-styles.ts` 的 `STYLE_TEXT` 为准。**
- 瓦片 summary 行要同时容纳整组开关与整行可点：透明空 `<button>` 绝对覆盖整行 + `aria-labelledby` 指向可见标题，开关所在尾区抬层分配点击权；**禁止把 `role="switch"` 嵌进 `<button>`**（非法 HTML）。
- **瓦片文案过长一律换行、不照官方截断**（用户裁定）：官方 `nowrap + ellipsis` 在瓦片两列栅格的窄列里会把组名与行标签砍掉半截，故标题 / 行标签 / 排除项 id 文案一律 `overflow-wrap:anywhere`；各区数值与布局机理见 `card-styles.ts` 注释。
- 设置项释义走宿主 `Tooltip`，锚点复刻官方 settings-form `.helpButton`（信息图标键，`aria-label` 取释义全文）；**必须 `portal`**（瓦片 `overflow:hidden` + `box-shadow` 层叠上下文会裁掉定位于锚点的气泡），并用 `maxWidth` 收窄，否则气泡盖住同行开关。
- **有限取值一律不用原生 `<select>`**：宿主设置页的「语言」行就是 `ui-primitives` 导出的 `Menu` 包一个按钮锚点 ⇒ 将来出现枚举型设置项时按总纲直接用同一组件；锚点按钮样式照官方 `LanguageRow.module.css` 的 `.selector`（不复刻它的 `.row`——设置页单列布局专有，带 `border-bottom`）。**瓦片形状按语义选**：布尔矩阵组有组总控开关、动态集合用输入框，一张瓦片只有一种形状，不为「某些行当下不生效」另立置灰态（缺席与「确实开着」在 UI 上分不出；生效条件写进该行的说明气泡，`TIP_KEYS` 判据与理由见 [decisions.md](decisions.md)「子智能体」组）。
- 宿主 Modal 的初始焦点控件标 `data-modal-autofocus`，不用 React `autoFocus`（模态层先存触发控件再移焦点，`autoFocus` 抢在前面会毁掉关闭后的回焦）。
- 卡片外壳不写 `max-width`（宽度由所在 section 约束，官方同样不写；`card-styles.ts` 有同注释）。
- UI 称谓跟随官方：provider-id 叫「提供方 / Provider ID」，功能名是「排除提供方」（en: Excluded providers），文案 / README / 注释一致。「取消」全卡片只留一个 `cancel` 键（弹层与 footer 同义：不想执行当前操作），`close` 键只作宿主 Modal 的 × 的 `closeLabel`（aria-label），确认键保持动作化（确认更新 / 确认重置 / 确认恢复 / 清空 / 验证）。对外报告状态的文案句号收尾（范围与例外）见 [decisions.md](decisions.md)「宿主与卡片」。