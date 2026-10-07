# 宿主 API 与类型契约（改前必查）

本文是**本插件实际在用的宿主面**的单一事实源：宿主服务与事件的调用方式、宿主类型的导入面、依赖宿主字面量的键与码、以及代码里依赖的宿主运行时行为假设。宿主有而本插件没用的 API 一律不写。

- **更新纪律**（规则本体在 `AGENTS.md`「跨半与宿主契约」→「宿主契约文档纪律」，本文不重复纪律正文）：改动下列任一内容时，**必须同一轮改动同步更新本文**——① 宿主服务/事件的调用方式或签名假设；② 宿主类型导入（模块、符号、`/client` 还是包根、`import type {}` 声明合并还是具名导入、值导入还是 type-only）；③ 依赖宿主字面量的键、码、路由、slot 名；④ 宿主运行时行为假设（写入语义、装载时序、事件时机、连接生命周期）；⑤ 版本基线与平台模块表。升级宿主 devDep 时另须逐条复核「已知漂移与观察项」。
- 条目按主题分组，新增追加到对应分组末尾，不打散既有顺序；与 [`decisions.md`](decisions.md) 同一纪律：本文写「是什么」，`decisions.md` 写「为什么」。
- **宿主侧的引用一律只写「包名 + 包内文件路径」**（如「`@deepseek-ai/dsh-settings` 的 `src/index.ts`」），**不写行号、不写宿主仓库内的完整目录路径**。理由：宿主源码不在本仓的跟踪范围内，它的内容随宿主版本整体漂移，行号与检出布局对本仓没有稳定含义；本文要锁住的是「这条契约来自宿主哪个包的哪个文件」，而不是某一行的快照。核对签名请对着**本仓 devDep 声明的那个版本**去查；本地另有一份宿主源码检出仅供翻阅便利。
- 引用本仓自身代码时直接写 `src/`、`test/` 下的路径。
- 签名以本仓 devDep 声明为准（`engines.dsh` 与各 `@deepseek-ai/dsh-*` devDep 同为 `0.1.7-rc.2`）。若查阅时手里的宿主源码比该版本新，**差异记入「已知漂移与观察项」，不顺手改代码**。

## 宿主服务与运行时面

本节只写本插件真的调到的面。凡与本仓 devDep 声明的宿主版本有出入的，一律写在「已知漂移与观察项」。

### settings：配置读写

- **服务面**：`ctx.settings`，服务名字面量 `'settings'`（`@deepseek-ai/dsh-settings` 的 `src/index.ts`，类名是 `SettingsForms`，`static inject = ['configEditor','profileContext']`）；`ctx.settings` 的声明合并在同一文件的头部。本插件把 `settings` 放进 `src/index.ts` 的 `inject`，非可选。
- **`describe()`**：`describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]`。descriptor 字段为 `ns / autoGenerate / schema / value / revision / base? / user? / applies:'live' / secrets?`（同文件顶部的类型与 `describe` 返回字面量）——**没有** `namespace` / `userSettings` 之类别名。本插件只用 `{ ns, user, revision }`，且刻意不传 `redactSecrets`（要拿明文 user 层做比对）。
- **`mutate()`**：`async mutate(ns: string, ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<void>`，**返回 `void`**（同族 `update` / `replace` 亦然）。所以「变更数」只能自己数，不能指望返回值。
- **`SettingsPathOp`**：`{ op:'set'; path: readonly string[]; value: unknown } | { op:'unset'; path: readonly string[] }`（同文件）。客户端面另有 `SettingsPathOpView`（`@deepseek-ai/dsh-settings` 的 `src/types.ts`，`path: string[]`、`value: JsonValue`）——`src/client/scope.ts` 的 mutate 因此要 `as Parameters<ConfigForm<unknown>['mutate']>[0]` 桥一次。
- **冲突**：revision 不符时 `mutate` **抛** `SettingsConflictError`（同文件，`readonly code = 'SETTINGS_CONFLICT'`，带 `expected` / `actual`），抛出点在 `mutate` 内的 revision 围栏检查处（抛 Error 而非返回失败值）。本插件在 `src/reset.ts` / `src/restore.ts` / `src/prune.ts` / `src/fix.ts` 按 `err.code === 'SETTINGS_CONFLICT'` 捕获重试；**宿主换码或改成返回失败值都会让重试退化为一次失败**。
- **写入语义（`applyPathOp`，同文件）**：
  - 根必须是纯对象：`if (!isPlainObject(result)) throw new TypeError('Config root must be a plain object')`，而 `isPlainObject`（同文件）显式排除数组 ⇒ 自有配置只能用 `version-N -> 快照` 的**映射**，不能用列表（这正是本仓形态的原因之一）。
  - `unset` 只删本键、**不折叠空父对象**：`if (child === undefined) Reflect.deleteProperty(result, head)`。⇒ 删空壳必须整段 `unset`，否则留下 `{}` 反复触发写入判定（`src/compat.ts` 的整段 unset、`src/empty.ts` 的空壳判据都建立在这条上）。
  - **只允许写 volatile 字段**：`mutate` 与 `replace` 两处均 `throw new Error(\`Config field "${path.join('.')}" is not volatile\`)`，判定函数 `isVolatilePath`（`@deepseek-ai/dsh-settings` 的 `src/schema.ts`）。本插件两处写入都在 volatile 子树下：自有段 `src/index.ts` 的 `Config = z.any().volatile()`（根 volatile ⇒ 整段可写），宿主段 `llm-pi-ai` 的 `providers: z.dict(profile).default({}).volatile()`（`@deepseek-ai/dsh-llm-pi-ai` 的 `src/config.ts`）⇒ `providers.<id>.models` 与 `providers.<id>.compat` 可写，段外字段不可写。
  - 本仓「`fix` 按 provider 整段 `set` 覆盖 `models`、不写数组下标中间段」是**兼容两侧读法的安全子集**，不依赖下标支持与否（宿主较新版本的数组分支已支持下标并对越界抛 `Config array index "${head}" is out of range`，见「已知漂移」）。

### settings：变更事件与装载时序

- **`settings/document-updated`**：声明在 `@deepseek-ai/dsh-settings` 的 `src/types.ts`，payload 是**两个位置参数** `(ns: SettingsNamespace, revision: number)`，`ns` 是品牌字符串（`SettingsNamespace = Branded<'SettingsNamespace'>`，同文件）。发出点在 `src/index.ts` 的条目刷新处：一处是 raw 变或 autoGenerate 变（条件 `if (previous?.raw !== raw || previous.autoGenerate !== autoGenerate)`），一处是条目消失。本插件 `src/index.ts` 的事件接线只取第一个参数做 ns 分流（自有段 → 自愈+填充；`llm-pi-ai` 段 → 填充+保鲜刷新），入口先过 `isIgnoreAll()` 短路。
- **该事件只在 RAW 段变更时发**：不是每次 `mutate` 都发，宿主自动生成的段不发。这条是「守卫期间短路整条事件链」的必要前提。
- **自有 NS 的登记晚于 `apply`**：`@deepseek-ai/dsh-settings` 没有命名空间注册事件、没有 ready promise（宿主全仓检索无此面）；NS 由宿主 Loader 异步登记。故 `src/migrate.ts` 用有界轮询（`MIGRATE_POLL_MS = 50` / `MIGRATE_WAIT_MS = 2000`）等 `describe()` 出现 `PLUGIN_NS`，读不到就早退不写。迁移必须先于填充，否则旧格式会被按新 schema 误解析。
- **宿主事件可能在它自己 HMR 事务的 AsyncLocalStorage 上下文里同步派发**，defer 到宏任务也逃不掉 ⇒ 全部 settings 写回收口在 `src/host.ts` 的 `queueTask`。收口在写 choke point 而非事件入口，新增调用路径天然安全。

### llm：验证请求

- **服务面**：`ctx.llm`，`export class LlmRuntime extends TypertRemoteService`，`super(ctx, 'llm')`（`@deepseek-ai/dsh-llm` 的 `src/index.ts`），声明合并在同一文件。本插件把它放进 `src/index.ts` 的 `inject`（非可选），但**只做 type-only 引用**。
- **`stream(options: GenerateOptions): AsyncIterable<StreamChunk>`**（`@deepseek-ai/dsh-llm` 的 `src/index.ts`），实跑走 `ctx.waterfall(this, 'llm/stream', options, …)`。适配器抛错被宿主归一化成终端 finish（`signal?.aborted || failure.code === 'ABORTED'` → `aborted`，否则 `error`）——**本插件拿到的一定是 finish 帧，不接异常**。
- **`GenerateOptions` 字段名逐字**（`@deepseek-ai/dsh-llm` 的 `src/types.ts`）：`provider` / `model` / `reasoningEffort?` / `messages` / `system?` / `tools?` / `toolHistory?` / `temperature?` / `maxTokens?` / `stop?` / `signal?` / `sessionId?` / `purpose?`。`src/probe-engine.ts` 的 `llm.stream` 调用点只用 `provider` / `model` / `reasoningEffort` / `messages` / `signal`，其中 `signal: AbortSignal.any([外部 signal, 自建超时 controller])`。
- **`StreamChunk` 判别联合**（`@deepseek-ai/dsh-llm` 的 `src/types.ts`）：`block-start`（`{ index, blockType }`）/ `text-delta` / `reasoning-delta` / `tool-call-delta` / `block-end` / `usage` / `finish`（`{ reason, replayState? }`）。索引字段名是 **`index`**（不是 `blockIndex`）。`src/probe-engine.ts` **只认 `block-start` 判受理**（收到即中断），`usage` 不算受理。
- **`FinishReasonMap`**（同一文件，merge-extensible、按 `kind` 分派须留 fallback）：`stop` / `tool-calls` / `max-tokens` / `aborted`（带 `failure`）/ `error`（带 `failure`）。`failure` 字段只在 `aborted` 与 `error` 两支存在 ⇒ 读 `reason.failure` 前必须先判 `kind`（本插件判 `kind !== 'error' && kind !== 'aborted'` ⇒ 退化完成，不算报错）。
- **`LlmFailure`**（同一文件）：`message` / `code: string`（**自由字符串、无枚举类型**）/ `status?` / `providerRetryAfterMs?` / `requestId?` / `offloadImages?`。⇒ 分类只能按 `code`；`status` 在 pi-ai 路径上恒缺（上游把错误压平成 `{message, code}`），**不可用「status 缺失」推断端点不可达**。
- **失败码来源（`src/probe-engine.ts` 的分类依据）**：`@deepseek-ai/dsh-llm` 的 `src/error.ts` 定义核心常量 `QUOTA_EXCEEDED_CODE='QUOTA'`、`ACCOUNT_QUOTA_EXCEEDED_CODE='ACCOUNT_QUOTA'`、`INVALID_CREDENTIAL_CODE='INVALID_CREDENTIAL'`、`EMPTY_RESPONSE_CODE`、`CONTEXT_WINDOW_EXCEEDED_CODE`；`src/index.ts` 抛 `UNSUPPORTED_REASONING_EFFORT` 与 `NO_ADAPTER`；`src/retry-policy.ts` 的默认可重试集含 `RATE_LIMIT`/`TIMEOUT`/`TRANSPORT`。
- **本插件走的是 `llm-pi-ai` 路由**（自定义提供方），其错误是**按文案正则归一化**的：`@deepseek-ai/dsh-llm-pi-ai` 的 `src/stream.ts` 里 `classifyPiAiError` → `AUTH` / `QUOTA` / `RATE_LIMIT` / `INVALID_REQUEST` / `SERVER` / `TIMEOUT` / `TRANSPORT` / `PI_AI_ERROR`；同文件另抛 `STREAM_CLOSED`；`src/adapter.ts` 抛 `UNSUPPORTED_REASONING_EFFORT`；`src/index.ts` 抛 `MISSING_CREDENTIAL`；`src/discovery.ts` 用 `INVALID_CREDENTIAL_CODE`。**文案里没有 `status` 与 `cause`**（`src/stream.ts` 的注释：pi-ai 上游把 Error 压平成 `error.message`）——这就是本仓「只按 `code` 分类、全程不比对报错文案」的宿主依据。
- **`INVALID_CREDENTIAL` 与 `AUTH` 是两个码**（`src/error.ts` 的注释明确区分：前者是「给了但不能用」，该改值；后者是上游鉴权失败），本仓凭据无效只认 `INVALID_CREDENTIAL` / `MISSING_CREDENTIAL`，不认 `AUTH`。
- **`ReasoningEffortId`**：`@deepseek-ai/dsh-llm` 的 `src/brand.ts` 里是 `Branded<'ReasoningEffortId'>`，同时有运行期工厂 `ReasoningEffortId(id)`（**不做任何校验**）。本仓**只 type-only 引用类型、用 `as ReasoningEffortId` 断言**，不引运行期构造器（值面不落运行期依赖）。
- **档位 id 取值由适配器自定**（宿主类型面 `src/types.ts` 的 `LlmReasoningEffortInfo{ id, name, description? }` 与 `LlmModelReasoningInfo{ efforts, defaultEffort? }`）；本仓的档位名来自 models.dev 目录（`src/lookup.ts` 的 `toReasoningEfforts`），不是宿主枚举。不传 `reasoningEffort` 时宿主按 `defaultEffort` 物化（`src/index.ts` 的 `stream` 实现内）——这正是「关档位 = 不发该字段，而不是取最低档」的宿主理由。
- **宿主按模型公告的档位本地校验显式档位，未公告即拒绝、请求不出网**：`resolveCallWithInfo(config, info)`（`lib/index.js:2174-2188`）里 `info.reasoning === undefined` 时只要带 `reasoningEffort` 就抛 `UNSUPPORTED_REASONING_EFFORT`，否则该档位不在 `reasoning.efforts` 里同样抛（`requested ?? reasoning.defaultEffort` 物化后比对）。**这条决定「探测式填充」整个形态**：带档位的探测只可能落在配置里已声明的档位上，故 `src/probe.ts` 必须先把候选档位**临时预声明**进模型配置（否则七档全被本地拒绝、探测不到任何东西），并在同一轮结束时收敛写回。`info.reasoning` 来自适配器的 `resolveModel`（`resolveModelInfoFor`），每次请求现取。

### hmr：`executing`（私有面）

- `ctx.get('hmr')` 的服务类是 `@deepseek-ai/dsh-hmr` 的 `src/index.ts`（`super(ctx,'hmr')`），其 **private** 字段 `executing = new AsyncLocalStorage<boolean>()` 也在该文件，用途是标记「当前异步上下文正在跑一次 HMR 事务」：`runExclusive` 在事务内重入直接 reject、配置 watcher 靠 `getStore() === true` 排队、卸载时靠 `getStore()` 避免自等待。
- `src/host.ts` 的 `queueTask` 就是 `(ctx.get('hmr') as { executing?: unknown } | undefined)?.executing`，`instanceof AsyncLocalStorage` 则 `als.exit(task)`、否则裸 `task()`。**这是私有字段、非公共 API 面**，宿主改名即静默降级（写入仍在事务上下文内跑，功能不坏但可能触发写入判定抖动）。升宿主必须复核该字段名。

### connection：RPC channel 与验证流

- **服务面**：`ctx.get('connection')`，`export class HostConnectionService extends Service implements HostConnectionHandle`（`@deepseek-ai/dsh-client-connection` 的 `src/rpc-host.ts`，`super(ctx,'connection')`），声明合并在同一文件 ⇒ `ctx.connection: HostConnectionHandle`。
- **connection 的 `inject` 只有 `['credentials']`**（`@deepseek-ai/dsh-client-connection` 的 `src/index.ts`），**不含 `webServer`**；`webServer` 是 apply 内二次注入（同文件，`ctx.inject(['webServer'], …)` 注册 `kind:'prefix'` 的 `/api` 路由）。⇒ 本插件必须**同时** inject `['connection','webServer']`（`src/rpc.ts`），走 `owner.webServer` 必抛 `cannot get property "webServer" without inject`；反之也不能用宿主的 `connection.rpc.handle`（它内部要 webServer 与 shared channel 语义）。
- **`HostConnectionHandle` 关键成员**（`@deepseek-ai/dsh-client-connection` 的 `src/rpc.ts` 的接口声明）：`rpc: HostConnectionRpc`、`fetch: HostConnectionFetch`、`operator: PeerScope`、`createSharedFetchHandler('/api')`、`requestRejection(request)`、`admit(request)`、`authorizeIndex`、`authenticatedUrl`。本插件只读 `requestRejection` 与 `fetch`（`src/rpc.ts` 的 `Pick<HostConnectionService,'requestRejection'|'fetch'>`）。
- **`requestRejection`**：返回 `401 | 403 | undefined`（接口在 `src/rpc.ts`，实现在同包 `src/rpc-host.ts`）：先 Host/Origin 围栏不过 ⇒ `403`，再浏览器认证不过 ⇒ `401`，否则 `undefined`。宿主自己的 RPC 路由在拒绝时 `res.writeHead(rejection); res.end(rejection === 401 ? 'unauthorized' : 'forbidden')`——`src/rpc-route.ts` 的围栏段逐字照抄了这对文案。
- **`connection.fetch.register(route)`**：`ConnectionFetchRoute{ path, methods, requestBody, fetch }`（`src/rpc.ts`），`methods` 取 `'GET'|'HEAD'|'POST'`、`requestBody` 取 `'buffered'|'streaming'`，`path` 必须是 `/api` 下的绝对路径（`src/rpc-host.ts` 的 `assertFetchRoute`），重复注册抛 `connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`。**返回异步 disposer**（接口里就是 `() => Promise<void>`）⇒ `src/rpc.ts` 的 disposer 里 `void disposeStream()`。
- **fetch 回调收到标准 WHATWG `Request`**：`@deepseek-ai/dsh-client-connection` 的 `src/http-bridge.ts`（buffered 走 `new Request(url,{method,headers,body})`，streaming 走 `Readable.toWeb(req)` + `duplex:'half'`）。**`request.signal` 在客户端断开时 abort**（同文件，`res.on('close', () => { if (!res.writableEnded) abort.abort() })`）——这是「关窗/断连即中止验证执行」的宿主机制，本仓把它接到 `verifyModels` / `probeAndFill` 的外部 `signal`。
- **`buffered` 受配置的 JSON 体上限约束**（`src/rpc-host.ts` 的 `requestBodyMode`：命中 exact route 且 method 匹配才取其 mode，否则一律 `buffered`）；共享 `/api` 分发顺序为 exact routes → interceptor → `404`（同文件）。
- **RPC 信封与结果类型**（本插件在 `src/rpc-route.ts` 手搓的那套，类型面全在 `@deepseek-ai/dsh-client-connection` 的 `src/rpc.ts`）：
  - `ClientRequest{ type:'client-request'; rpcId; method; payload }`、`ServerResponse{ type:'server-response'; rpcId; result }`、`RpcMessage` 判别联合。宿主落地响应体（`src/rpc-host.ts`）正是 `{ type:'server-response', rpcId, result }`。
  - `RpcId = Branded<'rpc-id'>`，有运行期构造器 `RpcId(id)`；本仓不引它，只用 `INVALID_RPC_ID = 'invalid-request'` 哨兵字面量。
  - `ConnectionRpcResult<T> = { ok:true; value:T } | { ok:false; error: ConnectionRpcFailure }`，`ConnectionRpcFailure{ code; message; details: object }`（**`details` 必填**）；handler 侧另有带附件的 `ConnectionRpcHandlerResult`。
  - 信封层错误码 `gateway/bad-request` 两处（均在 `src/rpc-host.ts`）：method 与 endpoint 不匹配、信封非法（`message: 'invalid client-request message'`）。传输层失败走 `transportError` 产出 `code:'gateway/internal'`（`src/rpc.ts`）。
  - channel 约束 `CHANNEL_PATTERN = /^\/[A-Za-z0-9._~-]+$/` 且不得是 `/api`（`src/rpc-host.ts` 的 `assertChannel`）；endpoint 段 `ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/`（同包 `src/client/rpc.ts`）——本仓 `src/rpc-route.ts` 逐字复制了后者。
  - 浏览器侧 `rpc.call(channel, endpoint, payload, signal?)`（接口在 `src/rpc.ts`，实现 `src/client/rpc.ts`）把 channel+endpoint 拼成**文档相对**路径后 POST；非 2xx 抛 `transport failure for …: HTTP <status>`、rpcId 不符抛 `rpcId mismatch …`（**传输失败不是 result**，故本仓卡片把 reject 与 `result.ok === false` 同路处理）。
- **本插件不走 `connection.rpc.handle` 的原因**（写在这里备查）：那条路要求 channel 注册并由宿主解码信封，而本插件要的是「在宿主 webServer 上自持一条 prefix 路由、自己解码信封」，故 `src/rpc.ts` 直接 `webServer.register({ kind:'prefix', path: channel, handler: createChannelRoute(...) })`。

### webServer：prefix 路由

- **服务面**：`ctx.get('webServer')`，`class WebServer extends Service`（`@deepseek-ai/dsh-host-webserver` 的 `src/index.ts`，`super(ctx,'webServer')`）。
- **`register(route: WebRoute): () => void`**（同文件，**同步** disposer），`WebRoute{ kind: 'exact'|'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }`（同文件的类型声明，`path` 注释为「绝对路径、无尾斜杠」）；重复 `(kind,path)` 抛 `webserver: duplicate ${kind} route "${path}"`。
- **prefix 匹配**：先查 exact 表，再遍历 prefix 表，条件是 `pathname !== prefix && !pathname.startsWith(\`${prefix}/\`)` 跳过，取**最长前缀**（`src/index.ts` 的路由查找）⇒ 只要求绝对路径无尾斜杠，**不要求注册在 `/api` 之下**（`/api` 之下只是 connection 的 `assertFetchRoute` 约束）。
- **handler 拥有完整响应生命周期**（同文件 `WebRoute` 的注释：可持有响应不结束，如 SSE）——`src/rpc.ts` 的 SSE 端点据此自己写 `res.writeHead` 与分帧。
- **gzip 中间件跳过 `text/event-stream`**：`src/index.ts` 的 `createGzipMiddleware` 里 `if (typeof contentType === 'string' && contentType.toLowerCase().startsWith('text/event-stream')) return false`；另 `content-range` 存在也跳过。压缩默认关闭（`Config.compression` 默认 `'none'`）。⇒ SSE 不会被缓冲，但**不能依赖压缩去规避背压问题**。

### cordis 基础面

- **`ctx.effect(execute, label?)`**（`@deepseek-ai/cordis` 的 `src/fiber.ts`）：`execute` 立即执行，其产出的 disposer 被收集，**返回的 disposer 调用时或 fiber 卸载时（先到者）逆序执行**，重复调用是 no-op，fiber 已卸载时抛 `CordisError('INACTIVE_EFFECT')`。同步与异步两版返回的都是可 await 的 disposer（`Disposable<Promise<void>>` / `AsyncDisposable<Promise<void>>`）。本插件所有「注册必须挂 effect」的纪律（locale、slot、RPC、启动链）都基于这一条。
- **`ctx.inject(deps, callback)`**（`@deepseek-ai/cordis` 的 `src/registry.ts`）：等价于 `this.plugin({ inject, apply: callback, name: callback.name })`，返回 `Fiber & PromiseLike<Fiber>`。`deps` 形状是 `Inject = (keyof M)[] | { [K in keyof M]?: M[K] }`。**未满足的服务不会报错而是保持 PENDING**（无超时）⇒ 卡片等 `configForms` 必须能长期停在「加载中 / 配置不可用」而不是抛错。
- **`ctx.get(name, strict = true)`**（`@deepseek-ai/cordis` 的 `src/reflect.ts`）：服务未提供时返回 **`undefined` 而非抛错**（类型在同一文件的头部）。`src/host.ts` 的 hmr 降级分支正依赖这一点。
- **`export const inject` / `export const name` / `export const Config`** 是 cordis 的插件声明面；`Config` 的 schema 由宿主 settings 读取（下一条）。

### Config 装载面：`z.any().volatile()`

- 宿主把插件 `Config` schema 交给 settings 派生表单与可编辑投影：`@deepseek-ai/dsh-settings` 的 `src/schema.ts` 的 `volatileForm`（volatile 节点转 plain schema、object 则逐字段挑 volatile 子节点）与 `projectForm`（**`schema.type === 'object'` 时只投影 schema 声明过的字段**，未声明字段直接丢）。
- ⇒ **`Config` 必须 `z.any().volatile()`**：根 volatile 使 `volatileForm` 整体返回 plain schema、`projectForm` 因 `type !== 'object'` 原样返回整段；宿主把整段作为实时引用注入 `apply` 的第二参，`.get()` 必须留在工厂内。若改用 dict（`type === 'object'`），`projectForm` 会把 `version-7` 这类未声明键抹成 `{}`。
- 非 volatile 字段在写入时被拒（见上文 settings 写入语义），这也是自有段能被 `mutate` 写回的前提。

### configForms：配置表单（浏览器半）

- **服务面**：`ctx.configForms`，`export class ConfigForms extends Service`、`super(ctx, 'configForms')`（`@deepseek-ai/dsh-client-ui-settings` 的 `src/client/config-form.ts`）；装配处在同包的 `src/client/index.ts`（`new ConfigForms(ctx, { mirror, schema, persistence })`）。
- **`get<T>(entryId: string): ConfigForm<T>`**（`src/client/config-form.ts`）——**只有 entryId 一个形参，没有 decode spec 第二参**；同一 entryId 复用同一 controller，内部 `new ConfigFormController<T>(this.owner, { namespace: entryId }, …)`，末尾 `void this.mirror.ensure()`。decode 只存在于包内的 `ConfigFormSpec<T>{ namespace; decode? }`，不对外暴露 ⇒ **本仓解码责任全在 `src/client/scope.ts` 的 `makeScope`**。
- **查无 NS 不抛错**：`derive()` 里 `const view = mirrored.view.namespaces.find(candidate => candidate.ns === this.spec.namespace)`，缺失即 `draft.status = 'unavailable'; draft.writable = writable; return`（同文件）。⇒ 「配置不可用」与「加载中」可区分（见下 `status`），本仓卡片依赖这一差异。
- **`ConfigFormSnapshot<T>` 全字段**（`@deepseek-ai/dsh-client-ui-settings` 的 `src/client/config-form-types.ts`）：`status: 'loading' | 'ready' | 'unavailable'`、`value: T | undefined`、`base: unknown`、`user: unknown`、`revision: number | undefined`、`writable: boolean`、`mode: 'host' | 'memory'`。
- **写入方法**（同一文件）：`mutate(ops: readonly SettingsPathOpView[], expectedRevision?: number): Promise<boolean>`、`set(field: string, value: unknown): Promise<boolean>`、`unset(field: string): Promise<boolean>`。JSDoc 逐字：`true for Host acceptance, false for refusal or skipped writes…Transport failures reject.` ⇒ **「被拒」返回 false、「传输失败」reject**，两者语义不同。
- **写入实际路径**：`src/client/config-form.ts` 的 `mutate()` 调 `this.ctx.remote.settings.mutate(this.spec.namespace, ownedOps, revision)`，revision 取 `expectedRevision ?? this.pendingRevision ?? this.getSnapshot().revision`。`memory` 模式直接 `Promise.resolve(false)`（同文件）。
- **持久化模式由连接性质决定**：`@deepseek-ai/dsh-client-ui-settings` 的 `src/client/index.ts` 里 `const persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'` ⇒ 非 loopback 连接下本插件所有保存/写回都返回 false（本仓以 `snap.writable === true` 才允许保存，正是这条的上层体现）。
- **默认解码**（未给 `spec.decode` 时）：`src/client/config-form.ts` 的 `decode()` 用 `this.schema.validate(this.schema.rehydrate(view.schema), view.value)`，且 `typeof view.value !== 'object' || null || Array.isArray` 直接返回 undefined。
- 另有 `whileServed(namespaces, register)`（列出的命名空间全部进 describe 镜像后才调一次 `register`）与 `describe()`（同文件）——本仓未用，`src/migrate.ts` 的有界轮询是 Node 半的等价手段。

### cordis.patch.yml 的 id ↔ 命名空间

- **命名空间 = patch 条目 id**。链路：`@deepseek-ai/cordis-plugin-loader` 的 `src/config/entry.ts` 里 `EntryOptions{ id; name; config?; group?; disabled?; inject? }`（`id` 注释「Stable id inside the containing entry tree」）→ `import(this.options.name)` → `unwrapExports` → `registry.plugin(plugin, this.options.config, …)` → `@deepseek-ai/cordis` 的 `src/registry.ts` 里 `runtime = { name, callback, fibers, Config: plugin.Config }`。settings 侧只读 `entry.fiber.config`：`@deepseek-ai/dsh-settings` 的 `src/index.ts` 里 `const value = projectForm(form, plainConfig(entry.fiber.config))`。
- **登记门槛**：同一文件跳过 fiber 未 ACTIVE 或 `schema === undefined` 的 entry ⇒ **命名空间晚于插件 `apply`**（fiber 先 ACTIVE、schema 先算出）。这就是 `src/migrate.ts` 必须有界轮询等待的原因。
- **无登记完成事件、无 ready promise**：`describe()` 用 `queueMicrotask` 调度，`app-boot/config-reload` 时 `invalidate()`（同文件）；客户端侧只有 `@deepseek-ai/dsh-client-ui-settings` 的 `src/client/index.ts` 里的 `ctx.remote.$on('settings/document-updated', () => { void mirror.load() })`、`ctx.on('connection/reset', …)` 与 `void mirror.ensure()`（fire-and-forget 不 await）；读取面 `src/client/settings-mirror.ts` 的 `ensure()`（仅 `status === 'idle'` 时发起读，内部 `await this.ctx.remote.settings.describe()`）。事件转发声明在 `@deepseek-ai/dsh-api-remotes` 的 `src/remote-events.ts`。

### cordis：config 的实时引用

- **`apply(ctx, config)` 的第二参是 `Volatile<T>` 引用，不是裸对象**：`@deepseek-ai/schemastery` 的 `src/index.ts` 里 `Schema.resolve` 遇 `schema.meta.volatile` 时 `return [createVolatile(value), adapted]`；`@deepseek-ai/cosmokit` 的 `src/volatile.ts` 里 `Volatile<T>{ get(): VolatileSnapshot<T> }`、`createVolatile` 返回 **被冻结的** `{ get: () => current }`，另有 `volatileEntries` 与 `updateVolatile`。
- **必须每次 `config.get()` 读值**，不能缓存解引用结果（本仓 `src/index.ts` 把 getter 交给 `setConfigSource(() => resolveConfig(readVolatile(config)))`，每次读都调 `get()`）。
- **引用身份稳定、就地更新**：`@deepseek-ai/cordis-plugin-loader` 的 `src/config/entry.ts` 里 `volatileOnly` 判定通过后 `this.fiber._config = this.options.config`，可 `_commitVolatile` 则 `pending = []` ⇒ **不重启 fiber**；同文件的 `_commitVolatile()` 逐个 `updateVolatile(ref, source)` 就地写入并 emit `loader/volatile-update`（事件声明在 loader 的 `src/index.ts`，JSDoc「dispatched to the owning fiber only」）。判定辅助 `src/config/diff.ts`。
- **volatile 的位置约束**：`@deepseek-ai/schemastery` 的 `src/index.ts` 里 `validateVolatileSchema` 中 `if (schema.meta?.volatile && blocked) throw new ValidationError('volatile fields require a fixed object path without an enclosing volatile field', { path })` ⇒ 根 volatile 是受支持的形态；`.volatile()` 不能叠加（同文件抛 `volatile schema is already wrapped`）。
- **config 校验入口**：`@deepseek-ai/cordis` 的 `src/fiber.ts` 里 `resolveConfig` 走 `runtime.Config['~standard'].validate(config)`，async schema 抛 `Async config validation is not supported`，有 issues 抛 `ValidationError`；同文件 `_runner.execute` 里 `return runtime.callback(this.ctx, this.config)` ⇒ **这就是 `apply(ctx, config)` 的调用点**。

### slots：四席注册

- **服务面**：`ctx.slots`，`class SlotRegistry extends Service`、`super(ctx, 'slots')`（`@deepseek-ai/dsh-client-ui-renderer` 的 `src/client/registry.ts`）；声明合并在同包的 `src/client/index.ts`。
- **`register`**：同文件的原型赋值 `register = function (this, rawOptions, component) { return this.ctx.effect(() => this['_register'](options, component), 'slots.register()') }` ⇒ **register 必须包在 `ctx.effect` 里**，返回 disposer（可重复调用）。未声明的 slot 直接抛 `slot "${options.name}" is not declared (a parent entry's children table must declare it)`（`@deepseek-ai/dsh-client-ui-slots` 的 `src/index.ts`）。
- **`inject`**：`@deepseek-ai/dsh-client-ui-renderer` 的 `src/client/registry.ts` 里 `inject(key: keyof SlotMap & string, callback: () => SlotInjectionEffect): () => void`，`SlotInjectionEffect = (() => void) | Iterable<() => void, void, void>`（可返回生成器做原子装卸）；内部 `ctx.effect(callback, \`slots.inject(${key}): declaration\`)`。
- **带 inject 的 register 重载**：`@deepseek-ai/dsh-client-ui-slots` 的 `src/index.ts`，`BaseOptions` 为 `{ name: K; children?: D; store?: H; locale?: N; registrant?: string }`。inject 工厂参数 `InjectParams<K, H>`：严格 session 席位给 `sessionId: SessionIdOf`，session-maybe 席位给 `sessionId | undefined`，声明 store 时追加 `actions`。**没有 binding 对象参数。**
- **props 合成**：同一文件的 `ComposedProps<…> = PropsRuntime & PropsRenderSlots & PropsRenderFactories & PropsStore<H> & InjectFace<I> & MatchedShare<SlotMap[K], M> & PropsLocale<N>`。要点：`InjectFace<I>` 里的 `hooks` 会被渲染器绑成 `use<Name>` 选择器 hook（组件看不到裸 observable），其余成员逐字透传；`PropsStore<H>`（`@deepseek-ai/dsh-client-store` 的 `src/contract.ts`）= `{ useStore; actions }`；**只有 `register({ locale: NS })` 声明了命名空间，props 上才出现 `t`**（`PropsLocale<N>`）。
- **条目字段权威定义**：`@deepseek-ai/dsh-client-ui-slots` 的 `src/index.ts` 里 `KindOptions` —— list `{ id: string; order?: number; label?: SlotLabel; priority?: number }`、keyed `{ key: EntryKey; priority?: number }`、chain `{ select; priority?: number }`；`SlotLabel = string | (() => string)`；`resolveSlotLabel(label)`（每次渲染/排序时求值）。
- 本插件四席的宿主契约（slot key → 定义处 → kind → 条目字段）：

| slot key | SlotMap 定义 | kind | 条目字段 |
| --- | --- | --- | --- |
| `settings.models.footer` | `@deepseek-ai/dsh-client-ui-settings-models` 的 `src/client/slot-contract.ts`，owner props `ModelsFooterOwnerProps{ children?: never }`，渲染点在该包的 `src/client/ModelsSection.tsx` | list | `id` / `order?` / `label?` / `priority?` |
| `plugins.bundle.config` | `@deepseek-ai/dsh-client-ui-plugin-manager` 的 `src/client/slot-contract.ts`，owner props `PluginConfigViewProps{ view: 'summary' \| 'page'; form?: ConfigPageForm }`，`ConfigPageForm{ state: ConfigFormSnapshot<Record<string, unknown>>; mutate: ConfigForm<…>['mutate'] }` | keyed | `key`（必填，包名）/ `priority?` |
| `plugins.row.config` | 同上文件（JSDoc：`keyed by \`<package name>#<row id>\` with the row id as the bundle's patch declares it`） | keyed | 同上 |
| `settings.plugins.tab` | `@deepseek-ai/dsh-client-ui-settings` 的 `src/client/contract/slots.ts`，owner props `SettingsPluginsTabOwnerProps{ children?: never }` | list | `id` / `order?` / `label?` / `priority?` |

- **keyed 拼接规则**：`@deepseek-ai/dsh-client-ui-plugin-manager` 的 `src/client/config-ledger.ts` 里 `rowConfigKey(bundle, rowId) { return \`${bundle}#${rowId}\` }` ⇒ 本仓 `${PLUGIN_NAME}#${PLUGIN_NS}` 逐字成立。

### locale：词典与 `t`

- **服务面**：`ctx.locale`，`@deepseek-ai/dsh-client-locale` 的 `src/client/index.ts`：声明合并处挂了服务 `LocaleRuntime` 与事件 `'locale/change'(snapshot: LocaleSnapshot)`，JSDoc 明确**字典注册不发该事件**；类声明也在该文件。
- **`register`**：typed 重载 `register<N extends Extract<keyof LocaleNamespaceMap, string>>(ns: N, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>>): () => void`；另有一个三参旧式重载。实现返回**幂等 disposer**；**重复注册抛错** `throw new Error(\`locale namespace "${ns}" already has locale "${locale}"\`)` ⇒ 本仓一律经 `ctx.effect` 挂 disposer（`src/client/index.tsx`）。
- **`bind`**：同一文件，typed `bind<N>(ns: N): TranslateNS<N>` 与 `bind(ns: string): Translate`；每个 ns 缓存**同一函数引用**（身份稳定，可安全放进 `label` thunk 的依赖数组）。
- **类型面**（`@deepseek-ai/dsh-client-ui-slots` 的 `src/index.ts`）：`LocaleNamespaceMap` 声明合并点（本仓在 `src/client/locales.ts` 扩展）、`Translate<K> = (key, params?) => string`、`LocaleKeysOf<N>`、`TranslateNS<N>`、`LocaleDictOf<N>`。⇒ **调用形态就是 `t(key, params?)`**。
- **locale face 接口**（`@deepseek-ai/dsh-client-ui-slots` 的 `src/renderer.ts`）：`LocaleFace extends HostObservable<{ revision: number }> { bind(ns): Translate }`，`HostObservable<T> = ObservableSnapshot<T>`；安装点是 `@deepseek-ai/dsh-client-ui-renderer` 的 `src/client/registry.ts` 里的 `installLocale(face)`。
- **官方范本**（`@deepseek-ai/dsh-client-ui-settings-plugin-inventory` 的 `src/client/index.ts`）—— `const t = ctx.locale.bind(NS)`，`slots.register({ …, label: () => t('tab'), locale: NS, … })`，字典 `ctx.effect(() => ctx.locale.register(NS, { zh, en }), …)`。本仓 `settings.plugins.tab` 席位的 `label: () => t('tabLabel')` + `locale: CARD_NS` 即照此。

### sessions / modelDirectories：推理级别记忆

- **`ctx.sessions` 契约**（`@deepseek-ai/dsh-api-session-controller` 的 `src/client/contract/sessions.ts` 的 `ISessions`）：`list: ObservableSnapshot<SessionListState>`、`retainInfo(id): ObservableSnapshot<SessionRetainInfo>`、`scope(id: AgentContext | undefined)`、**`binding(id): SessionBinding | undefined` —— 未知/未保留会话返回 undefined，不抛错**；`SessionRetainInfo{ referenceCount; retainedBy }`、`SessionListState{ ids; byId; phase; projectionsBySession }`（实现见同包 `src/client/sessions/service.ts`）、`SessionBinding{ sessionId; session; eventSource; ctx }`。实现要点：`list: SnapshotStore<SessionListState>`、`retainInfo` 缓存 observer（subscribe 只增删 listener）、`binding` 在 service 里。
- **投影**（同包的 `src/client/contract/session.ts`）：`ProjectionsFace{ faceOf(key: string): ObservableSnapshot<unknown> }`；实现 `src/client/sessions/projection-store.ts` **face 身份稳定、永不为 undefined face**，另有 `get(key)` 与 `seqOf(key)`。投影定义在同包的 `src/model-selection-projection.ts`：`key: 'modelSelection'`、schema 为 provider / model / reasoningEffort、**wire 视图 `next = state.pending ?? state.lastUsed`**、安装函数 `installModelSelectionProjection(ctx)`；字段定义在同包的 `src/types.ts`：`ModelSelection{ provider; model; reasoningEffort? }`、`ModelSelectionProjectionState{ lastUsed; pending }`、`ModelSelectionProjection{ lastUsed; next }`。
- **`ctx.modelDirectories`**：`@deepseek-ai/dsh-client-ui-model-selection` 的 `src/client/service.ts` 里 `class ModelDirectoryResolver extends Service`，`static inject = ['sessions','remote','remote.session']`、`super(ctx,'modelDirectories')`；`directoryFor(sessionId): ModelDirectory` **对未知 sessionId 显式抛错**（同文件的 `resolved no scope` / `resolved no binding` 两处），随会话作用域惰性创建并在 `actx.effect` 卸载时 dispose。
- **`ModelDirectory`**：`@deepseek-ai/dsh-client-ui-model-selection` 的 `src/client/directory.ts`：`readonly store: SnapshotStore<ModelDirectoryState>`、`ModelDirectoryState{ current; retainedEffort?; routable; groups: readonly ModelProviderGroup[]; failures; status; pending; error }`、`load()`、`async select(selection): Promise<RemoteResult<void>>`（**失败写 `store.status='error'` 并返回原始失败，不抛**）、`assertAvailable` 抛 `model selection is unavailable for addressed subagent sessions`。
- **`ModelProviderGroup`**（`@deepseek-ai/dsh-api-session-controller` 的 `src/types.ts`）：`{ id; name; models: readonly ModelCatalogModel[] }`；`ModelCatalogModel{ id; name; description?; reasoning? }`；`ModelReasoning{ efforts; defaultEffort? }`；`ModelReasoningEffort{ id; name; description? }`。
- **`ObservableSnapshot` 不推首值**（`@deepseek-ai/dsh-client-store` 的 `src/contract.ts`：`{ getSnapshot(): T; subscribe(fn): () => void }`）：实现 `src/index.ts` 的 `createSnapshotStore` 直接包装 zustand vanilla `api.subscribe`，**没有 `fireImmediately`**（默认 `flush:'sync'`，另有 `rafBatch`）。`ctx.locale.subscribe`（`@deepseek-ai/dsh-client-locale` 的 `src/client/index.ts`）与 `sessions.retainInfo.subscribe` 同语义 ⇒ 本仓订阅后必须手动补跑一次。

### 模块装载：`window.__ModuleLoader__` 与 `dsh.client.inject`

- **契约**（`@deepseek-ai/dsh-client-modules` 的 `src/index.ts`）：`ClientModuleLoaderTarget{ mode: 'queue'|'live'; pendingQueue; load(registration): void; create(options): ClientModuleSystem }`；`ClientModuleCreateOptions{ boot; staticModules; loadBundle? }`。
- **`load` 的参数**（同包 `src/client/manifest.ts`）：`ClientBundleRegistration{ id: string /* 插件 id（包名），注册键，须与执行的图行一致 */; chunk?: string /* 包内 chunk 文件名，入口 client.js 时省略 */; factory: (require: ClientBundleRequire) => Record<string, unknown> }`；`ClientBundleRequire` = 同步解析模块表依赖 + `async()` 加载包内动态 chunk。**factory 形参就是 `require`。**
- **产物形态由宿主构建注入**（`@deepseek-ai/dsh-client-web` 的 `tsdown.client.ts`）：banner `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, ${chunk.isEntry ? '' : \`chunk: ${JSON.stringify(chunk.fileName)}, \`}factory: (require) => {`、intro `var module = { exports: {} }; var exports = module.exports;`、footer `return module.exports; } });` ⇒ **本仓 `tsdown.config.ts` 的 banner/intro/footer 就是逐字复刻这三行**。
- **宿主读取的 exports 形状**（`@deepseek-ai/dsh-client-modules` 的 `src/client/system.ts`）：`import(specifier)` 返回 `materialize(id).exports` ⇒ 走 loader 的 `Entry` 路径（`@deepseek-ai/cordis-plugin-loader` 的 `src/config/entry.ts` 里 `unwrapExports` 后 `registry.plugin`）。`unwrapExports`（loader 的 `src/index.ts`）= `exports.default ?? exports`，`__esModule` 再解一层 ⇒ **default export 会丢掉 inject**（宿主自己的 postmortem `0001-acp-default-export-drops-inject.md` 有案）。
- **客户端半导出必须是具名导出**：`{ name?, inject?, Config?, apply }`，`apply` 必需（`@deepseek-ai/cordis` 的 `src/registry.ts` 无 apply 抛 `invalid plugin, expect function or object with an "apply" method, received …`），`name` 落到 `runtime.name`、`inject` 交给 `Inject.resolve(plugin.inject)`、`Config` 同名传递。**`name` 不强制等于包名**（只影响显示名）——本仓仍主动对齐，是显示一致的自律。
- **重复加载 / 缺失登记会抛**（`@deepseek-ai/dsh-client-modules` 的 `src/client/system.ts`）：重复注册抛 `client-modules: duplicate factory registration for "${registrationName}" (bundle executed twice without invalidate?)`；另有 `loaded without registering "${id}" via __ModuleLoader__.load`、加载失败、以及 `arriveGraphRow` 的到达顺序遍历（先 `row.external` 再 `row.inject`，成环抛 `module arrival cycle …`）。
- **`dsh.client.inject` 的权威语义**（`@deepseek-ai/dsh-package-manifest` 的 `src/types.ts` 的字段注释逐字）：`platform`「Client platform identifier; the Web consumer selects `web`」、`inject`「**Informational package-name dependencies, not Cordis service injection.**」、`immediately`「Boot phase-one registration barrier; absent means the shared application batch」、`external`「Exact module-table requests beyond the implicit client baseline」。另见 `@deepseek-ai/dsh-client-modules` 的 `src/client/manifest.ts`。
- ⇒ **它不是 cordis 服务名、也不是激活顺序决定者**（宿主 `@deepseek-ai/dsh-client-web` 仓的 `AGENTS.md`：激活顺序只由 fiber 等服务决定）。本仓 `package.json` 的 `dsh.client.inject` 列槽位所有者包（ui-renderer / ui-settings-plugins / ui-settings-models / ui-plugin-manager）是为**保证这些包先物化**，服务名只写在 `src/client/index.tsx` 的 `export const inject`。

## 宿主类型导入清单

`@deepseek-ai/*` 一律 type-only 导入 devDep 面，构建期擦除、不落运行期依赖；升宿主时 typecheck 即暴露不兼容。表中「合并」= `import type {} from '...'`（只为 `declare module` 扩充 `Context` 之类的服务面，零运行期依赖）。

| 宿主模块 | 导入符号 | 形式 | 使用处 |
| --- | --- | --- | --- |
| `@deepseek-ai/cordis` | `Context` / `Context as ClientContext` | type-only | Node 半各模块；`src/client/index.tsx` |
| `@deepseek-ai/schemastery` | 默认导出 `z` | **值导入** | `src/index.ts`（`Config`）、`src/migrate.ts` |
| `@deepseek-ai/dsh-settings` | `SettingsPathOp` | type-only | `src/fix.ts` `src/migrate.ts` `src/reset.ts` `src/restore.ts` `src/prune.ts` `src/client/scope.ts` |
| `@deepseek-ai/dsh-util-values` | `deepEqualJson` | **值导入** | `src/fix.ts` `src/migrate.ts` `src/compat.ts` `src/restore.ts` |
| `@deepseek-ai/dsh-llm` | `LlmRuntime`、`ReasoningEffortId` | type-only | `src/probe-engine.ts`；`src/rpc.ts` 另有一处 `import type {} from '@deepseek-ai/dsh-llm'`（`ctx.llm` 服务面合并） |
| `@deepseek-ai/dsh-llm/types` | `LlmFailure` | type-only | `src/probe-engine.ts`（**只在 `/types` 子路径**，包根未再导出） |
| `@deepseek-ai/dsh-client-connection` | `ConnectionRpcResult`、`HostConnectionService` | type-only | `src/rpc.ts`、`src/rpc-route.ts` |
| `@deepseek-ai/dsh-host-webserver` | `WebServer` | type-only | `src/rpc.ts` |
| `node:http` | `IncomingMessage`、`ServerResponse` | type-only | `src/rpc-route.ts` |
| `@deepseek-ai/dsh-client-ui-primitives` | `import * as primitives`、`TerminalBlockLabels` | **值导入** + type-only | `src/client/card.tsx`（唯一运行期宿主 UI 依赖） |
| `@deepseek-ai/dsh-client-ui-settings/client` | `ConfigForm`、`ConfigFormSnapshot` | type-only | `src/client/index.tsx`、`src/client/scope.ts` |
| `@deepseek-ai/dsh-client-connection/client` | `ClientConnectionRpc` | type-only | `src/client/index.tsx` |
| `@deepseek-ai/dsh-client-connection` | `ConnectionRpcResult` | type-only | `src/client/card.tsx` |
| `@deepseek-ai/dsh-client-ui-slots` | `TranslateNS` + 合并（`LocaleNamespaceMap` 纳入 `CARD_NS`） | type-only | `src/client/card.tsx`、`src/client/locales.ts` |
| `@deepseek-ai/dsh-api-session-controller/client` | 合并（`ctx.sessions`） | 合并 | `src/client/index.tsx` |
| `@deepseek-ai/dsh-api-session-controller/types` | `ModelSelection`、`ModelSelectionProjection`、`ModelProviderGroup` | type-only | `src/client/index.tsx`、`src/client/effort.ts` |
| `@deepseek-ai/dsh-client-ui-model-selection/client` | `ModelDirectory` | type-only | `src/client/index.tsx` |
| `@deepseek-ai/dsh-session/types` | `SessionId` | type-only | `src/client/index.tsx` |
| `@deepseek-ai/dsh-client-ui-renderer/client` | 合并（`ctx.slots`） | 合并 | `src/client/index.tsx` |
| `@deepseek-ai/dsh-client-locale/client` | 合并（`ctx.locale`） | 合并 | `src/client/index.tsx` |
| `@deepseek-ai/dsh-client-ui-settings-models/client` | 合并（slot key `settings.models.footer`） | 合并 | `src/client/index.tsx` |
| `@deepseek-ai/dsh-client-ui-plugin-manager/client` | 合并（slot key `plugins.bundle.config` / `plugins.row.config`） | 合并 | `src/client/index.tsx` |

- **浏览器半的运行期宿主依赖只有 `react`、`react/jsx-runtime` 与 `@deepseek-ai/dsh-client-ui-primitives`**：其余全是 type-only 或合并导入，擦除后不留痕。`ui-primitives` 属平台模块（宿主冻结模块表提供），故卡片用的是**宿主运行期对象**而非打包副本——这是有意选择（符号漂移由 typecheck 在构建期拦下），风险是宿主改名后运行期拿到 `undefined`，React #130 打空该 slot 条目；缓释手段是 devDep 类型面 + 升宿主时复核全部宿主值导入的符号面。
- **`ctx.llm` 只做 type-only 引用**：凭据只在宿主凭据缝内可读，验证请求必须经宿主 `LlmRuntime.stream` 发出，故 `dependencies` 不长新条目；档位 id 用 `as ReasoningEffortId` 断言而不引运行期构造器。
- **浏览器侧 `connection` 的 rpc 面需经 `unknown` 桥接**：宿主 `connection` 服务的声明合并只有服务端面 `HostConnectionHandle`，client 面（`ClientConnectionRpc`）不合并进 `Context`，故取用写作 `(ctx.get('connection') as unknown as { rpc: ClientConnectionRpc }).rpc`。

## 依赖宿主字面量的键与码

改这些字面量必须确认宿主侧同名同值；它们散落在常量与内联处，AGENTS.md 只点名了 `PLUGIN_NS` 一处。

- **settings 命名空间**：`PLUGIN_NS = 'tikaflow-model-fix'`（= `cordis.patch.yml` 的 `id`，浏览器半 `configForms.get(ns)` 与 Node 半写回 NS 同一字面量）、`API_NS = 'llm-pi-ai'`（宿主自带段，本插件只读 user 层并在同段写 `providers.<id>.models` 与路由 `compat`）。
- **RPC channel 与流路由**：`channel = '/tikaflow-model-fix'`、`VERIFY_STREAM_ROUTE = '/api/tikaflow-model-fix/verify'`、`PROBE_STREAM_ROUTE = '/api/tikaflow-model-fix/probe'`（两条都是 `connection.fetch` 的 exact 路由，须落在 `/api` 之下）、`VERIFY_STREAM_URL` / `PROBE_STREAM_URL = 对应 ROUTE.slice(1)`（浏览器 `fetch` 用文档相对路径）。两条流共用 `src/rpc.ts` 的 `progressStreamFetch`（同形状，只差执行器与措辞）；探测那条入口先查事件流守卫（它一轮之内要写两次配置），已开即回 409 + 中文文案。
- **RPC endpoint 名**：`forceUpdate` / `resetModels` / `restoreModels` / `pruneEfforts`；结果信封 `{ ok: true, value: { changed } }` 或 `{ ok: true, value: { pruned } }`。
- **本插件错误码**（`ConnectionRpcResult` 的 `error.code`）：`model-fix/write-in-progress`、`model-fix/force-update-failed`、`model-fix/reset-models-failed`、`model-fix/restore-models-failed`、`model-fix/prune-efforts-invalid`、`model-fix/prune-efforts-failed`、`model-fix/unknown-endpoint`。
- **宿主错误码**：settings 冲突 `SETTINGS_CONFLICT`；信封层 `gateway/bad-request`；宿主自复刻的非法 rpcId 哨兵 `invalid-request`（`INVALID_RPC_ID`，非宿主常量）。
- **slot 席位名**：`settings.models.footer`、`plugins.bundle.config`、`plugins.row.config`、`settings.plugins.tab`（四个 key 靠上述两个「合并」导入才拿到类型；`plugins.row.config` 的 `key` 拼接规则为 `${包名}#${patch 条目 id}`）。
- **locale 命名空间**：`CARD_NS = 'settings.modelFix'`，注册 slot 时以 `locale: CARD_NS` 声明换取类型化 `t`。
- **LLM 失败码**（按 `failure.code` 判，全程不看 `status`、不比对文案）：`UNSUPPORTED_REASONING_EFFORT`、`QUOTA`、`ACCOUNT_QUOTA`、`INVALID_CREDENTIAL`、`MISSING_CREDENTIAL`、`TRANSPORT`、`STREAM_CLOSED`、`RATE_LIMIT`、`TIMEOUT`、`INVALID_REQUEST`。
- **构建期注入标识**：`__PLUGIN_VERSION__`（`tsdown.config.ts` 的 define 内联 `package.json` version，`card.tsx` 声明为 `string`）。
- **逐字复制的宿主正则**：`EXCLUDE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/`（宿主 models 页的提供方 id 校验）、`ENDPOINT_SEGMENT = /^[A-Za-z0-9_$.-]+$/`（宿主 RPC 路径段校验）。宿主改这两处正则时本仓须同步。

## 装载与 HMR 契约

- `package.json` 的 `dsh.client.inject` 按宿主权威注释是「**Informational package-name dependencies, not Cordis service injection**」（`@deepseek-ai/dsh-package-manifest` 的 `src/types.ts`）：它只决定模块工厂的**到达顺序**（`@deepseek-ai/dsh-client-modules` 的 `src/client/system.ts` 的 `arriveGraphRow`，先 `row.external` 再 `row.inject`，成环抛 `module arrival cycle`），**不决定 cordis 激活顺序**（激活顺序只由 fiber 等服务决定）。本仓填的是槽位所有者包（ui-renderer / ui-settings-plugins / ui-settings-models / ui-plugin-manager）以保证它们先物化；**cordis 服务名只写在 `src/client/index.tsx` 的 `export const inject = ['slots','locale','connection']`**。
- client 模块须 `export const name`（宿主**不强制**等于包名，只影响显示名）与 `export const apply`，并复刻 `window.__ModuleLoader__.load` 闭包工厂契约（`tsdown.config.ts` 的 `outputOptions` banner/intro/footer 三段，逐字取自宿主 `@deepseek-ai/dsh-client-web` 的 `tsdown.client.ts`）。**禁用 default export**——宿主 `unwrapExports` 走 `exports.default ?? exports`，default 会吃掉 `inject`/`Config`。声明 `dsh.client` 后缺 `lib/client.js` 会让宿主激活期聚合抛错，故 **build 必须先于安装**。
- Node 半 `export const inject = ['settings','connection','llm']`；`configForms` 只作子 fiber 标记（**不进父级 inject**），共享编排体一律走父 ctx。
- **宿主 `ObservableSnapshot.subscribe` 一律不推首值**（`@deepseek-ai/dsh-client-store` 的 `src/index.ts` 的 `createSnapshotStore` 无 `fireImmediately`；`ctx.locale`、`sessions.retainInfo` 同语义）⇒ 本仓所有订阅都要手动补跑一次。
- **`Config` 是实时引用**：`apply(ctx, config)` 第二参是冻结的 `Volatile<T>`，读值必须每次 `config.get()`，禁止缓存解引用结果（详见「cordis：config 的实时引用」）。
- 浏览器半样式经模块级幂等 `<style>` 注入并带 `data-plugin` 标记供宿主 HMR 认领；`ctx.locale.register` 重复注册会抛错，disposer 必须经 `ctx.effect` 挂。
- 卡片样式与文案的宿主同款来源写在 `docs/decisions.md` 与 `AGENTS.md`「UI 无痕融合纪律」，本文不重复。

## 已知漂移与观察项

- **查阅到的宿主源码可能比本仓 devDep 新**（本仓 devDep/engines 为 `0.1.7-rc.2`）：本文引用的宿主签名以本仓 devDep 声明为准，翻阅时看到的更新版差异记在此处，不顺手改代码。
- **settings 路径 op 的数组下标中间段**：较新版本的 `applyPathOp`（`@deepseek-ai/dsh-settings` 的 `src/index.ts`）**已支持**数组下标中间段（`/^(0|[1-9][0-9]*)$/` 校验，越界抛 `Config array index "${head}" is out of range`），与本仓 `AGENTS.md` / `decisions.md` 记录的「不支持数组下标中间段」相反。本仓写法（按 provider 整段 `set` 覆盖 `models`）在两种语义下都成立，属安全子集，**不需要改代码**；但升宿主到 `0.2.x` 后若要改用下标写法，须先在本仓 devDep 版本上实测。
- **`unset` 不折叠空父对象**：本仓 devDep 与较新版本一致（只 `Reflect.deleteProperty(result, head)`）。若宿主将来改为折叠，本仓「删空壳必须整段 unset」的写法仍然安全（整段 unset 不依赖折叠）。
- **平台模块表已扩**：`tsdown.config.ts` 的 `PLATFORM_MODULES` 副本比宿主 `@deepseek-ai/dsh-client-web` 的 `src/platform.ts` 少一项 `'@deepseek-ai/dsh-client-ui-dockkit'`（宿主另有 `PRELOADED_CLIENT_EXTERNALS = []`）。当前无碍（外置项越多宿主提供越多，本仓不引 dockkit 即可），但**宿主若反过来把本仓在用的模块移出表**，该模块就会被打进浏览器包而运行期拿不到宿主实例。升宿主时逐位比对。
- **`connection` 不注入 `webServer`**：较新版本确认 `inject = ['credentials']`，webServer 是 apply 内二次注入（`@deepseek-ai/dsh-client-connection` 的 `src/index.ts`），与本仓「必须自己 inject 两个服务」的写法一致。
- **宿主 settings 无客户端包、无命名空间登记/ready 事件**：全仓检索确认（`@deepseek-ai/dsh-settings` 的 `package.json` 只有 `.` / `./types` / `./src/*` / `.package.json` 导出，`ConfigForms` 也没有 `whileServed` 之外的等待原语），本仓 `src/migrate.ts` 的有界轮询等待不可省。
- **`settings.models.footer` 的 SlotMap 定义在 `@deepseek-ai/dsh-client-ui-settings-models` 而非 `@deepseek-ai/dsh-client-ui-settings`**（前者 `src/client/slot-contract.ts`）——搜 slot 定义时别只搜 ui-settings。
- **`ConfigForm` 写入的「被拒 vs 传输失败」是两件事**：`set` / `unset` / `mutate` 被拒或跳过返回 `false`，传输失败 reject（`@deepseek-ai/dsh-client-ui-settings` 的 `src/client/config-form-types.ts` 的 JSDoc）；且非 loopback 连接整体是 `memory` 模式、所有写入返回 `false`（同包 `src/client/index.ts`）。本仓卡片只读返回值、不区分来源，故升级后若宿主改为对传输失败也返回 false，用户只会看到「未生效」而无错误文案。

## 升级宿主时的检查清单

- 逐位比对 `PLATFORM_MODULES` 与宿主 `@deepseek-ai/dsh-client-web` 的 `src/platform.ts`。
- 对本文每个宿主类型导入跑 typecheck（type-only 面断裂会直接报错；值导入的符号漂移 typecheck 抓不到，须人工比对 `@deepseek-ai/dsh-client-ui-primitives` 的全部用到的符号）。
- 逐条复核「宿主服务与运行时面」小节里的签名与行为假设，尤其是 settings 写入语义（纯对象根 / unset 不折叠 / 仅 volatile 可写）、命名空间登记时序（晚于 `apply`、无 ready）、连接断开语义（`request.signal` abort、fetch disposer 异步）。
- 复核 `SETTINGS_CONFLICT` 与 LLM 失败码字面量是否仍是宿主的归一化取值（尤其 `@deepseek-ai/dsh-llm-pi-ai` 的 `src/stream.ts` 里 `classifyPiAiError` 文案正则是否改了——它决定 `TRANSPORT` / `STREAM_CLOSED` 的归一化来源）。
- 复核四个 slot key、`rowConfigKey` 拼接、`SlotLabel` thunk 与 `PropsLocale`（`t` 只在声明 `locale:` 时上 props）。
- 复核 `ctx.sessions.binding()` / `ctx.modelDirectories.directoryFor()` 的失败契约（一个返回 `undefined`、一个抛错），二者互换会让记忆链路的 try/catch 失准。
- 复核 `Config` 仍是 volatile 实时引用（`Volatile<T>` + `loader/volatile-update`），以及 `z.any()` 与 `z.object` 在 schemastery 与 settings `projectForm` 两层的投影差异。