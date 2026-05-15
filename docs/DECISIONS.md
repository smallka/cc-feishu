# Decisions

本文件只记录会影响后续工作的长期决策。临时排查过程、一次性日志、完整验证输出、任务证据和会话交接不写入这里。

## Decision Log

### 2026-05-11 - 以 TypeScript 作为唯一长期实现

- Decision：后续只保留并演进 TypeScript 实现，Python 历史实现已删除。
- Rationale：用户明确确认 Python 版删除，仓库结构已从双实现收敛回单实现。
- Evidence：用户在 2026-05-11 的 harness 体检反馈中确认该方向；见 `docs/task-archive/T0001-2026-05-11-agent-harness-init.md`。
- Consequences：新开发、验证入口和 agent 配置面向仓库根目录的 TypeScript 应用；不要引用已删除的 `apps/python/` 作为当前事实。
- Revisit when：TypeScript 版被明确放弃，或用户要求重新保留 Python 实现。

### 2026-05-11 - 使用 harness 文档拆分 agent 状态与决策

- Decision：使用 `docs/PROGRESS.md` 记录当前状态和 WIP；使用 `docs/DECISIONS.md` 记录长期决策；使用 `docs/task-archive/` 保存任务证据。
- Rationale：原有 `docs/TODO.md` 更像任务池，不能可靠表达唯一当前任务、验证证据和长期决策边界。
- Evidence：本次 agent 配置体检确认缺少 `docs/PROGRESS.md`、`docs/DECISIONS.md` 和 `docs/task-archive/`；见 `docs/task-archive/T0001-2026-05-11-agent-harness-init.md`。
- Consequences：后续 agent 会话开始时读取 `AGENTS.md` 和 `docs/PROGRESS.md`，而不是只依赖 `docs/TODO.md`。
- Revisit when：仓库引入新的等价项目管理文件，并明确替代这些 harness 文档。

### 2026-05-11 - 将 TypeScript 应用提升到仓库根目录

- Decision：原 TypeScript 应用子目录已提升到仓库根目录，仓库根目录即应用根目录。
- Rationale：Python 历史实现删除后，仓库只剩 TypeScript 单实现，继续保留旧的多应用子目录会增加运行、PM2 配置和 agent 入口的路径负担。
- Evidence：用户在 2026-05-11 明确要求“把 apps\\typescipt 里的内容移出来，回到单实现的结构”，并补充 ecosystem 配置也要改。
- Consequences：默认验证命令为在仓库根运行 `npm run build`；PM2 ecosystem 配置位于仓库根，并以仓库根作为 `cwd`。
- Revisit when：仓库重新变为多实现或多应用布局。

### 2026-05-11 - 不迁移既有历史计划文档

- Decision：本次 harness 初始化不迁移 `docs/plans/` 或原应用内文档目录下的历史计划、报告和归档格式。
- Rationale：历史迁移会扩大范围，且不影响当前 agent harness 生效。
- Evidence：`docs/` 已存在多份历史计划与报告，用户确认本轮只推进 harness 配置。
- Consequences：新增任务归档使用 `docs/task-archive/` 一任务一文件；旧文档保持原状，后续如需整理应作为单独任务。
- Revisit when：用户明确要求整理历史文档或统一归档格式。
- Superseded：已被 2026-05-11 “删除非当前维护入口的旧文档”取代。

### 2026-05-11 - 删除非当前维护入口的旧文档

- Decision：删除 TODO 文档、`docs/plans/`、`CLAUDE.md`、`tests/README.md`、早期 init plan、旧协议别名和编码损坏的 Python SDK 历史分析；当前文档入口只保留最小 README、安装说明、协议说明、运行时边界备忘、PM2 记录和 agent harness 文档。
- Rationale：用户明确要求 TODO 文档不再保留，历史 plans 可删除，README 只保留最小给人看的部分，并删除 CLAUDE 与 tests README；旧 Python SDK 分析和协议别名已不应作为当前事实来源。
- Evidence：见 `docs/task-archive/T0006-2026-05-11-prune-legacy-docs.md`。
- Consequences：后续任务池不再依赖 TODO 文档；当前任务和下一步只写入 `docs/PROGRESS.md`，长期决策写入本文件，任务证据写入 `docs/task-archive/`。
- Revisit when：用户要求恢复某类历史设计记录，或需要重新建立当前维护用的任务池文档。

### 2026-05-15 - Codex Agent 空闲 30 分钟后自动回收

- Decision：Codex provider 的 per-chat Agent 空闲 30 分钟后自动销毁本地 Agent/app-server 进程链，但保留 session id，下一条消息创建新 Agent 并 resume；TTL 可通过 `AGENT_IDLE_TTL_MS` 调整。
- Rationale：PM2 主进程正常，但每个曾活跃 chat 会常驻一个 `CodexAgent`，而每个 `CodexAgent` 会持有一个 `codex app-server` 子进程，导致后台 Codex 实例随 chat 数增长。
- Evidence：见 `docs/task-archive/T0018-2026-05-15-codex-agent-idle-reclaim.md`。
- Consequences：空闲 chat 不再长期占用 Codex app-server；首次恢复消息会重新启动 Codex Agent，并依赖已有 session id resume。
- Revisit when：Codex app-server 支持更轻量的长期复用池、实时进程指标显示，或用户需要 Claude provider 也采用同类回收策略。
