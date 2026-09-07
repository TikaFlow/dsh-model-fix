# dsh-model-fix

[DSH](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek Harness）插件：为所有非官方（自定义）提供商的模型自动填充推理级别（`reasoningEfforts`）、最大上下文（`contextWindow`）、输出上限（`maxTokens`）与图片模态（`input`），数据来自 [models.dev](https://models.dev)。

> 本插件已被 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 收录，同时可在 [dsh-market](https://github.com/dsh-market/dsh-market) 中搜索、安装。

配置界面截图：

![浅色主题设置卡片](screenshot/light.png)
![深色主题设置卡片](screenshot/dark.png)

## 功能

- 进入插件时优先使用构建附带的 models.dev 缓存（解析为非空数组才算可用）立即填充，避免启动时等待网络
- 首轮填充完成后异步拉取最新数据：成功则更新缓存并再次填充；失败则重试
- 监听模型配置变化后自动重新填充
- 填充内容包括 `reasoningEfforts`、 `contextWindow` / `maxTokens`、`input`（图片/多模态）；已有配置不受影响
- 支持通过自有配置控制行为：`autoFill` 控制是否自动填充，`allowUpdate` 控制是否同步最新数据（可能覆盖手动修改的模型参数）
- 提供可视化设置界面：Web 设置 →「模型」选项卡底部内嵌可折叠的「模型参数填充」卡片，内含「自动填充」「允许更新」两个配置组瓦片（每组带整组总开关与推理级别 / 上下文与输出 / 图片输入三项子开关）；改动后卡片标出「未保存」，点「保存」写入；「强制更新」则按 models.dev 当前值立即覆盖一遍
- 配置存放在独立命名空间，插件升级时自动迁移旧配置，回退旧版本亦不受影响，全程无需手动处理

## 安装

> 设置界面的可视化卡片需要 DSH ≥ 0.1.2-alpha.2（alpha 通道：`npm i -g @deepseek-ai/dsh@alpha` 或按官方渠道升级）；更旧的 DSH 上插件自动填充功能一切正常，仅无设置卡片。

-  通过插件市场安装（推荐）

> 使用 `dsh-market` 插件市场安装时无需重启 DSH 即生效。

-  通过命令行安装

```bash
dsh plugin --profile web add github:TikaFlow/dsh-model-fix

# 重启 DSH 
dsh web
```

## 使用说明

无需任何操作，进入 DSH 后插件即自动生效：支持推理级别的模型将会自动填充推理级别，可在界面中选择；缺失上下文的模型将自动补全 `contextWindow` / `maxTokens`；数据源标明支持图片的模型将补全 `input: ["text", "image"]`（纯文本模型不声明，行为与未声明一致）。

### 配置

**图形界面（推荐）**：Web 设置 →「模型」→ 页面底部「模型参数填充」卡片，展开对应配置组调整开关，点击「保存」写入并自动重新填充模型参数；未保存直接关闭视为放弃（草稿只存在于页面内，卡片的「未保存」标记即提示还有未写入的改动）。

**手动编辑**（等效方式）：在 Web 设置界面右上角点击「打开配置文件 / Open configuration file」直接编辑 `settings.yaml`，找到以下内容修改：

```yaml
tikaflow-model-fix:
  version-2:
    autoFill:
      reasoning: true   # 填充缺失的推理级别档位；默认 true
      context: true     # 填充缺失的 contextWindow/maxTokens；默认 true
      image: true       # 填充缺失的 input 图片模态声明；默认 true
    allowUpdate:
      reasoning: false  # 不更新已有模型的推理级别档位；默认 false
      context: false    # 不更新已有模型的 contextWindow/maxTokens；默认 false
      image: false      # 不更新已有模型的 input 图片模态声明；默认 false
```
