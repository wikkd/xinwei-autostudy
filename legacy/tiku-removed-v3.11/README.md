# 共享题库功能（v3.11.0 移除存档）

2026-10-10 v3.11.0 移除共享题库（GitHub 众包题库：查询 + 上传）功能，原始实现完整保存在本目录。

## 为什么移除

实际使用中上传链路从未走通，事后复盘有三个结构性原因（而非单一代码 bug）：

1. **自动合并机器人从未上线**：`.github/workflows/tiku-auto-merge.yml` 当时始终未 commit 到仓库主分支——即使 PR 成功创建，上游也没有任何工作流去校验合并，PR 会永远挂着。
2. **OAuth 应用注册状态无证可查**：设备流依赖 OAuth App「xinwei-autostudy-tiku」（client_id `Ov23liK0u7PqAZLbGxVW`）。v3.8.0 开发时记录为「client_id 待注册」，之后代码里出现了 ID，但从未验证过该应用在 GitHub 侧真实存在——若未注册，设备流第一步就会失败。
3. **共享题库空转**：没有第二位贡献者时，共享题库只是「本地答案本的慢速副本」，查询端永远查不到东西。

另：`tiku/` 数据目录中曾混入一条校验器测试指纹（`abcdef0123456789`），删除功能后此问题一并消失。

## 文件清单

| 文件 | 说明 |
|---|---|
| `tiku.js` | 原样保留（v3.10.2 版，含指纹双端统一的最终形态），从 src/ 移出 |
| `test-tiku-upload.js` | 26 项回归测试（桩掉 GitHub API 的全链路模拟），可独立运行 |
| `tiku-validate.js` | 仓库侧 PR 校验器（配合 tiku-auto-merge 工作流） |

## 如果将来要恢复

1. 把 `tiku.js` 放回 `src/`，在 `build.js` 的 `BODY_ORDER` 的 `tiku.js` 原位置（sites 之后、qa 之前）加回；
2. 恢复 `qa.js`/`harvest.js`/`sites.js`/`ui.js`/`config.js`/`meta.js` 中的调用点——git 历史上 v3.10.2 提交（若有）或本目录代码对照；
3. **必须先做**：注册 OAuth App 并验证 client_id 可用（`POST https://github.com/login/device/code`）；
4. **必须先做**：将 tiku-auto-merge 工作流 commit 到主分支并确认 Actions 已启用；
5. 恢复 `tests/test-tiku-upload.js` 与 `tiku/` 数据目录（manifest + 空分片）。
