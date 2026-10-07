# 停滞任务心跳重设计

## 状态

`completed`

## 目标

- 删除按任务总运行时长触发的首次长任务通知。
- 仅在连续无内部活动时发送停滞心跳。
- 心跳阈值为连续停滞 2 分钟、5 分钟、10 分钟，之后每 10 分钟一次。
- 任意内部活动静默重置停滞周期，避免重复内容和最终回复前的竞态通知。

## 范围

- `src/bot/chat-workload-queue.ts`
- `src/config/index.ts`
- `src/handlers/message.handler.ts`
- `tests/chat-workload-queue-long-notice.test.ts`
- `tests/config.test.ts`
- `.env.example`
- 不修改会话决策通知，不启动、重启或停止 PM2/testbot/生产进程。

## 实现结果

- 原先基于任务总运行时长的 30 秒 / 60 秒通知已替换为基于 `lastActivityAt` 的停滞检测。
- 默认停滞阈值为 2 分钟、5 分钟、10 分钟；此后每 10 分钟重复。
- 任意 `onActivity` 事件都会清零心跳级别并重新开始停滞计时。
- 使用 generation 防止旧计时器或异步通知在活动恢复、任务完成后重新调度。
- `turn_finishing`、`sending_response`、`cleanup` 阶段禁止发送心跳。
- 心跳文案不再重复输出底层 `method`、`reason` 和 Turn ID，改为说明暂无执行事件及 `/stop` 操作。
- 新增环境变量：
  - `AGENT_STALLED_TASK_HEARTBEAT_THRESHOLDS_MS`
  - `AGENT_STALLED_TASK_HEARTBEAT_INTERVAL_MS`

## 验证

### 回归测试先失败

修改测试、尚未实现新接口时运行：

```powershell
npx ts-node tests/chat-workload-queue-long-notice.test.ts
```

结果：失败，`TS2353`，旧实现不存在 `stalledTaskHeartbeatThresholdsMs`，确认测试能约束新行为。

### 定向验证

```powershell
1..3 | ForEach-Object { npx ts-node tests/chat-workload-queue-long-notice.test.ts }
npm run build
git diff --check
```

结果：定向计时测试连续 3 次通过；TypeScript 构建通过；`git diff --check` 通过。

覆盖行为：

- 持续有活动时不通知；
- 2 / 5 / 10 分钟及后续重复心跳；
- 活动恢复后重置心跳周期；
- 最终回复阶段禁止心跳；
- 任务完成后取消计时；
- 通知失败不阻塞任务。

### 完整验证

```powershell
npm run verify
```

结果：通过，退出码 0；包含 `tsc` 和全部单元测试。

## 关键证据

- 原问题 turn `019f6def...` 在 2 分 31 秒内持续有内部事件；按新规则不会发送任何心跳，只发送最终回复。
- 新测试以短阈值重放相同模式，验证活动会持续推迟心跳，而不是按总运行时长发送。

## 剩余风险

- 心跳依赖上游 `onActivity` 事件；正常但单次耗时超过 2 分钟且没有事件的模型或工具调用会触发心跳。文案只陈述“暂无执行事件”，不会断言任务已经卡死。
- 如果任务长期停在最终回复阶段，心跳会被持续抑制；实际错误和进程退出仍由现有错误路径报告。
- 旧的 `AGENT_LONG_TASK_NOTICE_*` 环境变量不再生效。仓库内现有 `.env`、`.env.testbot` 未配置这些旧变量。
- 当前运行中的 testbot 未重启，需在后续正常部署或重启后才会加载新行为。
