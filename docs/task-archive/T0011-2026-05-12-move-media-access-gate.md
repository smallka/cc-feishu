# T0011 - Move Media Access Gate Before Download

## Scope

- 前移图片/文件消息的 access gate。
- 让媒体消息先完成权限、绑定、无效绑定检查，再触发飞书媒体资源下载。
- 新增 `tests/media-access-gate.test.ts` 覆盖未授权、未绑定、无效绑定场景下不下载媒体。

## Non-goals

- 不改变 `/stop`、`/new` 在入队前即时执行的行为。
- 不改变 `/stat` 排队执行的现有语义。
- 不调整媒体消息只支持 Codex provider 的现有规则。
- 不重构 ChatManager、watchdog 或命令路由。

## Changes

- `message.handler` 将媒体 task 创建拆为两个阶段：
  - `parseMessageTask` 只解析轻量元数据，例如 text、image_key、file_key。
  - `materializeQueuedTask` 在 access gate 通过后再下载图片/文件并生成最终 `QueuedMessageTask`。
- 未授权用户发送图片/文件时，只返回未授权提示，不触发下载。
- 未绑定群发送图片/文件且自动绑定失败时，不触发下载。
- 绑定目录失效时，返回无效绑定提示，不触发下载。
- provider 不支持图片/文件的提示保留，但现在发生在 access gate 之后。

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
- 新增 `media-access-gate.test.ts` passed，验证未授权图片、未绑定文件、无效绑定图片都不会调用下载方法。
- 既有 `/cd`、无效绑定、群自动绑定、私聊默认目录、resume、命令路由和 websocket dispatcher 测试继续通过。

## Risks

- 媒体消息的 JSON 解析仍发生在 access gate 之前；这一步只解析事件 payload，不触发远端下载或本地落盘。
- provider 不支持媒体的提示顺序发生细微变化：未授权、未绑定或无效绑定时会先返回 access gate 的提示，而不是 provider 提示。这是本任务的预期行为。
- `/stat` 仍排队执行，长任务状态观察语义仍待独立评估。
