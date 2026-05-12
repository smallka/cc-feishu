# Progress

## 当前状态

- 当前阶段：TypeScript 单实现主线。
- 当前有效基线：TypeScript 应用位于仓库根目录；Python 历史实现已删除。
- 默认验证命令：`npm run verify`
- 当前任务来源：用户确认继续收敛 Feishu 消息处理 Module；已把控制命令从普通 FIFO 队列中剥离，保留 agent workload 进队列。

## 当前任务

- 状态：validated
- 任务：控制命令即时化，队列只收 agent workload。
- scope：在保持 access gate、per-chat 串行队列、`/new` 清等待队列、`/stop` interrupt、`/stat` 主动查询和菜单选择语义不变的前提下，让 `/help`、`/agent`、`/debug`、`/cd`、`/resume`、未知 slash command 和菜单数字选择即时处理，不进入普通 FIFO 队列。
- 验证命令：`npm run verify`
- 验证结果：passed，`npm run verify` 已在仓库根成功执行 `tsc` 和全部 `tests/*.test.ts`。
- 归档：`docs/task-archive/T0014-2026-05-12-control-routing-immediate.md`
- 当前观察项：控制命令和菜单数字选择已从普通 FIFO 队列剥离；`message.handler` 仍保留队列、active progress 和媒体 materialization，适合作为下一步独立收敛任务。

## 下一任务

- 独立任务：继续收敛 Feishu 消息处理 Module。
  - Files：`src/handlers/message.handler.ts`、`src/bot/chat-manager.ts`
  - Problem：Feishu message intake 同时承担消息解析、权限、自动绑定、队列、active progress 和回复投递；Interface 虽小，但 Implementation 中的状态和顺序知识仍过度集中。
  - Solution：继续提取 per-chat 队列和 active status Module，提升 Locality 并让测试围绕更稳定的 seams 编写。
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
