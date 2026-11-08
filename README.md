# context-LLM

一个不依赖第三方库的 Go 长上下文测试工具，用于评估 OpenAI 兼容接口。

## 使用

首次运行时如果找不到 `config.txt`，程序会在**可执行文件所在目录**自动生成默认配置并退出；编辑后再次运行即可。默认值为 OpenAI 的 `https://api.openai.com/v1`、`GPT6.1-Astra` 与占位密钥 `sk-123456789`。

只编辑 [config.txt](/Users/reca/Desktop/CODE/context-LLM/config.txt) 中的：

```ini
base_url = 你的接口地址
model = 你的模型 ID
api_key = 你的 API 密钥
```

然后运行：

```sh
cd /Users/reca/Desktop/CODE/context-LLM
./dist/context_llm_macos_x86_64
```

也可编译成独立程序：

```sh
go build -o dist/context_llm_macos_x86_64 .
./dist/context_llm_macos_x86_64
```

配置检查但不发请求：

```sh
./dist/context_llm_macos_x86_64 --dry-run
```

## 自动流程

1. 逐档生成随机长材料与 13 道可自动评分的问题。
2. 对 OpenAI 兼容的 `chat/completions` 或 `responses` 接口提交整份材料。
3. 根据响应中的 `prompt_tokens` 计算建议的 `chars_per_token`，并可用于本轮后续档位。
4. `anchor_count` 可设置总测试识别锚点／题目数，默认 13，最大 50；其中 3 题用于规则推理与拒答，其余为分散检索锚点。**模型性能较弱时，提高锚点数可能导致漏答、JSON 格式异常或评分失败。**
5. `evidence_tolerance` 默认是 `0`，即所有答案与证据都必须正确。它只在**所有答案正确**时生效；设为 `1` 或 `2` 时，允许对应数量的题目证据不完整或错误，以兼容较弱模型。证据宽容度超过 `2` 会显著降低验证可信度，不建议使用。
6. 如果出现 `context_too_large`，回退一档并用新的题目复测确认。
7. 写入结果报告后，自动删除本轮材料、答案和原始响应；仅保留轻量的报告与不含密钥的配置快照。

每个配置项都有中文行内注释，程序会自动忽略这些注释。`config.txt` 和 `runs/` 已在 `.gitignore` 中，避免提交密钥和运行文件。开发时若要从源码运行，可显式指定配置位置：`go run . --config ./config.txt`。
