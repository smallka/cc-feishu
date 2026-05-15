# Progress

## 当前状态

- 当前阶段：TypeScript 单实现主线。
- 当前有效基线：TypeScript 应用位于仓库根目录；Python 历史实现已删除。
- 默认验证命令：`npm run verify`
- 当前任务来源：用户确认将 Feishu message content 解析与 media materialization 分成两个任务推进；content 解析与 media materialization 两个拆分任务现已完成。

## 当前任务

- 状态：validated
- 任务：为 Codex Agent 增加空闲自动回收。
- scope：在不改变消息队列、权限、目录绑定和 Codex app-server turn 状态机行为的前提下，避免每个活跃过的 chat 永久持有一个后台 `codex app-server` 进程。
- 验证命令：`npm run verify`
- 验证结果：passed，`npm run verify` 已在仓库根成功执行 `tsc` 和全部 `tests/*.test.ts`；新增 `chat-manager-idle-reclaim.test.ts` 覆盖 Codex idle reclaim、运行中延迟回收、重复消息取消旧 timer、恢复 session，以及 Claude provider 不启用 idle reclaim。
- 归档：`docs/task-archive/T0018-2026-05-15-codex-agent-idle-reclaim.md`
- 当前观察项：PM2 进程正常；本次排查时 `cc-feishu-ts` pid `3836` 在线 2D、重启 0 次，但其下已有 7 组 `codex app-server` 根进程链。修复后新代码会在 Codex Agent 空闲 30 分钟后回收 app-server，并保留 session id 供下次消息 resume；现有 PM2 进程需重启后才会加载新代码。

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
