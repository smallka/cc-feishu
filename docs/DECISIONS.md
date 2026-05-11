# Decisions

本文件只记录会影响后续工作的长期决策。临时排查过程、一次性日志、完整验证输出、任务证据和会话交接不写入这里。

## Decision Log

### 2026-05-11 - 以 TypeScript 作为唯一长期实现

- Decision：后续只保留并演进 TypeScript 实现，Python 历史实现已删除。
- Rationale：用户明确确认 Python 版删除，仓库结构已从双实现收敛回单实现。
- Evidence：用户在 2026-05-11 的 harness 体检反馈中确认该方向；见 `docs/task-archive/T0001-2026-05-11-agent-harness-init.md`。
- Consequences：新开发、验证入口和 agent 配置面向 `apps/typescript/`；不要引用已删除的 `apps/python/` 作为当前事实。
- Revisit when：TypeScript 版被明确放弃，或用户要求重新保留 Python 实现。

### 2026-05-11 - 使用 harness 文档拆分 agent 状态与决策

- Decision：使用 `docs/PROGRESS.md` 记录当前状态和 WIP；使用 `docs/DECISIONS.md` 记录长期决策；使用 `docs/task-archive/` 保存任务证据。
- Rationale：原有 `docs/TODO.md` 更像任务池，不能可靠表达唯一当前任务、验证证据和长期决策边界。
- Evidence：本次 agent 配置体检确认缺少 `docs/PROGRESS.md`、`docs/DECISIONS.md` 和 `docs/task-archive/`；见 `docs/task-archive/T0001-2026-05-11-agent-harness-init.md`。
- Consequences：后续 agent 会话开始时读取 `AGENTS.md` 和 `docs/PROGRESS.md`，而不是只依赖 `docs/TODO.md`。
- Revisit when：仓库引入新的等价项目管理文件，并明确替代这些 harness 文档。

### 2026-05-11 - 不迁移既有历史计划文档

- Decision：本次 harness 初始化不迁移 `docs/plans/` 或 `apps/typescript/docs/` 下的历史计划、报告和归档格式。
- Rationale：历史迁移会扩大范围，且不影响当前 agent harness 生效。
- Evidence：`docs/` 已存在多份历史计划与报告，用户确认本轮只推进 harness 配置。
- Consequences：新增任务归档使用 `docs/task-archive/` 一任务一文件；旧文档保持原状，后续如需整理应作为单独任务。
- Revisit when：用户明确要求整理历史文档或统一归档格式。
