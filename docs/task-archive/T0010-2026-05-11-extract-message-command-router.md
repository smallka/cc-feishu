# T0010 - Extract Feishu Message Command Router

## Scope

- 从 `src/handlers/message.handler.ts` 抽出 Feishu 消息命令路由 Module。
- 新增 `src/bot/message-command-router.ts`，集中处理 `/help`、`/stat`、`/agent`、`/debug`、`/cd`、`/resume`、菜单数字选择、未知 slash command 和普通消息投递。
- 新增 `src/bot/work-directory.ts`，承载目录解析和可用性检查，供 handler 与 command router 共用。
- 新增 `tests/message-command-router.test.ts`，让命令路由可以脱离 Feishu raw event handler 直接验证。

## Non-goals

- 不改变 `/stop`、`/new` 在入队前即时执行的行为。
- 不改变 `/stat` 排队执行的现有语义。
- 不调整图片/文件消息下载与鉴权的顺序。
- 不重构 ChatManager、session scanner 或 watchdog。

## Changes

- `message.handler` 继续负责 Feishu message intake、授权/绑定检查、群自动绑定、每 chat FIFO 队列、watchdog 和进度通知。
- `message-command-router` 接管出队后的命令分支和菜单 action 执行。
- 命令路由返回 `kind: 'command' | 'agent_message'`，让调用方只需要区分命令分支和普通 agent 消息分支。
- 目录相关的 `resolveWorkPathCandidate` / `isDirectoryAvailable` 移入可复用 Module。

## Validation

Command:

```powershell
Set-Location C:\work\cc-feishu
npm run verify
```

Result: passed.

Evidence:

- `npm run build` passed.
- `npm test` passed，执行 `tests/*.test.ts`，包括新增 `message-command-router.test.ts`。
- 既有 `/cd` 创建确认、无效绑定、群自动绑定、私聊默认目录、resume scope、unauthorized handler 等测试继续通过。

## Risks

- 本任务是行为保持型抽取，仍保留既有风险：媒体消息在当前实现中会先进入下载 task 创建，再做授权/绑定判断；后续应作为独立任务把 access gate 前移。
- `/stat` 仍然排队执行，观察长任务状态的语义不理想；后续应独立评估是否改为即时控制命令。
- `message-command-router` 仍直接依赖 `chatManager`、`messageService` 和 `menuContext` 单例；测试可见性已有改善，但依赖注入还未完全收敛。

