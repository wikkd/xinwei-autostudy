# 答案本 + 全库扫描（v3.12.0 移除存档）

2026-10-10 v3.12.0 移除「本地答案本 + 全库扫描/复盘采集」子系统，答题完全交给 AI（agent）现场作答。`harvest.js` 原样保存在本目录。

## 为什么移除

用户拍板「做题就只交给 agent」——每道题都由 LLM 现场作答，不再使用任何答案缓存与回放。全库扫描/复盘采集的唯一用途是把平台标准答案采进答案本供回放；答案本删除后它们失去消费者，故一并移除。

**代价（知情取舍）**：重做同一份试卷会对每道题重新调用 AI（重复花费 Token）；此前全库扫描采集的平台标准答案（700+ 题）不再作为答题主来源。

## 移除清单

| 部分 | 位置 |
|---|---|
| `harvest.js` 全库扫描状态机（API 直拉 + DOM 走查 + 复盘采集） | 本目录（原样保留） |
| 答案本三件套 `bankGet/bankFlush/bankSet` + 防抖落盘 | qa.js（删除） |
| `scanAI` 缓存命中直填路径 | qa.js（删除，直连 callAI） |
| `SK.bank` / `SK.harvestState` / `CFG.BANK_MAX` | config.js（删除） |
| 面板「📡 全库扫描」区块 + harvestTimer | ui.js（删除） |
| bootstrap 的 `maybeHarvestReview/harvestResume/bankFlush(pagehide)` | bootstrap.js（删除） |

注意：`questionHash`/`lastQuestionHash`/`_failHash` 等 **保留**——它们是 scan 循环防重复作答的安全机制，与答案本无关。`imgSkipped`（图片题跳过记录）同样保留。

## 如果将来要恢复

1. `harvest.js` 放回 `src/`，`build.js` BODY_ORDER 在 qa.js 之后加回（它用 Object.assign 扩展 XIA_AI）；
2. 恢复 qa.js 的 bank 三件套与 scanAI 缓存路径——对照本目录 harvest.js 内的调用与 git 历史（v3.11.0 之前的 qa.js）；
3. 共享题库（GitHub 端）恢复指南见 `legacy/tiku-removed-v3.11/README.md`。
