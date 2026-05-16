# Progress

## 当前状态

- 当前阶段：TypeScript 单实现主线。
- 当前有效基线：TypeScript 应用位于仓库根目录；Python 历史实现已删除。
- 默认验证命令：`npm run verify`
- 当前任务来源：用户确认将 Feishu message content 解析与 media materialization 分成两个任务推进；content 解析与 media materialization 两个拆分任务现已完成。

## 当前任务

- 状态：validated
- 任务：延长 Codex Agent 空闲保留时间并减少普通续用提示。
- scope：把默认 Codex idle reclaim TTL 从 30 分钟调长到 4 小时；普通同作息日续用不再发送 `继续使用上一个会话。` 决策提示；保留跨作息日新开、明确继续、明确新开、无可延续会话等有信息量的提示。
- 验证命令：`npm run verify`
- 验证结果：passed，`npm run verify` 已在仓库根成功执行 `tsc` 和全部单元测试；`git diff --check` 也通过。
- 归档：`docs/task-archive/T0020-2026-05-16-session-retention-and-notice.md`
- 当前观察项：用户确认同时调整保留时间和提示策略；默认 TTL 现在是 4 小时，仍可用 `AGENT_IDLE_TTL_MS` 覆盖；普通同作息日续用现在静默。本任务未启动、重启、清理 PM2 或生产 Codex 进程，已部署进程仍需由 operator 重启后才会使用新代码。

## 下一任务

- 独立任务：深挖 Codex app-server 会话状态机。
  - Files：`src/codex-minimal/session.ts`、`src/codex-minimal/app-server-rpc.ts`、`src/codex-minimal/app-server-process.ts`
  - Problem：`CodexMinimalSession` 同时处理进程生命周期、JSON-RPC、thread start/resume、turn 状态、通知解析、最终回答提取、interrupt 和错误归因；状态转换风险集中但测试面偏重私有细节。
  - Solution：集中 thread 启动/恢复与 turn/item 通知解释，形成更深的内部 Module，让成功、失败、interrupt、无 final answer 等行为可以独立验证。
- 独立任务：统一 Claude 与 Codex session scanner 的 session history Seam。
  - Files：`src/claude/session-scanner.ts`、`src/codex/session-scanner.ts`、`src/bot/chat-manager.ts`
  - Problem：Claude 与 Codex scanner 暴露近似 Interface，但 `ChatManager` 仍承担 provider 分派和 session history 查询知识；这里已有两个 Adapter，是一个真实 Seam。
  - Solution：提炼统一的 session history Module，保留 Claude/Codex provider Adapter，使 `ChatManager` 只依赖统一 Interface。
- 独立任务：收敛 ChatManager 职责。
  - Files：`src/bot/chat-manager.ts`、`src/agent/types.ts`
  - Problem：`ChatManager` 混合 chat binding、provider 切换、resume 列表格式化、Agent 创建/销毁、长消息切片和 Feishu 发送；它有 Leverage，但 Locality 不够清晰。
  - Solution：分离 chat session orchestration、回复投递和 session history 展示，让 `ChatManager` 专注管理 chat 与 Agent 生命周期。
- 等待用户指定新的业务或文档整理任务。

## 文档入口

- `AGENTS.md`
- `docs/DECISIONS.md`
- `docs/task-archive/`
