# dsh-model-fix

## 项目简介

DSH 插件：为所有非官方（自定义）提供商的模型自动填充推理级别（`reasoningEfforts`）、最大上下文（`contextWindow`）、输出上限（`maxTokens`）与图片模态（`input`），数据来自 models.dev。

## 技术栈与目录

Node.js（ESM）+ `@deepseek-ai/cordis` 插件；tsdown（rolldown）双配置构建到 `lib/`（Node 半 `index.js` + 浏览器半 `client.js`，clean 只由 Node 半配置承担）；TypeScript 严格模式。产物不带 sourcemap。

| 路径 | 职责（只标非显而易见的部分） |
| --- | --- |
| `src/index.ts` | 仅 `export` + `apply` 生命周期编排，业务全部外拆 |
| `src/types.ts` | 共享类型与守卫；**历史版本(v1) 是冻结形态**；Connection RPC 契约的结构本地复制也在这里 |
| `src/constants.ts` | 命名空间、版本与保留上限、重试参数、`CAPACITY_UNLIMITED`、提供商提示表 `HINTS` |
| `src/config.ts` / `src/migrate.ts` | 当前 schema 与 `resolveConfig` / 升级链与 `migrateConfig` 编排 |
| `src/catalog.ts` / `src/lookup.ts` | 缓存与拉取、拍平与条目校验 / id 归一化匹配与档位转换 |
| `src/fix.ts` | 填充与写回（`force` 供强制更新单次绕过） |
| `src/rpc.ts` / `src/refresh.ts` | 强制更新 channel / 刷新编排（含重试） |
| `src/client/` | 浏览器半：`index.tsx` 入口（词典/scope/RPC 载体/槽注册）、`card.tsx` 卡片、`model.ts` 快照↔六布尔纯映射（唯一可单测的浏览器半模块）、`locales.ts` 中英词典 |
| `public/models-cache.json` | 构建期随 `lib/public/` 发布的 models.dev 拍平缓存（首启离线可用） |
| `cordis.patch.yml` | DSH 补丁层对本插件的注册 |

## 硬约束（违反即坏）

### 跨半与宿主契约

- **浏览器半禁止值导入 Node 半模块**（`src/constants.ts` 会拖入 `node:path`）。因此配置命名空间、`CONFIG_VERSION`、RPC channel 名在 `src/client/model.ts` 以**字面量**另存一份，与 `src/constants.ts` / `src/rpc.ts` **改动必须两侧同步**；`tsdown.config.ts` 的 purity 门禁会拦住越界值导入（type-only 被擦除，不受限）。
- 浏览器半 externals 只允许宿主模块表基线那几项，其余一律打进包；基线权威列表在宿主 `packages/client/web/src/platform.ts`，漂移的后果是运行期 `require` 未命中。
- `package.json` 的 `dsh.client.inject` 是**依赖包图边**（填槽位所有者包），不是 cordis 服务名；服务名只写在 `src/client/index.tsx` 的 `export const inject`。
- 浏览器半产物必须复刻宿主 client 的闭包工厂契约（`window.__ModuleLoader__.load` + banner/intro/footer 三段）。声明了 `dsh.client` 后，缺 `lib/client.js` 会让宿主**激活期聚合抛错** ⇒ **build 必须先于 link/安装到宿主**。
- 卡片挂在宿主 `ModelsSection` 为仓库外插件预留的 list 席位 `settings.models.footer`（「模型」选项卡页面底部）；**选项卡头部在任何宿主版本都没有席位**，别往那儿挂。
- client 模块必须 `export const name`，且与包名一致。
- **对外纪律：前端可用面一律以 npm 发布版为准**（`npm view @deepseek-ai/dsh dist-tags`）；宿主源码仓 HEAD 领先一切已发布版本，只作参照，**其工作树路径不得写进本项目文档**（未被版本追踪）。已实证：`settings.models.footer` 槽只在 ≥ 0.1.2-alpha.2 的发布包中存在，npm `latest`（0.1.1-rc.2）没有该槽——在其上 `slots.inject` 会无限等待、静默无卡片。本插件取**向前兼容**：web-ui 只支持 ≥ 0.1.2-alpha.2（`peerDependencies` 声明下限），不为旧宿主做降级。
- Connection RPC 契约（`RpcResult`/`HostRpcHandle`/`ClientRpcCall`）是宿主 `@deepseek-ai/dsh-client-connection` 的**结构复制**而非依赖：该包的 transitive 依赖范围只存在于宿主 monorepo、npm 上装不起来，故仅 type-only 使用；`ctx.get` 断言范式与宿主内置插件一致。信任围栏（loopback / 浏览器会话 cookie）由宿主施加。
- 词典 `ctx.locale.register` 重复注册会抛错，必须经 `ctx.effect` 挂 disposer 保 HMR；卡片样式经模块级幂等 `<style>` 注入，带 `data-plugin` 标记供宿主 HMR 认领。

### 宿主 settings 的脾气

- **根写入要求纯对象**，故自有配置用 `version-N -> 快照` 的**映射**而非列表。
- 段 schema 必须宽松（`z.dict(z.any())`）：否则"比当前代码更新的版本快照"会让命名空间注册直接失败。严格校验只针对当前版本快照值。
- `settingsScope.bind` **必须自带 decode 且永不返回 undefined**：缺省路径走宿主 schema rehydrate，宽松 dict 校验失败会使 scope status 永挂 loading。
- **路径 op 不支持数组下标中间段**（且各段必须是字符串），要改数组元素只能整段 `set` 覆盖 ⇒ `fix` 按 provider 整段写回 `providers[id].models`，未变更元素原样保留。
- 命名空间注册（含冲突/存储段非法的抛错）被推迟到**微任务**，而 `apply` 内的 effect 体同步执行、此刻 `describe()` 读空 ⇒ 迁移前必须有界等待注册完成（`waitForSettingsReady` 用 `setTimeout(0)` 让出宏任务；超 `REGISTER_WAIT_MAX` 次未就绪则跳过迁移，不阻塞填充）。
- **迁移必先于填充**，否则旧格式会被按新 schema 误解析。

### 历史形态冻结

- v1 = `tikaflow-model-fix` 版本快照体系的旧快照（引入 image 前的配置），其类型与 schema 一律不引用当前版本的可演进定义。
- v0（旧 `model-reasoning` 命名空间形态，含布尔写法）**已整体移除支持**：配置面小、默认值安全、卡片 UI 可重建，历史包袱不再背。旧命名空间段如残留在 settings 中，本插件不读不写。
- 升级台阶 `upgradeNToN+1` 只做相邻一级、**目标版本号写固定字面量**（不引用 `CONFIG_VERSION`）；发新版只追加台阶函数，链上既有函数不改。
- 提升 `MIN_SUPPORTED_VERSION` 时：该版本的冻结段与对应台阶整体移除。

### 工具链陷阱

- `pnpm test` **必须带 `--no-config`**：否则 CLI 参数会合并进数组配置的每一项，浏览器半的工厂 banner 会污染测试产物（无配置时产物扩展名为 `.mjs`）。
- `pnpm install` 的 `prepare` 会跑 build ⇒ `lib/` 装完即存在。
- 浏览器半类型依赖 `@deepseek-ai/dsh-client-*` devDeps，**版本须与宿主 harness 对齐**，否则类型面与发布版实际能力脱节。

## UI 无痕融合纪律（浏览器半一切样式与交互取舍的准绳）

目标是 1:1 复刻官方 Web-UI：只有数据、文本与业务逻辑属于我们。三条判据：

- **能导出的宿主组件，只在官方同一位置也用了它时才用。** 官方卡片 footer 自绘 `.save`/`.discard`（不自用 `Button`）、未保存徽章自绘 `.pending`（不自用 `Pill`）、设置面完全不用 `Tooltip`/`HoverCard`/`Toast` ⇒ 本卡一律自绘复刻，不为了"用了原语"而偏离官方观感。官方在 Modal footer 里用了 `Button`，本卡的 `Modal` 亦用 `Button`。
- **颜色只用宿主 `--dsw-alias-*` 令牌，且令牌存在性要逐个证实。** 字面量仅作令牌缺失时的浅色守卫，且必须取宿主主题 `design-platform.css` 的真值——例如 `brand-primary` 在浅色主题下解析为**近黑而非品牌蓝**。这样主题插件换色时我们与官方同步变化。官方源码里引用了但主题中**未定义**的令牌（`label-error`、`bg-layer-4`）禁止照抄（任何主题下都会失效）。
- **取值基准是"同一类组件"而非"同一页面"。** 外层卡照 `PluginCard`，内层配置组瓦片照插件列表项卡（`ui-settings-plugin-inventory`）；同页 provider 行 `.rowCard` 是不可展开的列表行、与本卡非同类，不作基准（早期曾按它折中，已纠正）。具体数值一律以 `src/client/card.tsx` 的 `STYLE_TEXT` 为准，本文档不复述。

两条需要知道"为什么"的手法：

- 官方项卡的发丝描边与展开态柔光用 `--dsw-elevation-stroke`/`--dsw-elevation-panel`，该组令牌无法在本地可得的发布产物中证实存在（由宿主应用主题定义、随宿主应用发布）⇒ 采取**令牌优先 + 字面复刻其计算结果作兜底**：宿主有令牌即与官方同源换色，没有也得到同一观感。该组派生变量声明在 `body *` 上（官方注释：逐元素声明才吃得到组件自己的重绑），所以在同一元素重绑 `--dsw-elevation-stroke-color` 是有效手法。
- 瓦片 summary 行要同时容纳「整组开关」和「整行可点」：宿主 `DisclosureRow` 在五个设置包全域**零使用**、chevron 在行左端、无右侧控件槽、发布版 CSS 无焦点环 ⇒ 自绘。写法是透明空 `<button>` 绝对覆盖整行 + `aria-labelledby` 指向可见标题，hover 底色画在行容器上，开关所在尾区抬层并用 `pointer-events` 分配点击权。**禁止把 `role="switch"` 嵌进 `<button>`**（非法 HTML）。

## 设计裁决（代码里看不出动机）

- **配置解析优先级**：当前版本快照 → ≤ 当前且 ≥ 最低支持的最高版本 → 内置默认。更高版本快照本代码不读取（仅告警保留），供新版插件回退后无损读取 ⇒ 等于/高于当前版本的快照**永不清理**。
- **当前版本快照非法时自愈重写**：不修就会长期停在"文件里是坏值、运行期按次高版本或默认执行"的不一致态且无从纠正。重写目标取**当前生效值**（有可用旧快照则沿用其语义），而非强行落默认。
- **全新用户直接写规范默认快照**（不经升级链），保证启动后段内必有当前版本快照；写入用定向路径 op，不触碰用户手写键与高版本快照。
- **`allowUpdate` 含缺失补写**，且 `autoFill` 关闭也拦不住它——语义是"以目录为准同步该字段"；对已有字段才是覆盖，且要求新值合法（档位/容量/模态各自校验），新旧相同则跳过。**数据无档位不删除已有配置**。
- **`force` 是单次绕过**：`fix(ctx, true)` 等价三项临时为真但不落存储，且不重新拉取 models.dev（用当前内存目录，避免把网络耗时算进按钮反馈）。官方允许覆盖用户手动配置，Modal 文案已就此明示。
- **写失败先告警再抛出**：事件类调用点 catch 吞掉 rejection（日志已在 `fix` 内），RPC 调用方转 `ok:false` 回传前端——同一个错误不能既静默又弹窗。
- **`fix` 读 `descriptor.user`（原始用户段）而非解析值**：写回值与读回值同源，避免 schema 规范化后的形态与写入形态不一致而反复触发重写。写回携带 revision 做并发围栏，冲突时重读重算（限次）。
- **空 `input` / 空 `compat` 一律删除**：harness 语义上与"未声明"等同，删除无损且操作幂等。
- **图片模态只缓存正向信息**（支持图片才写 `true`，纯文本省略字段）：缓存体积是发布包大小主因；纯文本模型本就不声明，行为与未声明一致。数据源里的 `pdf`/`video`/`audio` 忽略不写（宿主 `input` 只接受 `text`/`image`）。
- **容量哨兵**：`CAPACITY_UNLIMITED = 99999999` 是 models.dev 对"无限/未公布"的建模，媒体模型还会给 0——两者一律视为"无该字段"（写 0 会被宿主 schema 拒绝并连累整批）。
- **id 匹配宁可漏不错配**：精确 → 词干 → 前缀三级，词干/前缀**多命中即判无命中**；无分隔符的短 id 只走精确。跨提供商同源模型靠 `HINTS`（模型名前缀 → 官方提供商）优先命中。
- **卡片按钮文案取「保存」不取「应用」**：写 settings 即前端职责终点，填充由后端 `onChange → fix` 触发，其结果（填了几条）前端无法感知——叫「应用」会让人误以为按钮本身应用了目录值。
- **瓦片默认收起、同时只展开一个**（手风琴）：各瓦片展开后高度不同，同时展开会让两列底部参差，官方即如此设计。
- **展开体填 `bg-module-platform`、外层整卡不填**：前者在宿主语义里是"展开出来的内层面板"（同页 `.editor`/`.setupCard` 同令牌），后者填了会在页面上显成灰块。深色主题下官方瓦片本体与该填充同值、看不出差异，我们本体透明故可见——与同页一致，属预期。
- **不引入 `failed` 态、不做「恢复默认」**：六布尔恒合法、写入为单字段原子写，失败时 `dirty` 保留已完整传达该信息；官方 reset 依赖字段级 user/base 分层与"未填回落"语义，本插件是整体显式快照，二者不成立。
- **`expand`/`collapse` 文案只用于 `aria-label`**（视觉只有箭头），官方同款——**不要当成死代码删除**。
- **有意的布局偏离**：表头/瓦片里开关在文字左（矩阵列对齐需要，官方 `.toggleRow` 是左文右钮）、卡片内不写 `body[data-ds-dark-theme]` 镜像规则（宿主令牌自动切换）。

## 数据流骨架

启动一条链：**等待注册 → 迁移 → 读缓存 → 填充 → 异步刷新（拉取成功则覆盖索引与缓存后再填充）**，全程由一个 effect 管理，卸载置位后在途结果不触碰已销毁上下文；刷新与缓存写入失败都是"固定间隔、含首次共最多 3 次、最终仅告警"，不影响本次运行。缓存内容与新拉数据无变化时跳过写盘。

```mermaid
graph LR
    R[等待命名空间注册] --> M[migrateConfig]
    M --> C[readCache 逐条校验]
    C --> F[fix 填充]
    F --> X[fetchLatest 拉取]
    X -->|数据非空| I[替换索引 + 覆盖缓存]
    I --> F
```

## 配置说明

- 自有命名空间 `tikaflow-model-fix`（由本插件注册），仅对象写法，如 `tikaflow-model-fix: { version-2: { autoFill: { reasoning: true, context: false, image: true } } }`；首次启动或版本升级时自动写入当前版本快照。
- 也可经 Web 设置的卡片修改（需宿主 ≥ 0.1.2-alpha.2），两种途径写的是同一个东西。
- 推理级别取值与 harness `ModelThinkingLevel` 一致：`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`；模型列表在 `llm-pi-ai` 命名空间的 `providers` 下。

## 命令

- `pnpm build` / `pnpm run typecheck` / `pnpm test`（**必须 `--no-config`**，见上）
- `pnpm install` 触发 `prepare` → build

## 测试规范

- `test/` 只收**不依赖 DSH 运行时的纯函数**：配置解析与迁移、拍平与条目校验、id 匹配、浏览器半纯映射层（`src/client/model.ts` 零外部值依赖故可直接单测）。涉及时序/框架的编排（`migrateConfig`、`fix`、`readCache`/`fetchLatest`、`refresh`、浏览器半组件）不进 `test/`，需要时用 stub ctx 临时脚本验证后删除。
- 文件按被测模块命名 `test/<module>.test.ts`，导出 `run()`，在 `test/index.ts` 注册；断言与汇总用 `test/helper.ts`（`check` / 键序无关的 `stable` / `summary` 设退出码）。
- 新增或修改纯函数必须同步补用例并 `pnpm test` 通过；断言优先覆盖边界与兼容性语义（非法输入兜底、幂等、版本回退），不追求逐行覆盖。
