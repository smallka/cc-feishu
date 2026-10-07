# Testbot 停滞心跳 E2E

## 状态

`completed`

## 目标

- 将当前工作区构建结果加载到 `cc-feishu-ts-testbot`。
- 通过真实飞书消息验证：活跃任务不按总运行时间通知；连续无活动达到阈值时发送一次停滞心跳；活动恢复后正常完成且不产生重复通知。

## 范围

- 仅构建、重启和检查 `cc-feishu-ts-testbot`。
- 在 testbot 测试群发送明确标注的受控 E2E 消息，并读取同群消息、testbot 日志和 Codex rollout。
- 未操作 `cc-feishu-ts` 生产进程。
- 未提交代码，未修改生产环境配置。

## 环境准备

- `npm run build` 通过。
- PM2 仅重启 `cc-feishu-ts-testbot`。
- testbot 专用飞书用户身份确认为 `smallka`（`ou_b115a7dc5daa913521db28e0228c6690`）。
- testbot 应用为“家喵”。
- 原测试群绑定 `C:\work\testbot` 不存在；经用户确认后发送 `/cd C:\work\cc-feishu`，群绑定切换成功。

## 默认阈值 E2E

发送消息：

```text
【自动化 E2E：停滞心跳验证】
请使用 shell 执行 PowerShell 命令 Start-Sleep -Seconds 130。等待命令结束后，只回复 E2E_HEARTBEAT_DONE，不要执行其他操作。
```

- 请求消息 ID：`om_x100b6aab268d1cb0b301fff68affd3c`
- 收到时间：`2026-07-17 17:31:48`
- Turn 会话：`019f6f6a-fefd-7393-b11f-d9174659ca12`
- 最终回复：`2026-07-17 17:34:26`，内容为 `E2E_HEARTBEAT_DONE`
- 30 秒、90 秒及整个任务运行期间均未出现旧式长任务通知。

Rollout 显示长命令期间 Codex 以约 48～60 秒间隔产生 `wait` 工具事件，因此连续无活动时间始终小于默认 2 分钟。该用例验证了任务即使总耗时超过 2 分钟，只要持续有内部活动就不会通知。

## 加速阈值 E2E

为了真实命中心跳发送分支，仅在 testbot 的 `.env.testbot` 临时设置：

```env
AGENT_STALLED_TASK_HEARTBEAT_THRESHOLDS_MS=55000,120000,180000
AGENT_STALLED_TASK_HEARTBEAT_INTERVAL_MS=180000
```

重启 testbot 后重发相同的已批准消息：

- 请求消息 ID：`om_x100b6aabcd62fc80b1486051da50f68`
- 收到时间：`2026-07-17 17:39:07`
- Turn 会话：`019f6f71-ae5f-7041-977b-3b9cd0ad7bf6`
- 心跳发送时间：`2026-07-17 17:40:56`
- 心跳消息 ID：`om_x100b6aabc44d64acb168216d23a9dc2`
- 心跳内容包含“过去 55秒内没有收到新的执行进展”、当前阶段、运行时间、排队数和 `/stop` 提示。
- 最终回复时间：`2026-07-17 17:42:01`
- 最终回复卡片 ID：`om_x100b6aabc057b0a0b29f8510f465a43`
- 最终内容：`E2E_HEARTBEAT_DONE`
- 心跳与最终回复之间没有重复心跳，也没有最终回复竞态通知。

## 恢复与最终状态

- 临时心跳配置已从 `.env.testbot` 删除。
- 再次仅重启 `cc-feishu-ts-testbot`，最终 PID 为 `28316`，状态 `online`。
- 通过加载 `dist/config` 核验 testbot 当前配置：
  - thresholds：`[120000, 300000, 600000]`
  - interval：`600000`
- `cc-feishu-ts` 生产进程在整个测试期间保持原 PID `17868`，未重启。

## 结论

- 基于总运行时间的 30 秒首次通知已消失。
- 任意内部活动会重置停滞计时。
- 真正达到连续无活动阈值时只发送一次新心跳。
- 活动恢复后正常完成，心跳不会与最终回复同时发送。

## 剩余风险

- 默认 5 分钟、10 分钟和后续每 10 分钟的真实飞书等待未逐个耗时验证；对应递增调度已由单元测试覆盖。
- `lark-cli` 当前二进制为 `1.0.39`，可更新至 `1.0.71`；Skills 为 `1.0.36`，与当前二进制不同步。此次未执行更新。
