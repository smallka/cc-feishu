# T0006 - Prune Legacy Docs

Started: 2026-05-11
Archived: 2026-05-11
Status: validated

## Scope

用户要求整理 agent 框架以外的旧文档，并确认：

- TODO 文档不需要保留。
- `docs/plans/` 可以删除。
- 根 README 只保留最小给人看的部分。
- 删除 `CLAUDE.md` 和 `tests/README.md`。
- 其他旧文档按前序盘点建议清理。

本任务保留 agent harness 边界：`AGENTS.md`、`docs/PROGRESS.md`、`docs/DECISIONS.md` 和 `docs/task-archive/` 继续作为当前事实、进度、决策和证据入口。

## Changes

- 删除根目录 `TODO.md`、`docs/TODO.md`、`CLAUDE.md`、`tests/README.md`。
- 删除 `docs/plans/` 和 `docs/superpowers/` 下的历史计划、规范和执行提示。
- 删除早期方案与过期历史入口：`docs/init_plan.md`、`docs/WEBSOCKET_PROTOCOL_REVERSED.md`、`docs/PYTHON_SDK_ANALYSIS.md`。
- 收敛 `README.md`，只保留快速开始、PM2 运行、主要目录和文档入口。
- 收敛 `docs/README.md`，只列当前维护文档和 agent 框架入口。
- 从 `AGENTS.md` 文档地图移除已删除的 `docs/TODO.md`。
- 在 `docs/DECISIONS.md` 记录旧文档删除决策，并标记“不迁移既有历史计划文档”已被取代。
- 更新 `docs/PROGRESS.md` 当前任务状态和下一任务。

## Validation

- `npm run build`

Result: passed，仓库根目录执行 `tsc` 成功。

Additional check:

- 严格 UTF-8 读取当前所有 Markdown 文件，未发现非 UTF-8 文档。
- 扫描已删除文档名的剩余引用；剩余命中仅在历史任务归档或已标记 superseded 的历史决策中，作为历史证据保留。

## Evidence

- 当前保留的 Markdown 入口包括 `README.md`、`INSTALL.md`、`AGENTS.md`、`docs/README.md`、`docs/PROGRESS.md`、`docs/DECISIONS.md`、`docs/PROTOCOL_SPEC.md`、`docs/STDIO_QUICKSTART.md`、`docs/PYTHON_TYPESCRIPT_RUNTIME_BOUNDARY_NOTES.md`、`docs/pm2-win11-pidusage-fix.md` 和 `docs/task-archive/`。
- 删除后的历史计划和旧说明不再出现在当前文档入口。

## Risks

- 用户明确要求删除 TODO 文档，因此旧 TODO 中未完成条目没有迁移；后续任务应由用户指定或从代码现状重新盘点。
- 旧历史计划和 Python SDK 分析已删除；若未来需要追溯细节，只能依赖 git 历史或任务归档中的摘要。

## Related Files

- `AGENTS.md`
- `README.md`
- `docs/README.md`
- `docs/DECISIONS.md`
- `docs/PROGRESS.md`
- deleted legacy docs listed in Changes
