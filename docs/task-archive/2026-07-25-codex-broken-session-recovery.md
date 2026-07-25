# Codex 坏会话自动恢复

- 状态：`completed`
- 日期：2026-07-25

## 目标

当空闲的 Codex app-server 异常退出、`CodexMinimalSession` 进入 `broken` 状态后，让 `ChatManager` 在处理下一条用户消息前识别旧 agent 已不可用，重建 agent 并恢复原 thread，避免该消息因 `CodexMinimalSession is broken.` 丢失。

## 范围

- 为 `CodexMinimalSession` 暴露可用性判断。
- 让 `CodexAgent.isAlive()` 同时检查自身销毁状态和内部 session 状态。
- 增加覆盖坏 session 存活判断及消息恢复路径的回归测试。
- 不对执行中的 turn 做自动重试，避免重复产生工具副作用。
- 不在本 task 内追查 Windows `0xC000013A` 控制台中断的外部发送源。

## 根因

Codex app-server 异常退出后，`CodexMinimalSession` 会进入 `broken`，但 `CodexAgent.isAlive()` 原先只检查 agent 是否已执行 `destroy()`。`ChatManager` 因此会复用内部 session 已损坏的缓存 agent，导致下一条消息在发送时抛出 `CodexMinimalSession is broken.`；该次失败完成 agent 销毁后，再下一条消息才会重建 agent。

## 修改

- `CodexMinimalSession.isAlive()` 将 `broken`、`closing`、`closed` 状态报告为不可用。
- `CodexAgent.isAlive()` 同时检查自身销毁状态与 session 可用性。
- 回归测试覆盖：
  - 坏 session 使 agent 报告不可用；
  - session 状态的可用性契约；
  - `ChatManager` 在发送前清理坏 agent、恢复原 session，并把当前消息交给新 agent。

## 验证结果

- 修复前运行 `node -r ts-node/register tests/codex-agent.test.ts`：按预期失败，`agent.isAlive()` 实际为 `true`、预期为 `false`。
- 修复后定向测试通过：
  - `tests/codex-agent.test.ts`
  - `tests/codex-minimal-session.test.ts`
  - `tests/chat-manager-session-decision.test.ts`
- `npm run build`：通过。
- `npm test`：通过。
- `git diff --check`：通过。
- PM2 重启后：
  - 进程 `cc-feishu-ts` 状态为 `online`；
  - PID 为 `25360`；
  - 飞书 WebSocket 成功建立并进入 ready 状态；
  - 新启动日志无初始化错误。

## 关键证据

回归测试记录了坏 agent 的替换路径：旧 agent 被清理，新 agent 使用原 session ID 创建，并收到触发恢复的同一条消息。该路径避免了之前必须由“再下一条消息”才能恢复的问题。

## 剩余风险

- Windows `0xC000013A` 控制台中断的外部发送源尚未定位；本修复处理其发生后的空闲会话恢复，不阻止子进程退出本身。
- 如果 app-server 在 turn 执行中退出，当前 turn 仍会向用户报告失败且不会自动重试，以避免重复工具副作用。
