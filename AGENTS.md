# dsh-model-fix

## 项目简介

DSH 插件：按 [models.dev](https://models.dev) 为非官方（自定义）提供方的模型填充/同步 `reasoningEfforts`、`contextWindow`、`maxTokens`、`input`，并为 `api: openai-completions` 路由维护 `compat.supportsDeveloperRole`；`excludes` 命中的提供方零操作（只影响保存之后的行为，不撤销已写入内容）；`userExperience` 管会话侧体验（**不支持按提供方排除**）：`rememberEfforts` 每模型记住推理级别并在切换模型时恢复、`defaultHigh` 无记忆且未设级别时自动设 `high`、`forgetRemoved` 删除模型/提供方时随之忘记其记忆。

## 技术栈与目录

Node.js（ESM）+ `@deepseek-ai/cordis`；tsdown 双配置构建到 `lib/`（Node 半 + 浏览器半，clean 只由 Node 半承担）；TS 严格模式，产物不带 sourcemap；ESLint 10 扁平配置。

| 路径 | 职责（只写非显而易见的部分） |
| --- | --- |
| `src/index.ts` | Node 半入口：`Config`（宿主经 `entry.fiber.runtime.Config` 取用）+ 单一 `apply` 编排体（备份 → 配置源与段变更接线 → installRpc → 启动链） |
| `src/shared/` | 跨半共享层（零 Node 依赖 / 零 schemastery / 零非基线 `@deepseek-ai/*`）：常量、`isPlainObject`/`providersOf`、当前版本配置的解析与物化与各组行键表 |
| `src/config.ts` `src/migrate.ts` `src/catalog.ts` `src/lookup.ts` `src/compat.ts` | 配置解析与配置源 / 升级链 `upgradeTo4..7` 与 `migrateConfig` / 缓存读写与目录拍平 / id 匹配与档位转换 / 路由 compat 纯写入计划 |
| `src/fix.ts` | 填充与写回（`force` 供强制更新单次绕过）；模型参数与路由 compat 同批提交；`excludes` 命中者在 provider 循环入口整条跳过；同一两层循环顺带重建 `efforts` 记忆 |
| `src/reset.ts` `src/restore.ts` `src/guard.ts` `src/host.ts` | 重置推理级别（仅剔除 `reasoningEfforts`，配置段零写入）/ 启动备份捕获与交集恢复 / 事件流守卫（写回期间短路整条事件链）/ 全部 settings 写回必经的 `queueTask` |
| `src/verify.ts` | 「验证模型」：校验并展开「模型 × 推理级别」笛卡尔积、按 provider 归组（组内串行即每 provider 单并发）、经宿主 `ctx.llm` 各发一次最小请求；纯计划与汇总零 ctx 可单测 |
| `src/rpc.ts` `src/rpc-route.ts` `src/refresh.ts` | 四个 RPC 端点（前三个以守卫互斥、验证只读不参与）/ 自注册 channel 路由 / 保鲜刷新 |
| `src/client/index.tsx` | 浏览器半入口：四个卡片刻位注册、词典、RPC 载体、记忆监听子 fiber |
| `src/client/card.tsx` | 四席共用的可折叠卡片（三席 `defaultOpen`）、五张瓦片、footer 与末尾联系行；**全部样式数值在 `STYLE_TEXT`** |
| `src/client/model.ts` / `effort.ts` / `scope.ts` / `locales.ts` | 快照↔配置纯映射（含验证候选拍取）/ 记忆纯逻辑 / ConfigForm 的 decode 包装 / 中英词典 |
| `public/models-cache.json` | 构建期平铺复制到 `lib/` 根：models.dev 拍平缓存（首启离线可用） |
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

## 设计裁决（代码里看不出动机）

- **配置解析优先级**：当前版本快照 → ≥ 最低支持的最高可解析快照（含更高版本，按当前 schema 降级解析，多余键忽略、`efforts` 宽松保留）→ 内置默认。更高版本快照降级落盘后**永不清理**，供再升级无损回退。当前版本快照非法**或残缺**时按**当前生效值**规范化重写——残缺会被 `parseSnapshot` 补默认判为合法，故须比对规范化结果而非只判非法。
- **`allowUpdate` 含缺失补写**，`autoFill` 关闭也拦不住：语义是"以目录为准同步该字段"。新旧相同则跳过，**数据无档位不删除已有配置**。
- **`force` 是单次绕过**（三项临时为真、不落存储、不重拉目录，避免把网络耗时算进按钮反馈）；与 compat 无关；`fix` 返回值只计模型变更数（记忆清理与 compat 不计入，保持 RPC 反馈契约）。
- **`fix` 读 `descriptor.user`**（原始用户段）：避免规范化形态与写入形态不一致而反复触发重写。写回带 revision 围栏，冲突时重读重算（限次）；写失败先告警再抛出（事件侧吞 rejection，RPC 转 `ok:false`）。
- **空 `input` / 空 `compat` 一律删除**（宿主语义等同未声明，删除无损幂等）。
- **compat「开启即添加、关闭即移除」，与模型参数取向相反**（后者关闭只是不写、存量保留）——`compat` 是本插件接管的路由字段，关掉开关却留着旧值等于开关没生效。只写路由级不写模型级（宿主里模型级优先，会与用户逐模型取值打架），且只发 `api === 'openai-completions'` 的路由。
- **`excludes` 是"零操作排除"而非"撤销"**：命中者在 provider 循环入口整条跳过，填充 / compat / `force` 全不作用；已写入值原地保留——插件无字段来源记录，分不清插件写的与用户手写的，"清除"必然误删。瓦片释义与 README 须写明"仅对保存之后的行为生效"，正确顺序是**先加排除、再建提供方**。记忆清理**不豁免**排除项：跳过处单独循环其模型做同样的重建，但不产生对该提供方的任何写回。
- **必须允许填入不存在的 id**，故不做候选约束控件；UI 用「命中」表达"当前确有同名提供方、排除正在生效"，未命中是普通样式、**不得画成错误色**（0 命中也常驻）。命中判据取 `llm-pi-ai` user 层的 `providers` 键——与 `fix` 遍历同一份数据，零漂移。
- **不自动清理失效 id**（顺手 prune 会清空用户列表）：列表顺序是录入意图，脏检测用顺序敏感的逐位比较。去重分两层——录入端当场拒绝写入；`selfHealConfig` 兜住手改配置文件，仅当 `Set` 收窄后**变短**才产出 op。`fix` 的写回不碰自有 NS 的配置键，`efforts` 重建是唯一例外。
- **图片模态只缓存正向信息**（纯文本省略以控体积；`pdf`/`video`/`audio` 忽略）。**容量哨兵**：`99999999` 与 0 一律视为无该字段（写 0 会被宿主 schema 拒绝并连累整批）。
- **id 匹配宁可漏不错配**：精确 → 词干 → 前缀三级，词干 / 前缀多命中即判无命中。词干拆为 `{base, digits}`，digits 取所有日期式数字组剥除连字符后的拼接，仅当两边都有 digits 才比对；任一边无 digits 则退回 base 兜底。
- **`efforts` 是运行时记忆而非用户配置**：嵌套对象（model-id 可能含 `/`，拼接无法还原）、宽松解析（坏结构回落 `{}`，不判整段快照非法以免连累自愈重写）、`isDirty` 不比较它；卡片「保存」写整段快照时 `efforts` 取**写入当刻的实时值**（卡片不拥有该字段，用草稿副本会覆盖"开卡后切过模型"的那段记忆）。
- **Node 半只负责记忆的持久化、解析与失效清理，不自动设置级别**（后端写配置只影响新会话）——自动恢复与自动设 `high` 必须走前端 `directory.select`，且自动设置不写记忆（经 `pendingAutoSet` 守卫跳过反向触发的投影变化）。
- **`rememberEfforts` 关闭只停止"保存新的"**（effort-change 分支跳过），"恢复"照常取真实记忆；是否清空由卡片在开关由开转关时**立即**确认（经 settings scope 直写；"有记忆"判据取实时值，清空失败显式报错，避免开关已关而记忆未清无从察觉）。
- **`defaultHigh` 三条护栏**：记忆优先（有记忆即跳过，即便因不受支持而未恢复）、不覆盖既有级别、不干预同模型改级别（含手动选「provider default」）。它与 `rememberEfforts` 同属「用户体验」瓦片的同一条监听链，两个开关都**不读 `excludes`**。
- **重置推理级别不写配置段、不改开关**（关掉开关等于修改配置，用户不一定要）：只剔除 `reasoningEfforts`，容量 / 输出上限 / 图片模态与自定义字段保留。竞态防护靠 Node 半模块级守卫而非前端（置位先于 mutate 同步完成，覆盖写回同步派发的事件），`forceUpdate` 端点同样被守卫拒绝。
- **恢复备份只回退交集**（备份与当前都存在的 provider 内的 model）：被删的 provider / model 不复活（复活后 api-key 已随 provider 删除，等于看得见用不了），启动后新增的原样保留；备份是 model **整对象**快照，故用户手写的同名键一起回退。备份只在 `apply` 最顶部捕获一次、仅存内存，**绝不做延迟补捕**——晚于写回捕到的是被填充过的内容，比没有更危险。备份缺失或当前无 `providers` 段要**显式抛错**（回 0 会显示成「已恢复 0 个模型」，与"确实无可恢复"无法区分）。
- **验证是只读诊断、只由用户主动发起**：不随填充后台自动验证（`fix` 是事件热路径且每次重试重读 revision，掺入网络 I/O 会让 `SETTINGS_CONFLICT` 反复重算重验；「已验证」账本还须新增顶层配置组并升级，且凭据/模型一变即过期）。结果**即用即弃**：不写 settings、不占事件流守卫、不与三个写回端点互斥、也不进配置键；列表**不套用 `excludes`**（排除只约束对配置的写入）。
- **验证只判「提供方是否受理」，不判内容**：提示词仅 `Just say OK`，收到首个非 `finish` 块即判成功并立即中断（省额度），终止块取 `stop` / `max-tokens` 为成功；只看返回文本会把不按提示词作答但实际可用的模型误判为不可用。档位 id 取 `reasoningEfforts` 的键（即模型页送出的同一个值），候选列表与「最低档位」按 `EFFORT_LEVELS`（`off < minimal < low < medium < high < xhigh < max`）排序。
- **每 provider 单并发、跨 provider 最多 4 路、不做退避重试**：一个 provider 一条串行链（`groupProbesByProvider` 的分组即结构保证），前一次返回才发下一次以规避 429。探测总数封顶 200（笛卡尔积放大条目，超出即拒绝而非静默截断），单次 30s 超时即判不可用。列表**默认不预选**、关窗即丢弃勾选：验证花真实额度，预选全部等于把「误点即扣费」变成默认路径。
- **验证弹层自确认**：候选框内已有 warn 额度提示与 warn 语义验证键（`.dsh-mf-confirmWarn`），footer 触发键取次级描边即可；底部整行交给自绘的 `.dsh-mf-verifyFooter` 容器（宿主 Modal 的 footer 是 `flex-end` 单行），使档位开关与按钮组同排、窄屏自动折行。在途期间弹层不关、原地转圈（宿主 `StateDot` 的 `ongoing` 态，同侧边栏会话列表项），结果到手才关窗。
- **RPC channel 由本插件在已注入 webServer 的子 fiber 上自注册**，不用宿主 `connection.rpc.handle`（后者在服务自己的 ctx 上求值 `owner.webServer`，而 connection 已不再注入它，必然抛错）；复用宿主 `requestRejection` 做信任围栏、按宿主 `rpcFetchHandler` 复刻信封与状态码。
- **卡片按钮取「保存」不取「应用」**：写 settings 即前端职责终点，填充由后端触发、填了几条前端无法感知。**瓦片默认收起、同时只展开一个**（官方手风琴语义）；`defaultOpen` 同时决定保存成功后是否自动收起——默认收起才自动收起（模型页 footer 席），默认展开的三席保持展开。**「取消」键仅未保存时渲染**。
- **卡片末尾固定一条版权 / 联系行**（分割线 + 地址 / 版本 + 两个跳转键），三元素同款、不做主次层级；「问题反馈」指向 `/issues/new?body=` 预填「标准 issue 模板 + 插件版本」，占位符用 `--要填什么--`。
- **不引入 `failed` 态、不做「恢复默认」**：三组布尔恒合法、写入为单字段原子写，失败时 `dirty` 已传达该信息；官方 reset 依赖字段级 user/base 分层与"未填回落"语义，本插件是整体显式快照。

## 数据流骨架

段变更按 ns 分流为两条链：自有段「自愈 → 填充」、llm-pi-ai 段「填充 → 保鲜刷新」，入口先判事件流守卫。浏览器半：`configForms` → `makeScope` → 四席共用同一张卡 + 记忆监听子 fiber；验证链路为 卡片弹层 → `verifyTargets` → RPC → `ctx.llm`（只读）。

## 命令

`pnpm build` / `typecheck` / `lint` / `test` / `pack:release`；提交前必跑。

## 测试规范

`test/` 只收不依赖 DSH 运行时的纯函数与零 ctx 编排（配置解析与迁移、目录拍平与缓存条目校验、id 匹配与档位转换、compat 计划、`planResetModels`/`planRestore`、`planProbes`/`groupProbesByProvider`/`summarizeProbes`、守卫、`rpc-route` 的纯信封逻辑 + node:http 桩、`fix` 编排 + `test/ctx.ts` 的常驻内存 settings 桩、浏览器半纯映射层）；浏览器组件与真实 fs / 网络不进 `test/`（`src/verify.ts` 的脏执行须经宿主 `ctx.llm`，只测纯计划与汇总）。`indexedCache` 与 `configSource` 是模块级单例，每个用例前调 `resetModules()`。