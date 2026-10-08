# dsh-model-fix

## 项目简介

DSH 插件：按 [models.dev](https://models.dev) 为非官方（自定义）提供方的模型填充/同步 `reasoningEfforts`、`contextWindow`、`maxTokens`、`input`，并为 `api: openai-completions` 路由维护 `compat.supportsDeveloperRole`；`excludes` 命中的提供方零操作（只影响保存之后的行为，不撤销已写入内容）；`userExperience` 管会话侧体验（**不支持按提供方排除**）：`rememberEfforts` 每模型记住推理级别并在切换模型时恢复、`defaultHigh` 无记忆且未设级别时自动设 `high`、`forgetRemoved` 删除模型/提供方时随之忘记其记忆。

## 技术栈与目录

Node.js（ESM）+ `@deepseek-ai/cordis`；tsdown 双配置构建到 `lib/`（Node 半 + 浏览器半，clean 只由 Node 半承担）；TS 严格模式，产物不带 sourcemap；ESLint 10 扁平配置。

| 路径 | 职责（一句；完整版见 [`docs/architecture.md`](docs/architecture.md)） |
| --- | --- |
| `src/index.ts` | Node 半入口：`Config` + 单一 `apply` 编排体 |
| `src/shared/` | 跨半共享层：常量、`errorText`、探测契约（禁反向 import Node 半） |
| `src/config.ts` `src/migrate.ts` `src/upgrade.ts` | 配置解析与配置源 / 当前版本侧迁移与自愈 / 冻结的升级台阶链 |
| `src/catalog.ts` `src/lookup.ts` `src/compat.ts` | 缓存与目录拍平 / id 匹配与档位转换 / 路由 compat 纯写入计划 |
| `src/fix.ts` `src/empty.ts` | 填充（计划函数 `planFill` + 编排）/ 空壳字段唯一判据 `stripEmptyFields` |
| `src/subagent.ts` | 子智能体推理级别：宿主 `agent/request` 瀑布里按 `subagent.follow` 把子智能体的调用配置覆盖为父 Agent 当前生效的路由三件套（每请求现算，不预检档位可用性） |
| `src/reset.ts` `src/restore.ts` `src/prune.ts` | 重置推理级别 / 启动备份与交集恢复 / 剔除不支持档位 |
| `src/guard.ts` `src/host.ts` `src/section.ts` `src/writeback.ts` | 事件流守卫 / `queueTask` / settings 段读取收口 / 写回 `llm-pi-ai` 段的统一外壳 |
| `src/probe-verdict.ts` `src/probe-plan.ts` `src/probe-report.ts` `src/probe-engine.ts` | 验证与探测式填充共用的判定 / 计划 / 汇报 / 执行四层 |
| `src/verify.ts` `src/probe.ts` `src/fill.ts` `src/probe-backup.ts` | 验证执行器 / 探测式填充执行器与两次写回 / 崩溃兜底备份 |
| `src/rpc.ts` `src/rpc-route.ts` `src/refresh.ts` | 四个写回端点 / 两条进度流 / 保鲜刷新 |
| `src/client/index.tsx` `src/client/memory-listener.ts` `src/client/rpc-carrier.ts` | 席位注册与编排 / 推理级别记忆监听 / 调 Node 半的唯一出口 |
| `src/client/card.tsx` 与同目录的 `tile.tsx` `confirm.tsx` `verify-dialog.tsx` `probe-dialog.tsx` `card-styles.ts` `card-meta.tsx` | 卡片的编排 / 瓦片 / 二次确认 / 两个弹层 / 样式 / 末尾联系行 |
| `src/client/model.ts` `effort.ts` `scope.ts` `locale-keys.ts` `locale-zh.ts` `locale-en.ts` | 快照↔配置映射 / 记忆纯逻辑 / decode 包装 / 键契约与两种语言 |
| `public/models-cache.json` `icon.svg` `cordis.patch.yml` `locale/*.json` | 缓存副本与包根静态资源，不经 tsdown |

## 硬约束（违反即坏）

### 跨半与宿主契约

- **宿主契约文档纪律**：本插件对宿主的一切依赖——服务调用与事件订阅（含签名与参数位序假设）、宿主类型导入面、依赖宿主字面量的键/码/路由/slot 名、宿主运行时行为假设——一律登记在 [`docs/host-api.md`](docs/host-api.md)。**改动只要落在上述任一类，同一轮必须更新该文档**，本节只留纪律与索引、不复制正文。修宿主 bug、升宿主版本、发现新的宿主行为假设时同样适用；宿主升到新大版本还要过一遍该文档末尾的「升级宿主时的检查清单」。
- **导入别名纪律**：`src`/`test` 的源码导入一律以 `@/`（→`src/`）或 `@test/`（→`test/`）开头，禁相对路径；映射须同时声明在 tsconfig `paths` 与 tsdown 各配置 `alias`（tsdown 不读 paths）。别名键锚定 `@`，不吞 `@deepseek-ai/*`。
- `tsdown.config.ts` 内置**双向纯度门禁**：浏览器半 `@/` 值导入只放行 `@/shared/*` 与 `@/client/*`，node 半禁 `@/client*`，两侧禁相对导入（防 `node:path`/schemastery 进浏览器包）。新增跨半依赖前先判断该进 `src/shared` 还是走字面量/契约复制。
- 浏览器半 externals 只允许宿主模块表基线那几项（权威列表在宿主 `@deepseek-ai/dsh-client-web` 的 `src/platform.ts`，本仓副本在 `PLATFORM_MODULES`），其余一律打进包。
- `package.json` 的 `dsh.client.inject` 是**依赖包图边**（槽位所有者包），不是 cordis 服务名；服务名只写在 `src/client/index.tsx` 的 `export const inject`。client 模块须 `export const name` 且等于包名，并复刻 `window.__ModuleLoader__.load` 闭包工厂契约（banner/intro/footer 三段）——声明 `dsh.client` 后缺 `lib/client.js` 会让宿主激活期聚合抛错，故 **build 必须先于安装**。
- settings 命名空间键 = `cordis.patch.yml` 的 `id`，须与浏览器半 `configForms.get(NS)`、Node 半写回 NS **同一字面量**（`PLUGIN_NS`）；换包即换 id，升级传播无需用户操作。
- `Config` 导出 = `z.any().volatile()`：**不能用 dict**（宿主对 `type === 'object'` 的 schema 逐字段投影会把整段抹成 `{}`）；根 volatile 使宿主把整段作为实时引用注入 `apply` 第二参，`.get()` 必须留在工厂内。
- 浏览器半：`configForms.get(ns)` 只收 entryId、不转发 decode spec，解码责任全在 `makeScope`，且 decode **永不返回 undefined**。`get` 查无 NS ⇒ 卡片显「配置不可用」（NS 不匹配的判定特征）；decode 失败则永停「加载中」，两者可区分。`ctx.inject(['configForms'])` 只是标记服务（**不进父级 `inject`**），共享编排体一律走父 ctx。
- 宿主类型面一律 type-only 导入 devDep 的 `/client`、`/types` 与 `node:http`，构建期擦除、不落运行期依赖；升宿主时 typecheck 即暴露不兼容。**`ctx.llm` 同样只做 type-only 引用**：凭据只在宿主凭据缝内可读，验证请求必须经宿主 `LlmRuntime.stream` 发出，故 `dependencies` 不长新条目；档位 id 用 `as ReasoningEffortId` 断言而不引运行期构造器。`llm` 是 `src/index.ts` 的 `inject` 依赖（非可选子 fiber）：插件以模型配置为业，无它即无从工作，不做缺席降级分支。
- **对外纪律**：`@deepseek-ai/cordis`/`schemastery` 取宿主本体自己声明的线，`peerDependencies` 同版作下限（pnpm 会把 `>=` 归一成成品版本号，加完须手工改回）；**官方包一律 optional peer + devDep 同版兜底，`dependencies` 目前为空**。两处 `engines.dsh` 同值、range 一律 `>=` 不用 caret；**不写 `@deepseek-ai/dsh` peer**（pnpm 默认 `autoInstallPeers: true`，缺失 peer 会被真装进来并拖入整棵 CLI 树，兼容性谓词改由 `dsh-*` 子包 peer 承担）。
- 词典 `ctx.locale.register` 重复注册会抛错，须经 `ctx.effect` 挂 disposer 保 HMR；卡片样式经 `src/client/card-styles.ts` 的模块级幂等 `<style>` 注入并带 `data-plugin` 标记供宿主 HMR 认领。

### 宿主 settings 的脾气

细则与宿主源码引用见 [`docs/host-api.md`](docs/host-api.md) 的「settings：配置读写」与「settings：变更事件与装载时序」两节；此处只留五条判据。

- 根写入要求纯对象 ⇒ 自有配置用 `version-N -> 快照` 的**映射**而非列表；段 schema 必须宽松（`z.any()`），严格校验只针对当前版本快照值。
- 改数组元素一律**整段 `set` 覆盖**（`fix` 按 provider 整段写回 `models`，未变更元素原样保留）——这条写法在「宿主支持 / 不支持数组下标中间段」两种语义下都成立，不押注任何一侧。
- `unset` **不折叠**被清空的父对象 ⇒ 删空对象要整段 `unset`，否则留下脏壳反复触发写入判定。
- 命名空间装载时序：`llm-pi-ai` 早于本插件 `apply` 可读；自有 NS 可能晚于 apply ⇒ `migrateConfig` 有界轮询等待（`MIGRATE_WAIT_MS`），读不到即早退不写。**迁移必先于填充**，否则旧格式会被按新 schema 误解析。
- 宿主事件可能在其 HMR 事务的 AsyncLocalStorage 上下文里同步派发，defer 到宏任务也逃不掉 ⇒ **全部 settings 写回一律经 `queueTask`**。收口在写 choke point 而非事件入口，新增调用路径天然安全。

### 版本快照与冻结形态

全文见 [`docs/versioning.md`](docs/versioning.md)。三条：形态变化的判据与台阶命名（新增顶层配置组 ⇒ 递增 `CONFIG_VERSION` 并加台阶，只往 `compat` 组内加键不算）；冻结类型 `V3`–`V7` 与台阶链**不随当前版本演进**，台阶链与当前版本侧分居两文件，互不顺手改；提升 `MIN_SUPPORTED_VERSION` 时连带移除已无输入的冻结类型与台阶。

### 工具链陷阱

全文见 [`docs/workflow.md`](docs/workflow.md) 的「工具链陷阱」。最容易踩的一条：`pnpm test` 走专用单对象配置 `tsdown.test.config.ts`，禁止指回数组主配置。

## UI 无痕融合纪律

全文见 [`docs/ui-fusion.md`](docs/ui-fusion.md)。总纲一句：**官方用导出组件就用同一组件；官方自绘且无同款导出原语（或不导出）就在本地逐字复刻其源码——数值零自造**，只有数据、文本与业务逻辑属于我们。

## 设计裁决（提纲）

代码里看不出动机的前提，全文见 [`docs/decisions.md`](docs/decisions.md)。改动下列任一模块前，先读对应条目：

- **解析与填充**：快照优先级（当前版本 → 更高版本降级 → 默认，非法或残缺按当前生效值规范化）；`allowUpdate` 含缺失补写、数据无档位不删已有值；`force` 单次绕过；`fix` 读 `descriptor.user` + revision 围栏；空壳字段一律删且**判据只有一处** `stripEmptyFields`（`reasoningEfforts`/`input`/`compat` 的空形态等同未声明，`fix`/`reset`/`restore`/`prune`/`fill` 五条写回路径共用，缺失补写也按清理后的值认）；`compat` 开关即增删且只写路由级。
- **排除与列表**：`excludes` 是零操作排除而非撤销；允许填不存在的 id；不自动清理失效 id（列表顺序即录入意图）。
- **参数来源**：图片模态只缓存正向信息；`99999999` / 0 视为无该字段；id 匹配宁可漏不错配；档位序取 `EFFORT_LEVELS`。
- **推理级别记忆**：`efforts` 是运行时记忆而非用户配置；Node 半只持久化不自动设级别；`rememberEfforts` 关闭只停「保存新的」；`defaultHigh` 三条护栏；两个开关都不读 `excludes`。
- **写回端点**：重置只剔 `reasoningEfforts`、不写配置段；恢复备份只回退交集、绝不延迟补捕；写回端点以守卫互斥。卡片侧同理：五个动作键（强制更新 / 重置推理级别 / 恢复备份 / 验证模型 / 探测式填充）共用一个占用态 `configLocked` = 在途或任一弹层开着，任一处在途/开着时其余四个一并禁用。
- **验证**：只读诊断、只由用户主动发起、即用即弃；受理**只认 `block-start`、不看内容**（`usage` 不算受理）；失败**只按** `LlmFailure` 的 `code` 分类（**全程不比对报错文案**，理由见 host-api），**限流与超时归瞬态**（既不判不可用也不短该模型的后续档位），端点不可达只认 `TRANSPORT`/`STREAM_CLOSED`、凭据无效即短路整组、额度耗尽只压该模型（额度多半按模型设，故**不否凭据**）；**短路只有一条判据：能断定后续必然失败才短**（模型级用 `shouldSkipModelTailAfterBaseline`——基线不带档位、失败天生与档位无关，故额度耗尽与「厂商确定性拒绝」够格短该模型剩余档位；上游 5xx、参数不正确、限流与超时一律不短），档位不支持只记录不短路；退化完成不算报错；每 provider 单并发、跨 provider ≤5 路、无退避；档位开关关态=**不发** `reasoningEffort`（端点可能有默认级别）；收尾统计随开关分两档（关=模型口径，开=级别口径且分母取 `plannedEfforts`）；浏览器半逐模型声明 `needTest`，为真的模型由执行器现发一次不带档位的**基线探测**（不进计划/明细/统计，跑通不发帧，不通则发一条模型级记录：够格的失败据此短该模型，限流与超时只记录、照常逐档验下去），基线已通且该档被判 `INVALID_REQUEST` 即判不支持且**不**短后续（控制变量法：两次请求唯一变量就是档位）；弹层自确认（记录区是弹层内与模型列表并列的第二个选项卡，点「验证」即切过去），SSE 流实时逐条展示、主键在途变「停止」、**关窗 / 断连即中止**且中止不发 `done`；跑完有明确不支持结论即弹剔除确认层（明细由 `unsupportedEfforts` 直接给出、经 Node 半写回，守卫不可省）。
- **探测式填充**：逐档试出可用的推理级别并**立即写回**（与验证共用执行引擎，只差注入的 `runGroup`）；**必须先把候选档位临时预声明进配置**（宿主按配置里声明的档位本地校验，未声明的档位不出网），同轮结束时收敛回收回、增删统计以预声明之前那份为基线；**两级短路与验证同一条判据**（`providerBlockReason`：端点不通 / 凭据无效 / **本组首个请求超时**即短整组；`shouldSkipModelTail`：模型级只有**额度耗尽**够格、短到该模型自己的档位尾，被短模型按「没跑完」还原），「不支持」的第二条件是「同模型已有更低档跑通」——比基线探测更紧且零成本，故**不发那次额外的基线请求**；收敛口径由「剔除不支持」开关选（关=`可用 ∪ 原有`，开=`可用 ∪ (原有 − 明确判不支持)`，**该开关只对「探测所有」有效**——未填充者无档位可剔，那一轮按关下发并在途禁掉），只认明确状态，档位表算空即删键，**没跑满结论的一律还原、本轮被中止则整轮还原**（必须完全跑完才谈补全，不做「探到多少补多少」）；「忽略排除」是**唯一**突破「排除约束一切写入」的地方且同时管探测与写回；守卫**持有整轮**；**开跑前先把整段 providers 压一份兜底备份**（自有段顶层键 `probeBackup`，与 `version-N` 同级故不进快照、也**不递增 `CONFIG_VERSION`**），收敛落盘后清掉，**启动链末尾（首轮 fix 之后）见键即回退**（交集语义复用 `planRestore`，回退后再补一轮 `fix`，否则被撤掉预声明的模型会停在未填充态）；存不下备份即整轮中止；收敛写回在流内完成、终帧最后发，故统计随 `VerifySummary.fill` 回来而无独立写回端点；跑完**延迟 2.5s 再关窗**。
- **宿主与卡片**：RPC channel 自注册；按钮取「保存」不取「应用」；卡片末尾固定联系行；不引入 `failed` 态、不做「恢复默认」。**弹层正文内部纵向间距一律 12px**（段落区各套一层 `.dsh-mf-verifyBody` 把节奏收在一处、各段自身 margin 归零——宿主 `.body` 无 gap 而 flex 里 margin 不叠加，逐处自给必算错；验证弹层的正文是「额度提示 → 选项卡条 → 当前面板」三段相邻，未选中的面板带 hidden 即 display:none、不是 flex 项，换页后不留空段；列表项用默认无 gap；两个弹层各在一文件：`verify-dialog.tsx` 与 `probe-dialog.tsx`），正文到 footer 交给宿主 `.dialog` 的 20px；卡片动作键行与瓦片的距离就是 `.dsh-mf-body` 的 `gap:12px`，`.dsh-mf-bar` 不再自带 padding。

## 数据流与目录

骨架与每个目录的完整职责见 [`docs/architecture.md`](docs/architecture.md)。两句话：段变更按 ns 分流为「自有段自愈→填充」与「llm-pi-ai 段填充→保鲜刷新」两条链，入口先判事件流守卫；浏览器半是 `configForms` → `makeScope` → 四席共用同一张卡 + 记忆监听子 fiber。

## 命令

`pnpm build` / `typecheck` / `lint` / `test` / `pack:release`；提交前必跑。测试规范与工具链陷阱见 [`docs/workflow.md`](docs/workflow.md)。

## 专题文档

`AGENTS.md` 只留索引与硬约束，大段细则各归一文件：

| 文档 | 内容 |
| --- | --- |
| [`docs/decisions.md`](docs/decisions.md) | 设计裁决全文：代码里看不出动机的前提与理由 |
| [`docs/host-api.md`](docs/host-api.md) | 宿主契约：Cordis / settings / llm / client 各面的实际用法与宿主源码引用 |
| [`docs/architecture.md`](docs/architecture.md) | 目录职责表全文与数据流骨架 |
| [`docs/ui-fusion.md`](docs/ui-fusion.md) | UI 无痕融合纪律全文 |
| [`docs/versioning.md`](docs/versioning.md) | 版本快照与冻结形态全文 |
| [`docs/workflow.md`](docs/workflow.md) | 命令、工具链陷阱与测试规范全文 |

`docs/` 下这些文件都不是构建产物，一律不进 `files`。