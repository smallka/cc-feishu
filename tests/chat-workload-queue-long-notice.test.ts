import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

import { ChatWorkloadQueue } from '../src/bot/chat-workload-queue';
import type { ActivityEvent } from '../src/agent/types';

interface TestTask {
  chatId: string;
  messageId: string;
  text: string;
  release: Promise<void>;
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }
  throw new Error(`${label} was not observed`);
}

function createQueue(options: {
  notices: string[];
  onProcess?: (onActivity: (event?: ActivityEvent) => void) => void;
  notifier?: (chatId: string, text: string) => Promise<void>;
}): ChatWorkloadQueue<TestTask> {
  return new ChatWorkloadQueue<TestTask>({
    describeTask: task => ({
      chatId: task.chatId,
      messageId: task.messageId,
      senderId: 'ou_test',
      provider: 'codex',
      messageType: 'text',
      textLength: task.text.length,
      imageCount: 0,
      enqueuedAt: Date.now(),
    }),
    processTask: async (task, context) => {
      const event: ActivityEvent = {
        phase: 'turn_running',
        reason: `processing ${task.text}`,
        method: 'item/completed',
        turnId: 'turn-long-notice',
      };
      context.onActivity(event);
      options.onProcess?.(context.onActivity);
      await task.release;
    },
    stalledTaskHeartbeatNotifier: options.notifier ?? (async (_chatId, text) => {
      options.notices.push(text);
    }),
    stalledTaskHeartbeatThresholdsMs: [80, 200, 320],
    stalledTaskHeartbeatIntervalMs: 120,
  });
}

async function runActiveTaskDoesNotNotifyTest(): Promise<void> {
  const notices: string[] = [];
  const release = createDeferred();
  let onActivity!: (event?: ActivityEvent) => void;
  const queue = createQueue({
    notices,
    onProcess: callback => {
      onActivity = callback;
    },
  });

  queue.enqueue({
    chatId: 'oc_active_task',
    messageId: 'om_active_task_1',
    text: '持续有进展的任务',
    release: release.promise,
  });

  for (let index = 0; index < 5; index += 1) {
    await delay(30);
    onActivity({
      phase: 'turn_running',
      reason: `progress ${index}`,
      method: 'item/completed',
      turnId: 'turn-active',
    });
  }
  assert.equal(notices.length, 0, 'active task should not receive elapsed-time notices');

  release.resolve();
  await queue.stop();
}

async function runStalledHeartbeatScheduleTest(): Promise<void> {
  const notices: string[] = [];
  const release = createDeferred();
  const queue = createQueue({ notices });

  queue.enqueue({
    chatId: 'oc_stalled_task',
    messageId: 'om_stalled_task_1',
    text: '停滞任务',
    release: release.promise,
  });

  await waitFor(() => notices.length === 1, 'two-minute stalled heartbeat');
  assert.match(notices[0], /过去 .*内没有收到新的执行进展/);
  assert.match(notices[0], /当前阶段: turn 运行中/);
  assert.match(notices[0], /如需终止，可发送 \/stop/);

  await waitFor(() => notices.length === 2, 'five-minute stalled heartbeat');
  assert.match(notices[1], /仍未恢复进展/);

  await waitFor(() => notices.length === 3, 'ten-minute stalled heartbeat');
  await waitFor(() => notices.length === 4, 'repeating ten-minute stalled heartbeat');

  release.resolve();
  await queue.stop();
}

async function runActivityResetsHeartbeatTest(): Promise<void> {
  const notices: string[] = [];
  const release = createDeferred();
  let onActivity!: (event?: ActivityEvent) => void;
  const queue = createQueue({
    notices,
    onProcess: callback => {
      onActivity = callback;
    },
  });

  queue.enqueue({
    chatId: 'oc_reset_heartbeat',
    messageId: 'om_reset_heartbeat_1',
    text: '恢复进展任务',
    release: release.promise,
  });

  await waitFor(() => notices.length === 1, 'heartbeat before resumed activity');
  onActivity({
    phase: 'turn_running',
    reason: 'progress resumed',
    method: 'item/started',
    turnId: 'turn-reset',
  });
  await delay(40);
  assert.equal(notices.length, 1, 'new activity should reset the stalled timer');

  await waitFor(() => notices.length === 2, 'heartbeat after activity stalls again');
  assert.match(notices[1], /过去 .*内没有收到新的执行进展/);
  assert.doesNotMatch(notices[1], /仍未恢复进展/);

  release.resolve();
  await queue.stop();
}

async function runNoHeartbeatWhileSendingResponseTest(): Promise<void> {
  const notices: string[] = [];
  const release = createDeferred();
  const queue = createQueue({
    notices,
    onProcess: onActivity => {
      onActivity({
        phase: 'sending_response',
        reason: 'sending final response',
        method: 'turn/completed',
        turnId: 'turn-sending-response',
      });
    },
  });

  queue.enqueue({
    chatId: 'oc_sending_response',
    messageId: 'om_sending_response_1',
    text: '正在发送回复',
    release: release.promise,
  });

  await delay(120);
  assert.equal(notices.length, 0, 'response delivery should suppress stalled heartbeats');

  release.resolve();
  await queue.stop();
}

async function runNoNoticeAfterCompletionTest(): Promise<void> {
  const notices: string[] = [];
  const release = createDeferred();
  const queue = createQueue({ notices });

  queue.enqueue({
    chatId: 'oc_long_notice_done',
    messageId: 'om_long_notice_done_1',
    text: '短任务',
    release: release.promise,
  });

  release.resolve();
  await queue.stop();
  await delay(60);

  assert.equal(notices.length, 0, 'completed task should cancel pending long-running notices');
}

async function runNotifierFailureDoesNotBlockTaskTest(): Promise<void> {
  const notices: string[] = [];
  const release = createDeferred();
  const queue = createQueue({
    notices,
    notifier: async () => {
      throw new Error('synthetic notifier failure');
    },
  });

  queue.enqueue({
    chatId: 'oc_long_notice_failure',
    messageId: 'om_long_notice_failure_1',
    text: '通知失败任务',
    release: release.promise,
  });

  await delay(100);
  release.resolve();
  await queue.stop();

  assert.equal(notices.length, 0);
}

async function main(): Promise<void> {
  await runActiveTaskDoesNotNotifyTest();
  await runStalledHeartbeatScheduleTest();
  await runActivityResetsHeartbeatTest();
  await runNoHeartbeatWhileSendingResponseTest();
  await runNoNoticeAfterCompletionTest();
  await runNotifierFailureDoesNotBlockTaskTest();
  console.log('chat-workload-queue-long-notice.test.ts passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
