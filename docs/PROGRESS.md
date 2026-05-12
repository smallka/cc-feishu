# Progress

## 当前状态

- 当前阶段：TypeScript 单实现主线。
- 当前有效基线：TypeScript 应用位于仓库根目录；Python 历史实现已删除。
- 默认验证命令：`npm run verify`
- 当前任务来源：用户确认继续收敛 Feishu 消息处理 Module；已提取 agent workload queue 与 active progress Module。

## 当前任务

- 状态：validated
- 任务：提取 Feishu chat workload queue 与 active progress Module。
- scope：在保持控制命令即时处理、agent workload per-chat 串行、`/new` 清等待队列、`/stat` 可查看 active progress、shutdown drain 和跨 chat 隔离语义不变的前提下，把 `message.handler` 中的队列与 active status 状态提取到独立 Module。
- 验证命令：`npm run verify`
- 验证结果：passed，`npm run verify` 已在仓库根成功执行 `tsc` 和全部 `tests/*.test.ts`。
- 归档：`docs/task-archive/T0015-2026-05-12-extract-workload-queue.md`
- 当前观察项：`message.handler` 已不再直接持有 workload queue、active processor 或 active progress Map；媒体 materialization 和 access/auto-bind intake 仍在 handler 中，适合作为后续独立收敛点。

## 下一任务

- 独立任务：收敛 Feishu message intake 与 materialization。
  - Files：`src/handlers/message.handler.ts`、`src/services/message.service.ts`
  - Problem：`message.handler` 仍同时承担 Feishu message content 解析、access/auto-bind、图片/文件 materialization 和 workload 入队编排；队列状态已收敛，但 intake 的顺序知识仍偏集中。
  - Solution：提取 message intake/materialization Module，让 handler 只编排 access gate、控制命令和 workload enqueue，并补媒体下载失败、provider 不支持媒体和空内容解析测试。
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
