# Progress

## 当前状态

- 当前阶段：TypeScript 单实现主线。
- 当前有效基线：TypeScript 应用位于仓库根目录；Python 历史实现已删除。
- 默认验证命令：`npm run verify`
- 当前任务来源：用户确认将 Feishu message content 解析与 media materialization 分成两个任务推进；content 解析与 media materialization 两个拆分任务现已完成。

## 当前任务

- 状态：validated
- 任务：按作息日和简单意图规则选择是否延续会话。
- scope：在不启动或重启现有 PM2/生产进程的前提下，为普通消息进入 Agent 前增加本地会话选择规则：同作息日默认延续；跨作息日默认新开，除非文本明确表达继续；明确新开意图始终新开；每次选择都向用户说明。
- 验证命令：`npm run verify`
- 验证结果：passed，`npm run verify` 已在仓库根成功执行 `tsc` 和全部 `tests/*.test.ts`；新增 `session-decision.test.ts` 覆盖作息日换日线、继续/新开意图和无可延续会话兜底，新增 `chat-manager-session-decision.test.ts` 覆盖 ChatManager 的实际 resume/new session 选择与提示。
- 归档：`docs/task-archive/T0019-2026-05-15-workday-session-decision.md`
- 当前观察项：用户确认不引入 agent 判断；规则按作息日执行，默认本地 05:00 换日，可用 `AGENT_SESSION_DAY_CUTOFF_HOUR` 调整。本任务未启动 testbot，未重启/清理/影响正在跑的生产 PM2 或 Codex 进程。

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
