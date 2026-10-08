# 版本纪律：快照与冻结形态

`AGENTS.md` 硬约束「版本快照与冻结形态」一节的全文，仅供查阅，不复制正文回 `AGENTS.md`。

- 新增**顶层配置组**算形态变化，必须递增 `CONFIG_VERSION` 并加升级台阶；只往 `compat` 组内加键不算（新键须有 schema 默认，旧快照解析后即获得默认）。
- `src/types.ts` 的 `V3`–`V6` 与 `src/upgrade.ts` 的 `upgradeTo4`–`upgradeTo7` 是历史形态，**不随当前类型演进**（否则历史语义会被当前类型改写，破坏无损回退）。台阶按目标版本命名 `upgradeToN`：每级先 `fromVersion < N-1 ? upgradeToN-1(...) : 输入` 接力，再按 vN-1 冻结 schema 解析、补新增字段落默认，产物版本号写固定字面量；`upgradeConfig` 只调最新一级。台阶链与当前版本侧分居两个文件（`src/upgrade.ts` 只管「把某个旧版本升上来」，`src/migrate.ts` 只管当前版本与段内多版本共存），加台阶不许顺手改当前版本侧的默认值，反之亦然。
- 提升 `MIN_SUPPORTED_VERSION` 到 M 时，低于 M 的冻结类型与台阶一并移除（其输入下限已被守卫拒绝），输入下限恰为 M 的一级转为最低一级、自持全链唯一的 `fromVersion < MIN_SUPPORTED_VERSION` 守卫。