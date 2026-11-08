# Context-LLM · Benchmark Viewer

在浏览器里打开一份 `checkpoint.json`，把 context-LLM 的长上下文测试结果读成一份可视化报告。
纯静态、离线、无第三方依赖：HTML + CSS + 原生 JS，双击 `index.html` 就能用。

Open a local `checkpoint.json` from
[context-LLM](https://github.com/RecaEENT/context-LLM) and read the run as a visual report.
Static, offline, dependency-free — just open `index.html`.

---

## 使用 / Usage

1. 双击 `index.html`（`file://` 直接可用，无需服务器）。
2. 点「选择文件」或把文件拖到页面上：
   - `checkpoint.json` — 必需，包含 `trials`；
   - `run_config.public.json` — 可选，补全服务商、题型、证据容差等配置；
   - `summary.json` — 也支持（trials 数组）。
3. 也可以「选择运行目录」，一次读入整个 `run_*` 文件夹。
4. 没有文件时点「没有文件？看示例」，会载入一份真实的 `run_20261108_161502` 结果。

数据只在浏览器内存里解析，未载入前页面不发起任何网络请求；载入后可一键清除本地缓存。

## 页面内容 / What it shows

- **运行头**：运行目录、服务商、模型、接口模式、题型、证据容差、题目数、数据来源与生成时间。
- **读数条**：通过率、试次、证据命中率、总 token、平均耗时、档位数。
- **建议**：下一次运行应使用的 `chars_per_token`（增强模式下取同档中位数）。
- **概览**：各档位通过率、每次试次 token 用量（输入/输出）、每次试次耗时。
- **运行状态**：checkpoint 的断点续跑信息（版本、阶段、二分区间、上限探测、配置指纹）与配置开关。
- **档位总览**：等价于 `RESULTS.md` 的 Tier summary（次数、通过、通过率、超限、失败、输入均值/中位数/范围/合计、输出均值/合计、总量均值、平均耗时）。
- **试次明细**：每次请求的实际用量与评分；展开一行查看分题型成绩与响应元数据（HTTP 状态、请求次数、CPT、校准目标、推理 token、种子、材料目录、响应文件）。
- **题型分析**：按题型的热力图（证据命中率 + 平均行），对应 `RESULTS.md` 的 Mode breakdown。
- **原始数据**：当前载入的 JSON，可复制或下载。

## 功能 / Features

| 功能 | 说明 |
| --- | --- |
| 中英切换 | 右上角「中文 / EN」，选择会记住；可用 `?lang=en` 直接指定。 |
| 移动端适配 | 1280 / 1024 / 768 / 390 宽度下重排；窄屏表格变为规格卡片，控件高度 ≥44px。 |
| 导出 | `导出 Markdown` 重新生成 `RESULTS.md`；`导出 CSV` 导出试次明细；`打印 / 存为 PDF` 会展开所有明细。 |
| 自动恢复 | 上次载入的数据存在 localStorage，刷新后仍在，可一键清除。 |
| 深链 | `?lang=zh`、`?expand=1`（展开全部试次）、`#demo`（载入示例）。 |
| 键盘 | 全部控件可 Tab；试次名称是按钮，回车/空格展开；`Esc` 关闭拖拽遮罩。 |
| 无网络 | 不引用外部字体、图片、CDN；图标全部为内联 SVG。 |

## 两点说明 / Notes

- **列对齐修正**：`RESULTS.md` 的 Tier summary 表头把「输入合计 / 输出均值」写反了位置（`internal/report/report.go` 里数值顺序与表头不一致）。本页面按正确含义排列：输入合计 → 输出均值 → 输出合计 → 总量均值，其余数值与 `RESULTS.md` 完全一致。
- **字体**：设计系统指定 Chivo / Chivo Mono。为保持「纯静态 + 离线」，页面不加载网络字体，`font-family` 里保留名字并回退到系统字体（中文回退到苹方/微软雅黑）。

## 文件 / Files

```text
render/
├── index.html         页面结构（外壳、空状态、报告容器）
└── assets/
    ├── site.css       设计系统：调色板、排版、表格、图表、响应式、打印
    ├── i18n.js        中英词典与格式化
    ├── report.js      数据层：解析、聚合、校准、Markdown / CSV 导出（可单独在 Node 里用）
    ├── charts.js      无依赖 SVG 图表
    ├── app.js         DOM 渲染与交互（拖拽、文件、缓存、导出）
    └── sample.js      内置示例数据（真实 run，无 API 密钥）
```

`report.js` 与 `charts.js` 同时支持 `window.*` 与 `module.exports`，可以直接在 Node 里复算统计结果。

## License

与主项目一致：[The Unlicense](https://github.com/RecaEENT/context-LLM/blob/main/LICENSE)。
