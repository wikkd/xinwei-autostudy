# 芯位网课辅助 · Xinwei AutoStudy

基于大语言模型（LLM）的网课学习辅助**用户脚本**（UserScript），针对 `beeline-ai.com`（芯位）平台。
以 **MIT 协议**开源，源码与构建流程完全公开。

> ⚠️ 本脚本仅供**计算机自动化技术交流与学习**。请在遵守平台规则与当地法律的前提下使用；
> AI 不保证 100% 正确率，刷完课建议自行复习。使用风险请自行承担。

---

## 功能

- **自动刷课**：自动播放、防挂机检测规避（伪造可见/聚焦状态 + 合成随机交互）、章节完成判定与自动跳转。
- **AI 答题**：基于页面题目（Element UI `div.question` 单选/多选/主观题），调用你自填的 LLM 接口给出答案并自动回填。
- **检索增强（RAG）**：对事实/时事类题目，答题前先通过 DuckDuckGo（免密钥）或 Tavily（需 Key）检索资料，提升准确率。支持 `off / auto / always` 三档。
- **异常弹窗自愈**：平台弹出"学习状态异常，请刷新后继续学习"时，脚本自动刷新页面并续跑。
- **悬浮控制面板**：挂机开关、AI 配置（Key/Base/模型/检索）、单次答题、题目抓取测试、实时日志，支持拖动与最小化。

---

## 安装

1. 安装油猴类扩展：[Tampermonkey](https://www.tampermonkey.net/) 或 [ScriptCat](https://scriptcat.org/)。
2. 获取脚本：
   - 开发版：仓库 `dist/xinwei-autostudy.user.js`，直接拖入扩展安装；或
   - 自行构建（见下）。
3. 打开 `beeline-ai.com` 任意课程/作业页，左上角出现控制面板即生效。

---

## 构建（从源码）

源码按模块拆分在 `src/`，通过 `build.js` 拼接为单一用户脚本（共享同一 IIFE 作用域）。

```bash
node build.js          # 生成 dist/xinwei-autostudy.user.js
node build.js --watch  # 监听 src/ 变化自动重建（需手动刷新浏览器）
```

目录结构：

```
src/
  meta.js       用户脚本元数据头（==UserScript==）
  config.js     全局配置 CFG / 持久化键 / loadCfg
  utils.js      可见性判定、静音、防挂机、滚动、侧边栏穿透查找
  qa.js         AI 答题核心：抓取 / 检索 / 调用 LLM / 回填 / 扫描
  ui.js         控制面板 UI（CSS / DOM / 拖动 / 事件绑定）
  autoplay.js   自动刷课主循环与章节跳转
  popup.js      学习状态异常弹窗自动刷新
  bootstrap.js  入口：防重复注入、加载配置、挂载 UI、启动
build.js        拼接脚本
dist/           构建产物
legacy/         原始脚本与补丁（仅作参考，不再维护）
```

---

## 配置

在控制面板「AI 答题调试」页填写：

| 项 | 说明 | 默认 |
| --- | --- | --- |
| API Key | 你自己的大模型密钥（不上报） | 空 |
| API Base URL | 兼容 OpenAI `/v1/chat/completions` 的端点 | `https://api.deepseek.com` |
| 模型名称 | 如 `deepseek-chat` / `gpt-4o-mini` | `deepseek-chat` |
| 检索模式 | `off` / `auto` / `always` | `auto` |
| 检索源 | `duckduckgo`（免密钥）/ `tavily`（需 Key） | `duckduckgo` |
| Tavily Key | 仅 Tavily 模式需要 | 空 |

推荐白嫖：硅基流动 (SiliconFlow)、DeepSeek 官方等平台新用户通常赠送免费额度。

---

## 协议

[MIT](./LICENSE)。可自由使用、修改、分发，请保留版权声明与许可声明。

## 免责声明

脚本作者不对因使用本脚本产生的任何后果负责（包括但不限于账号风险、成绩变动等）。
如不同意，请立即卸载。
