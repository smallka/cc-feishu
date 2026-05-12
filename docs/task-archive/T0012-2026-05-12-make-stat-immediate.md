# T0012 - Make Stat Command Immediate

## Scope

- 让 `/stat` 成为即时状态命令。
- 保留 access gate、绑定检查、无效绑定提示和现有 `/stat` 输出内容。
- 新增 handler 级测试，覆盖长任务运行期间 `/stat` 不等待普通消息队列即可返回当前任务状态。

## Non-goals

- 不改变 `/stop`、`/new` 的即时控制行为。
- 不改变 `/stat` 的展示格式或 `ChatManager.getSessionInfo` 内容。
- 不拆分队列、watchdog、进度通知或 ChatManager 职责。
- 不改变图片/文件消息的 access gate 和下载顺序。

## Changes

- `message.handler` 在 access gate 通过后、普通消息入队前识别 `/stat`。
- `/stat` 复用现有 `handleMessageCommand` 分支和 `getActiveTaskStatus`，因此仍会：
  - 清理菜单选择。
  - 检查无效绑定并返回原有提示。
  - 在存在活跃任务时附加当前任务、阶段、最近进展和排队数量。
- 新增 `tests/stat-immediate-handler.test.ts`：
  - 模拟一个普通文本消息处于长时间运行。
  - 在该消息未完成前发送 `/stat`。
  - 断言 `/stat` 已立即返回并包含当前任务状态。

## Validation

Command:

```powershell
Set-Location C:\work\cc-feishu
npm run verify
```

Result: passed.

Evidence:

- `npm run build` passed.
- `npm test` passed，执行全部 `tests/*.test.ts`。
- 新增 `stat-immediate-handler.test.ts` passed，验证 `/stat` 在前一个普通任务仍运行时即可返回状态。
- 既有 `/cd`、`/new`、无效绑定、媒体 access gate、自动绑定、私聊默认目录、resume、命令路由和 websocket dispatcher 测试继续通过。

## Risks

- `/stat` 现在不再进入普通队列，因此不会被排在早先普通消息后执行；这是本任务的预期行为，但依赖旧排队语义的观察方式会改变。
- `/stat` 仍在 access gate 之后执行，未授权、未绑定和无效绑定行为保持既有约束。
- 队列、watchdog、进度通知仍集中在 `message.handler`，职责收敛还需要后续独立任务继续推进。
