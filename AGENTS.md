# dsh-model-fix

## 项目简介

DSH 插件：按 [models.dev](https://models.dev) 为非官方（自定义）提供方的模型填充/同步 `reasoningEfforts`、`contextWindow`、`maxTokens`、`input`，并为 `api: openai-completions` 路由维护 `compat.supportsDeveloperRole`；`excludes` 命中的提供方零操作（只影响保存之后的行为，不撤销已写入内容）；`userExperience` 管会话侧体验（**不支持按提供方排除**）：`rememberEfforts` 每模型记住推理级别并在切换模型时恢复、`defaultHigh` 无记忆且未设级别时自动设 `high`、`forgetRemoved` 删除模型/提供方时随之忘记其记忆。

## 技术栈与目录

Node.js（ESM）+ `@deepseek-ai/cordis`；tsdown 双配置构建到 `lib/`（Node 半 + 浏览器半，clean 只由 Node 半承担）；TS 严格模式，产物不带 sourcemap；ESLint 10 扁平配置。

| 路径 | 职责（只写非显而易见的部分） |
| --- | --- |
| `src/index.ts` | Node 半入口：`Config`（宿主经 `entry.fiber.runtime.Config` 取用）+ 单一 `apply` 编排体（备份 → 配置源与段变更接线 → installRpc → 启动链） |
| `src/shared/` | 跨半共享层（零 Node 依赖 / 零 schemastery / 零非基线 `@deepseek-ai/*`）：常量、`isPlainObject`/`providersOf`、当前版本配置的解析与物化与各组行键表、验证契约（明细 / 汇报 / 进度帧，浏览器半须据此解析回传，禁反向 import Node 半） |
| `src/config.ts` `src/migrate.ts` `src/catalog.ts` `src/lookup.ts` `src/compat.ts` | 配置解析与配置源 / 升级链 `upgradeTo4..7` 与 `migrateConfig` / 缓存读写与目录拍平 / id 匹配与档位转换 / 路由 compat 纯写入计划 |
| `src/fix.ts` | 填充与写回（`force` 供强制更新单次绕过）；模型参数与路由 compat 同批提交；`excludes` 命中者在 provider 循环入口整条跳过；同一两层循环顺带重建 `efforts` 记忆 |
| `src/reset.ts` `src/restore.ts` `src/guard.ts` `src/host.ts` `src/prune.ts` | 重置推理级别（仅剔除 `reasoningEfforts`，配置段零写入）/ 启动备份捕获与交集恢复 / 事件流守卫（写回期间短路整条事件链）/ 全部 settings 写回必经的 `queueTask` / 剔除验证明细中**明确不支持**的档位（写入前判空壳、`excludes` 跳过、幂等） |
| `src/verify.ts` | 「验证模型」：校验入参（含浏览器半逐模型声明的 `needTest`）并按模型序展开为「模型 × 其声明的档位」的**被验**请求序列（各模型档位数量不同，是累加非相乘）、按 provider 归组（组内串行即每 provider 单并发）、经宿主 `ctx.llm` 各发一次最小请求；`needTest` 为真的模型由执行器在其第一条被验请求前现发一次不带 `reasoningEffort` 的**探测**（每模型至多一次，不进计划/明细/统计/进度帧，但参与 `reachable` / `keyValid` 记账）；失败**只按** `LlmFailure` 的 `code` 分类（不看 `status`），端点不可达（只认传输层失败码）/ 凭据无效即短路整组、额度耗尽只压该模型、限流与超时归瞬态（既不判不可用也不短该模型的后续档位）；执行器只依赖注入的 `llm.stream`，带桩即可全链路单测；接受外部 `signal`（客户端断开 / 用户停止）与 `onProgress` 出口，中止同时断在途请求**并**让执行循环早停，中止时不发 `done` 帧；返回逐提供方汇报 + 逐条被验明细（含失败原始事实）+ **`unsupportedEfforts` 不支持档位明细**（前端不自己筛，剔除直接用）；汇报带两个计划数：`planned`（被验请求数）与 `plannedEfforts`（其中带档位的条目数，即级别口径的分母） |
| `src/rpc.ts` `src/rpc-route.ts` `src/refresh.ts` | 四个 channel RPC 写回端点（以守卫互斥、验证只读不参与）+ 验证进度流（`connection.fetch` 的 exact 路由，SSE 分帧，客户端断开即中止执行）/ 保鲜刷新 |
| `src/client/index.tsx` | 浏览器半入口：四个卡片刻位注册、词典、RPC 载体、验证进度流读流、记忆监听子 fiber |
| `src/client/card.tsx` | 四席共用的可折叠卡片（三席 `defaultOpen`）、五张瓦片、验证弹层（实时记录区 + 停止）、验证跑完后的剔除确认层、footer 与末尾联系行；**全部样式数值在 `STYLE_TEXT`** |
| `src/client/model.ts` / `effort.ts` / `scope.ts` / `locales.ts` | 快照↔配置纯映射（验证候选拍取与目标收敛）/ 记忆纯逻辑 / ConfigForm 的 decode 包装 / 中英词典 |
| `public/models-cache.json` | 构建期平铺复制到 `lib/` 根：models.dev 拍平缓存（首启离线可用） |
| `docs/decisions.md` | 「设计裁决」全文（AGENTS.md 同节只留提纲）；仅供开发查阅，不进 `files` |
| `icon.svg` / `cordis.patch.yml` / `locale/*.json` | 包根静态资源，不经 tsdown，`files` 单列；补丁行的 `id` 即 settings 命名空间键 |

## 硬约束（违反即坏）

### 跨半与宿主契约

- **导入别名纪律**：`src`/`test` 的源码导入一律以 `@/`（→`src/`）或 `@test/`（→`test/`）开头，禁相对路径；映射须同时声明在 tsconfig `paths` 与 tsdown 各配置 `alias`（tsdown 不读 paths）。别名键锚定 `@`，不吞 `@deepseek-ai/*`。
- `tsdown.config.ts` 内置**双向纯度门禁**：浏览器半 `@/` 值导入只放行 `@/shared/*` 与 `@/client/*`，node 半禁 `@/client*`，两侧禁相对导入（防 `node:path`/schemastery 进浏览器包）。新增跨半依赖前先判断该进 `src/shared` 还是走字面量/契约复制。
- 浏览器半 externals 只允许宿主模块表基线那几项（权威列表在宿主 `packages/client/web/src/platform.ts`，本仓副本在 `PLATFORM_MODULES`），其余一律打进包。
- `package.json` 的 `dsh.client.inject` 是**依赖包图边**（槽位所有者包），不是 cordis 服务名；服务名只写在 `src/client/index.tsx` 的 `export const inject`。client 模块须 `export const name` 且等于包名，并复刻 `window.__ModuleLoader__.load` 闭包工厂契约（banner/intro/footer 三段）——声明 `dsh.client` 后缺 `lib/client.js` 会让宿主激活期聚合抛错，故 **build 必须先于安装**。
- settings 命名空间键 = `cordis.patch.yml` 的 `id`，须与浏览器半 `configForms.get(NS)`、Node 半写回 NS **同一字面量**（`PLUGIN_NS`）；换包即换 id，升级传播无需用户操作。
- `Config` 导出 = `z.any().volatile()`：**不能用 dict**（宿主对 `type === 'object'` 的 schema 逐字段投影会把整段抹成 `{}`）；根 volatile 使宿主把整段作为实时引用注入 `apply` 第二参，`.get()` 必须留在工厂内。
- 浏览器半：`configForms.get(ns)` 只收 entryId、不转发 decode spec，解码责任全在 `makeScope`，且 decode **永不返回 undefined**。`get` 查无 NS ⇒ 卡片显「配置不可用」（NS 不匹配的判定特征）；decode 失败则永停「加载中」，两者可区分。`ctx.inject(['configForms'])` 只是标记服务（**不进父级 `inject`**），共享编排体一律走父 ctx。
- 宿主类型面一律 type-only 导入 devDep 的 `/client`、`/types` 与 `node:http`，构建期擦除、不落运行期依赖；升宿主时 typecheck 即暴露不兼容。**`ctx.llm` 同样只做 type-only 引用**：凭据只在宿主凭据缝内可读，验证请求必须经宿主 `LlmRuntime.stream` 发出，故 `dependencies` 不长新条目；档位 id 用 `as ReasoningEffortId` 断言而不引运行期构造器。`llm` 是 `src/index.ts` 的 `inject` 依赖（非可选子 fiber）：插件以模型配置为业，无它即无从工作，不做缺席降级分支。
- **对外纪律**：`@deepseek-ai/cordis`/`schemastery` 取宿主本体自己声明的线，`peerDependencies` 同版作下限（pnpm 会把 `>=` 归一成成品版本号，加完须手工改回）；**官方包一律 optional peer + devDep 同版兜底，`dependencies` 目前为空**。两处 `engines.dsh` 同值、range 一律 `>=` 不用 caret；**不写 `@deepseek-ai/dsh` peer**（pnpm 默认 `autoInstallPeers: true`，缺失 peer 会被真装进来并拖入整棵 CLI 树，兼容性谓词改由 `dsh-*` 子包 peer 承担）。
- 词典 `ctx.locale.register` 重复注册会抛错，须经 `ctx.effect` 挂 disposer 保 HMR；卡片样式经模块级幂等 `<style>` 注入并带 `data-plugin` 标记供宿主 HMR 认领。

### 宿主 settings 的脾气

- 根写入要求纯对象 ⇒ 自有配置用 `version-N -> 快照` 的**映射**而非列表；段 schema 必须宽松（`z.any()`），严格校验只针对当前版本快照值。
- 路径 op 不支持数组下标中间段 ⇒ 改数组元素只能整段 `set` 覆盖（`fix` 按 provider 整段写回 `models`，未变更元素原样保留）。
- `unset` **不折叠**被清空的父对象 ⇒ 删空对象要整段 `unset`，否则留下脏壳反复触发写入判定。
- 命名空间装载时序：`llm-pi-ai` 早于本插件 `apply` 可读；自有 NS 由宿主 Loader 异步登记、可能晚于 apply ⇒ `migrateConfig` 有界轮询等待（`MIGRATE_WAIT_MS`），读不到即早退不写。**迁移必先于填充**，否则旧格式会被按新 schema 误解析。
- 宿主事件可能在其 HMR 事务的 AsyncLocalStorage 上下文里同步派发，defer 到宏任务也逃不掉 ⇒ **全部 settings 写回一律经 `queueTask`**（取 hmr 服务的私有 `executing` ALS `exit()` 摘出上下文后排队）。收口在写 choke point 而非事件入口，新增调用路径天然安全；实例不可得时退回裸 mutate。RPC 与启动链不在事务血缘内。

### 版本快照与冻结形态

- 新增**顶层配置组**算形态变化，必须递增 `CONFIG_VERSION` 并加升级台阶；只往 `compat` 组内加键不算（新键须有 schema 默认，旧快照解析后即获得默认）。
- `src/types.ts` 的 `V3`–`V6` 与 `migrate.ts` 的 `upgradeTo4`–`upgradeTo7` 是历史形态，**不随当前类型演进**（否则历史语义会被当前类型改写，破坏无损回退）。台阶按目标版本命名 `upgradeToN`：每级先 `fromVersion < N-1 ? upgradeToN-1(...) : 输入` 接力，再按 vN-1 冻结 schema 解析、补新增字段落默认，产物版本号写固定字面量；`upgradeConfig` 只调最新一级。
- 提升 `MIN_SUPPORTED_VERSION` 到 M 时，低于 M 的冻结类型与台阶一并移除（其输入下限已被守卫拒绝），输入下限恰为 M 的一级转为最低一级、自持全链唯一的 `fromVersion < MIN_SUPPORTED_VERSION` 守卫。

### 工具链陷阱

- `pnpm test` 走专用单对象配置 `tsdown.test.config.ts`；**禁止指回数组主配置**（CLI 参数会合并进每一项、浏览器半的工厂 banner 会污染测试产物）。
- **TS 7 与 ESLint 并存靠 npm 别名**：TS 7 原生版无 JS API，typescript-eslint 见之即抛错。故 `typescript` = `npm:@typescript/typescript6@^6.0.2`（bin 为 `tsc6`），TS 7 挂别名 `@typescript/native`。
- `pnpm lint` 走 `eslint.config.js`：忽略 `lib/`、`dist/`、`.test-dist/`、`public/`、`.tmp-dsh/`；除官方 recommended 外只加两条硬约束（禁相对导入、`consistent-type-imports`）。
- **沙箱内验证结果不可信，要提权跑**：文件沙箱禁止命名管道，子进程输出捕获受阻，`pnpm test`/`pnpm build` 可能返回 exit 0 却既无汇总也不落产物。以看到的 `ALL PASS (n)` 与 `lib/*.js` 的大小/mtime 为准。
- 宿主包本地依赖全走 devDeps 且须与宿主 latest 同号；一律用 `pnpm add` 变更（`-E` 保精确、`--save-peer` 写 peer）。**升级只能写具体版本号**（各子包的 `latest` tag 陈旧）。

## UI 无痕融合纪律

总纲：**官方用导出组件就用同一组件；官方自绘且无同款导出原语（或不导出）就在本地逐字复刻其源码——数值零自造**，只有数据、文本与业务逻辑属于我们。**运行时值导入宿主原语是有意选择**（符号漂移由 typecheck 在构建期拦下）；风险是宿主改名后运行期拿到 `undefined` ⇒ React #130 打空该 slot 条目，缓释是 devDep 类型面 + 升宿主时复核全部宿主值导入的符号面。

- 颜色只用宿主 `--dsw-alias-*` 令牌，字面量仅作令牌缺失时的浅色守卫且须取宿主主题真值；无主题真值的令牌（如官方引用的 `label-error`、`bg-layer-4`）不加字面兜底。
- 取值基准是"同一类组件"而非"同一页面"：外层卡照「内置插件」的插件卡，内层配置组瓦片照「插件列表」的插件行卡。**具体数值一律以 `card.tsx` 的 `STYLE_TEXT` 为准。**
- 瓦片 summary 行要同时容纳整组开关与整行可点：透明空 `<button>` 绝对覆盖整行 + `aria-labelledby` 指向可见标题，开关所在尾区抬层分配点击权；**禁止把 `role="switch"` 嵌进 `<button>`**（非法 HTML）。
- 设置项释义走宿主 `Tooltip`，锚点复刻官方 settings-form `.helpButton`（信息图标键，`aria-label` 取释义全文）；**必须 `portal`**（瓦片 `overflow:hidden` + `box-shadow` 层叠上下文会裁掉定位于锚点的气泡），并用 `maxWidth` 收窄，否则气泡盖住同行开关。
- 宿主 Modal 的初始焦点控件标 `data-modal-autofocus`，不用 React `autoFocus`（模态层先存触发控件再移焦点，`autoFocus` 抢在前面会毁掉关闭后的回焦）。
- 卡片外壳不写 `max-width`（宽度由所在 section 约束，官方同样不写）。宿主的 `expand`/`collapse` 文案只用于 `aria-label`，不要当死代码删。
- UI 称谓跟随官方：provider-id 叫「提供方 / Provider ID」，功能名是「排除提供方」（en: Excluded providers），文案 / README / 注释一致。「取消」全卡片只留一个 `cancel` 键（弹层与 footer 同义：不想执行当前操作），确认键保持动作化（确认更新 / 确认重置 / 确认恢复 / 清空 / 验证）。

## 设计裁决（提纲）

代码里看不出动机的前提，全文见 [`docs/decisions.md`](docs/decisions.md)。改动下列任一模块前，先读对应条目：

- **解析与填充**：快照优先级（当前版本 → 更高版本降级 → 默认，非法或残缺按当前生效值规范化）；`allowUpdate` 含缺失补写、数据无档位不删已有值；`force` 单次绕过；`fix` 读 `descriptor.user` + revision 围栏；空 `input`/`compat` 一律删；`compat` 开关即增删且只写路由级。
- **排除与列表**：`excludes` 是零操作排除而非撤销；允许填不存在的 id；不自动清理失效 id（列表顺序即录入意图）。
- **参数来源**：图片模态只缓存正向信息；`99999999` / 0 视为无该字段；id 匹配宁可漏不错配；档位序取 `EFFORT_LEVELS`。
- **推理级别记忆**：`efforts` 是运行时记忆而非用户配置；Node 半只持久化不自动设级别；`rememberEfforts` 关闭只停「保存新的」；`defaultHigh` 三条护栏；两个开关都不读 `excludes`。
- **写回端点**：重置只剔 `reasoningEfforts`、不写配置段；恢复备份只回退交集、绝不延迟补捕；写回端点以守卫互斥。
- **验证**：只读诊断、只由用户主动发起、即用即弃；**只认 `block-start`、不看内容**（`usage` 不算受理）；失败**只按** `LlmFailure` 的 `code` 分类（**全程不比对报错文案**——pi-ai 侧抛错只给 `{message, code}`，上游状态码与措辞在到达前已被压平），端点不可达（**只认 `TRANSPORT`/`STREAM_CLOSED`**）/ 凭据无效即短路整组、额度耗尽只压该模型（额度可能只覆盖某个模型），**限流与超时归瞬态：既不判不可用、也不短该模型的后续档位**（它们只否定这一次，实测 429 挡掉的档位隔一会儿就通），档位不支持只记录不短路；某档位**报错**且非档位不支持、非瞬态时短该模型的剩余档位（换档位也是同样结果），退化完成不算报错、不短；每 provider 单并发、跨 provider ≤5 路、无退避；列表默认不预选；档位开关关态=**不发** `reasoningEffort`（端点可能有默认级别，不是取最低档去验）；收尾统计随开关分两档、**数字跟着「档位」的含义走**：关档位只报模型（勾选 `tested` / 可用 `models`），开档位报级别（`efforts` / `plannedEfforts`，分母只数带档位的条目，`planned` 还含没声明档位的模型那条）；浏览器半逐模型声明 `needTest`（只「确有档位要验」时为真），为真的模型由执行器现发一次不带档位的**探测**（每模型至多一次，不进计划 / 明细 / 统计 / 进度帧，只参与端点与凭据记账），那一次不带档位的请求不通即短该模型，已通则该档位被判为**参数不正确**（`INVALID_REQUEST`，宿主已从文案归一好的 4xx 码）即判不支持且**不**短后续——控制变量法：探测已排除端点、凭据、额度、网络与模型名，两次请求唯一变量就是档位；弹层自确认；进度以 SSE 流实时逐条展示，主键在途变「停止」，**关窗 / 断连即中止执行**（验证即用即弃，用户不在之后继续跑等于白烧额度）；跑完若有**明确判为档位不支持**的结论即弹剔除确认层，明细由 `VerifySummary.unsupportedEfforts` 直接给出、剔除经 Node 半写回（守卫不可省，否则写回触发 `fix` 把刚剔的又填回）。
- **宿主与卡片**：RPC channel 自注册；按钮取「保存」不取「应用」；卡片末尾固定联系行；不引入 `failed` 态、不做「恢复默认」。

## 数据流骨架

段变更按 ns 分流为两条链：自有段「自愈 → 填充」、llm-pi-ai 段「填充 → 保鲜刷新」，入口先判事件流守卫。浏览器半：`configForms` → `makeScope` → 四席共用同一张卡 + 记忆监听子 fiber；验证链路为 卡片弹层 → `verifyTargets` → 进度流端点（`fetch` 逐帧回调）→ `ctx.llm`（只读）。

## 命令

`pnpm build` / `typecheck` / `lint` / `test` / `pack:release`；提交前必跑。

## 测试规范

`test/` 只收不依赖 DSH 运行时的纯函数与零 ctx 编排（配置解析与迁移、目录拍平与缓存条目校验、id 匹配与档位转换、compat 计划、`planResetModels`/`planRestore`/`planPruneEfforts`/`parsePruneTargets`、`planProbes`/`groupProbesByProvider`/`classifyFailure`/`reportProvider`/`summarizeProviders`、`verifyModels` 带桩跑通短路与中止全链路（进度帧序列、`skipped`、早停不发 `done`、未开跑的组不进汇报）、守卫、`rpc-route` 的纯信封逻辑 + node:http 桩、`fix` 编排 + `test/ctx.ts` 的常驻内存 settings 桩、浏览器半纯映射层）；浏览器组件与真实 fs / 网络不进 `test/`（`verifyModels` 只依赖注入的 `llm.stream`，故带桩即可，不触网）。`indexedCache` 与 `configSource` 是模块级单例，每个用例前调 `resetModules()`。