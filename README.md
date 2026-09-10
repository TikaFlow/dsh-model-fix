# dsh-model-fix

[DSH](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek Harness）插件：为非官方（自定义）提供方的模型自动填充推理级别（`reasoningEfforts`）、最大上下文（`contextWindow`）、输出上限（`maxTokens`）与图片模态（`input`），数据来自 [models.dev](https://models.dev)。

> 本插件已被 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录，同时可在 [dsh-market](https://github.com/dsh-market/dsh-market) 中搜索、安装。

配置界面截图：

![浅色主题设置卡片](screenshot/light.png)
![深色主题设置卡片](screenshot/dark.png)

## 功能

- 自动填充：模型缺失 `reasoningEfforts` / `contextWindow` / `maxTokens` / `input` 时按 models.dev 数据补全；已有配置不受影响
- 兼容性（默认开）：为所有 `api: openai-completions` 的提供方路由写入 `compat.supportsDeveloperRole: false`（不使用 `developer` 角色）；关闭该开关则移除此字段
- 排除提供方：列出的提供方本插件完全不动（填充、更新、兼容性写入、强制更新都跳过），等效于对它关闭插件
- 可视化设置：Web 设置 →「模型」→ 页面底部，或 Web 设置 →「插件」→「插件配置」列表中的「模型参数填充」卡片（同一张卡、两处入口）；改动后点「保存」写入，「强制更新」按 models.dev 当前值立即覆盖一遍
- 开箱即用：启动即以内置缓存填充（离线可用），数据随后自动保持最新

## 安装

-  通过插件市场安装（推荐）

> 使用 `dsh-market` 插件市场安装时无需重启 DSH 即生效。

-  通过命令行安装

```bash
dsh plugin --profile web add github:TikaFlow/dsh-model-fix

# 重启 DSH 
dsh web
```

## 版本说明

由于 DSH 正在快速迭代，因此本插件所依赖的 DSH 宿主版本总是追随较新的版本（目前是 `0.1.2-rc.1`）。若插件功能异常，请检查 DSH 版本是否满足插件依赖版本。

## 使用说明

无需任何操作，进入 DSH 后插件即自动生效：支持推理级别的模型会自动填充推理级别，缺失上下文的模型会自动补全 `contextWindow` / `maxTokens`，数据源标明支持图片的模型会补全 `input: ["text", "image"]`。默认还会为所有 `api: openai-completions` 的提供方写入路由级 `compat.supportsDeveloperRole: false`。某个提供方不想被接管，就把它的 id 加进「排除提供方」（见下文）。

### 配置

**图形界面（推荐）**：Web 设置 →「模型」→ 页面底部，或 Web 设置 →「插件」→「插件配置」列表中的「模型参数填充」卡片，展开「自动填充」「允许更新」「兼容性」「排除提供方」任一配置组调整，点「保存」写入；改动未保存时卡片会显示「未保存」标记，直接关闭视为放弃。

**手动编辑**（等效方式）：Web 设置界面右上角「打开配置文件 / Open configuration file」直接编辑 `settings.yaml`：

```yaml
tikaflow-model-fix:
  version-4:
    autoFill:
      reasoning: true   # 填充缺失的推理级别档位；默认 true
      context: true     # 填充缺失的 contextWindow/maxTokens；默认 true
      image: true       # 填充缺失的 input 图片模态声明；默认 true
    allowUpdate:
      reasoning: false  # 同步已有模型的推理级别档位；默认 false
      context: false    # 同步已有模型的 contextWindow/maxTokens；默认 false
      image: false      # 同步已有模型的 input 图片模态声明；默认 false
    compat:
      disableDeveloper: true  # 写入 compat.supportsDeveloperRole: false；默认 true
    excludes: []        # 排除的提供方 id 列表；默认空
```

注意 `compat` 与其余开关不同：**开启即写入、关闭即移除**。关闭期间该字段由你自己管理。

### 排除提供方（`excludes`）

- 在卡片「排除提供方」里输入 id 并回车添加，点「保存」后生效；id 规则与宿主新建提供方一致：小写字母开头，之后可用小写字母、数字和短横线。
- **推荐顺序：先加排除、再新建提供方**——新建会立即触发一次填充，先加才来得及。也允许直接填入尚不存在的 id。
- 排除只对保存之后的行为生效：此前已填充的参数与已写入的 `compat` 字段不会自动撤销，需要的话请自行清理。
- 条目样式：绿点 + 绿色胶囊＝该提供方已存在、排除将会生效；灰色＝暂无同名提供方（不是写错，创建后即生效）。
- 列表按录入顺序保存；输入已存在的 id 会提示并不添加；每条右侧的删除按钮可移除。
- 想让某个已有提供方从此不再被接管，同样把它加进排除列表。
