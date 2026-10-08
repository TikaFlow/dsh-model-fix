# UI 无痕融合纪律

`AGENTS.md`「UI 无痕融合纪律」一节的全文，仅供查阅，不复制正文回 `AGENTS.md`。

总纲：**官方用导出组件就用同一组件；官方自绘且无同款导出原语（或不导出）就在本地逐字复刻其源码——数值零自造**，只有数据、文本与业务逻辑属于我们。**运行时值导入宿主原语是有意选择**（符号漂移由 typecheck 在构建期拦下）；风险是宿主改名后运行期拿到 `undefined` ⇒ React #130 打空该 slot 条目，缓释是 devDep 类型面 + 升宿主时复核全部宿主值导入的符号面。

- 颜色只用宿主 `--dsw-alias-*` 令牌，字面量仅作令牌缺失时的浅色守卫且须取宿主主题真值；无主题真值的令牌（如官方引用的 `label-error`、`bg-layer-4`）不加字面兜底。
- 取值基准是"同一类组件"而非"同一页面"：外层卡照「内置插件」的插件卡，内层配置组瓦片照「插件列表」的插件行卡。**具体数值一律以 `card-styles.ts` 的 `STYLE_TEXT` 为准。**
- 瓦片 summary 行要同时容纳整组开关与整行可点：透明空 `<button>` 绝对覆盖整行 + `aria-labelledby` 指向可见标题，开关所在尾区抬层分配点击权；**禁止把 `role="switch"` 嵌进 `<button>`**（非法 HTML）。
- 设置项释义走宿主 `Tooltip`，锚点复刻官方 settings-form `.helpButton`（信息图标键，`aria-label` 取释义全文）；**必须 `portal`**（瓦片 `overflow:hidden` + `box-shadow` 层叠上下文会裁掉定位于锚点的气泡），并用 `maxWidth` 收窄，否则气泡盖住同行开关。
- **有限取值一律不用原生 `<select>`**：宿主设置页的「语言」一行就是 `Menu` 包一个按钮锚点，`Menu` 亦是 `ui-primitives` 的导出原语 ⇒ 将来出现枚举型设置项时按总纲直接用同一组件，锚点按钮的样式逐字复刻官方 `LanguageRow.module.css` 的 `.selector`（**不复刻它的 `.row`**——那是设置页单列布局专有，带 `border-bottom`）。同理，**瓦片形状按语义选**：布尔矩阵组有组总控开关，动态集合用输入框。布尔组的**行**可按各自的生效条件单独置灰（`GroupTile` 的 `disabledRows`，整组仍可用），**置灰的依据取自宿主的设置段**（`configForms.get('subagent-model-selection-settings')`），该段缺席时一律不置灰——无从判断生效条件就不该暗示不可用。
- 宿主 Modal 的初始焦点控件标 `data-modal-autofocus`，不用 React `autoFocus`（模态层先存触发控件再移焦点，`autoFocus` 抢在前面会毁掉关闭后的回焦）。
- 卡片外壳不写 `max-width`（宽度由所在 section 约束，官方同样不写）。宿主的 `expand`/`collapse` 文案只用于 `aria-label`，不要当死代码删。
- UI 称谓跟随官方：provider-id 叫「提供方 / Provider ID」，功能名是「排除提供方」（en: Excluded providers），文案 / README / 注释一致。「取消」全卡片只留一个 `cancel` 键（弹层与 footer 同义：不想执行当前操作），`close` 键只作宿主 Modal 的 × 的 `closeLabel`（aria-label），确认键保持动作化（确认更新 / 确认重置 / 确认恢复 / 清空 / 验证）。对外报告状态的文案（结果行、加载 / 只读提示、字段报错）一律以句号收尾。