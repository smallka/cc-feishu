import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin,ou_ops';

const {
  handleMessage,
  stopMessageHandling,
} = require('../src/handlers/message.handler') as typeof import('../src/handlers/message.handler');
const { chatManager } = require('../src/bot/chat-manager') as typeof import('../src/bot/chat-manager');
const messageService = (require('../src/services/message.service') as typeof import('../src/services/message.service')).default;

interface MessageEvent {
  sender: {
    sender_id: {
      open_id: string;
    };
    sender_type: string;
  };
  message: {
    message_id: string;
    message_type: string;
    content: string;
    chat_id: string;
    chat_type: string;
  };
}

type SendMessage = typeof chatManager.sendMessage;

function createTextEvent(messageId: string, chatId: string, text: string): MessageEvent {
  return {
    sender: {
      sender_id: {
        open_id: 'ou_admin',
      },
      sender_type: 'user',
    },
    message: {
      message_id: messageId,
      message_type: 'text',
      content: JSON.stringify({ text }),
      chat_id: chatId,
      chat_type: 'p2p',
    },
  };
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`${label} was not observed`);
}

async function delay(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);
  const originalAddReaction = messageService.addReaction.bind(messageService);
  const originalRemoveReaction = messageService.removeReaction.bind(messageService);
  const originalSendMessage = chatManager.sendMessage.bind(chatManager);
  const originalInterrupt = chatManager.interrupt.bind(chatManager);
  const originalReset = chatManager.reset.bind(chatManager);
  const originalGetSessionInfo = chatManager.getSessionInfo.bind(chatManager);

  const textMessages: string[] = [];
  const sentPrompts: Array<{ chatId: string; text: string }> = [];
  const removedReactions: string[] = [];
  let sendMessageImpl: SendMessage = (async () => {}) as SendMessage;

  try {
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      textMessages.push(text);
    }) as typeof messageService.sendTextMessage;
    messageService.addReaction = (async (_messageId: string) => `reaction-${_messageId}`) as typeof messageService.addReaction;
    messageService.removeReaction = (async (_messageId: string, reactionId: string) => {
      removedReactions.push(reactionId);
    }) as typeof messageService.removeReaction;
    chatManager.sendMessage = (async (...args: Parameters<SendMessage>) => sendMessageImpl(...args)) as SendMessage;
    chatManager.interrupt = (async () => 'no_session') as typeof chatManager.interrupt;
    chatManager.reset = (async () => 'C:\\work\\cc-feishu') as typeof chatManager.reset;
    chatManager.getSessionInfo = (() => '当前没有活跃会话\nProvider: codex\n工作目录: C:\\work') as typeof chatManager.getSessionInfo;

    await runSerialAndStatusTest({ sentPrompts, textMessages, setSendMessageImpl: impl => { sendMessageImpl = impl; } });
    await runResetClearsQueuedTest({ sentPrompts, textMessages, removedReactions, setSendMessageImpl: impl => { sendMessageImpl = impl; } });
    await runFailureCleanupTest({ sentPrompts, textMessages, setSendMessageImpl: impl => { sendMessageImpl = impl; } });
    await runCrossChatIsolationTest({ sentPrompts, setSendMessageImpl: impl => { sendMessageImpl = impl; } });
    await runStopDrainTest({ sentPrompts, setSendMessageImpl: impl => { sendMessageImpl = impl; } });

    console.log('workload-queue-handler.test.ts passed');
  } finally {
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
    messageService.addReaction = originalAddReaction as typeof messageService.addReaction;
    messageService.removeReaction = originalRemoveReaction as typeof messageService.removeReaction;
    chatManager.sendMessage = originalSendMessage as typeof chatManager.sendMessage;
    chatManager.interrupt = originalInterrupt as typeof chatManager.interrupt;
    chatManager.reset = originalReset as typeof chatManager.reset;
    chatManager.getSessionInfo = originalGetSessionInfo as typeof chatManager.getSessionInfo;
  }
}

async function runSerialAndStatusTest(options: {
  sentPrompts: Array<{ chatId: string; text: string }>;
  textMessages: string[];
  setSendMessageImpl: (impl: SendMessage) => void;
}): Promise<void> {
  const chatId = 'oc_workload_serial';
  const releaseFirst = createDeferred();
  let firstStarted = false;
  let secondStarted = false;

  options.setSendMessageImpl((async (activeChatId: string, text: string, sendOptions?: any) => {
    options.sentPrompts.push({ chatId: activeChatId, text });
    if (text === '第一条') {
      sendOptions?.onActivity?.({
        phase: 'turn_running',
        reason: 'serial first running',
        method: 'turn/progress',
        turnId: 'turn-serial-first',
      });
      firstStarted = true;
      await releaseFirst.promise;
      return;
    }

    if (text === '第二条') {
      secondStarted = true;
    }
  }) as SendMessage);

  await handleMessage(createTextEvent('om_workload_serial_1', chatId, '第一条') as never);
  await waitFor(() => firstStarted, 'first serial workload start');

  await handleMessage(createTextEvent('om_workload_serial_2', chatId, '第二条') as never);
  await delay(50);

  assert.equal(secondStarted, false, 'same chat workload should stay serial while first task is running');

  await handleMessage(createTextEvent('om_workload_serial_stat', chatId, '/stat') as never);
  assert.match(options.textMessages.at(-1) ?? '', /当前任务:/, '/stat should include active task status');
  assert.match(options.textMessages.at(-1) ?? '', /serial first running/);
  assert.match(options.textMessages.at(-1) ?? '', /当前排队: 1 条/);

  releaseFirst.resolve();
  await waitFor(() => secondStarted, 'second serial workload start');
}

async function runResetClearsQueuedTest(options: {
  sentPrompts: Array<{ chatId: string; text: string }>;
  textMessages: string[];
  removedReactions: string[];
  setSendMessageImpl: (impl: SendMessage) => void;
}): Promise<void> {
  const chatId = 'oc_workload_reset';
  const releaseFirst = createDeferred();
  let firstStarted = false;

  options.setSendMessageImpl((async (activeChatId: string, text: string) => {
    options.sentPrompts.push({ chatId: activeChatId, text });
    if (text === '重置前长任务') {
      firstStarted = true;
      await releaseFirst.promise;
    }
  }) as SendMessage);

  await handleMessage(createTextEvent('om_workload_reset_1', chatId, '重置前长任务') as never);
  await waitFor(() => firstStarted, 'reset long workload start');
  await handleMessage(createTextEvent('om_workload_reset_2', chatId, '这条应被清掉') as never);
  await handleMessage(createTextEvent('om_workload_reset_new', chatId, '/new') as never);

  assert.match(options.textMessages.at(-1) ?? '', /已清空 1 条排队消息/);

  releaseFirst.resolve();
  await waitFor(
    () => options.removedReactions.includes('reaction-om_workload_reset_1'),
    'reset long workload cleanup',
  );
  await delay(50);

  assert.equal(
    options.sentPrompts.some(item => item.chatId === chatId && item.text === '这条应被清掉'),
    false,
    '/new should clear queued workload that has not started',
  );
}

async function runFailureCleanupTest(options: {
  sentPrompts: Array<{ chatId: string; text: string }>;
  textMessages: string[];
  setSendMessageImpl: (impl: SendMessage) => void;
}): Promise<void> {
  const chatId = 'oc_workload_failure';
  let recoveryStarted = false;

  options.setSendMessageImpl((async (activeChatId: string, text: string, sendOptions?: any) => {
    options.sentPrompts.push({ chatId: activeChatId, text });
    if (text === '会失败') {
      sendOptions?.onActivity?.({
        phase: 'turn_running',
        reason: 'failure before cleanup',
        method: 'turn/progress',
        turnId: 'turn-failure',
      });
      throw new Error('synthetic workload failure');
    }

    if (text === '失败后继续') {
      recoveryStarted = true;
    }
  }) as SendMessage);

  await handleMessage(createTextEvent('om_workload_failure_1', chatId, '会失败') as never);
  await handleMessage(createTextEvent('om_workload_failure_2', chatId, '失败后继续') as never);
  await waitFor(() => recoveryStarted, 'queued workload after failure');

  await handleMessage(createTextEvent('om_workload_failure_stat', chatId, '/stat') as never);
  assert.doesNotMatch(
    options.textMessages.at(-1) ?? '',
    /当前任务:/,
    'active progress should be cleared after a workload failure',
  );
}

async function runCrossChatIsolationTest(options: {
  sentPrompts: Array<{ chatId: string; text: string }>;
  setSendMessageImpl: (impl: SendMessage) => void;
}): Promise<void> {
  const chatA = 'oc_workload_cross_a';
  const chatB = 'oc_workload_cross_b';
  const releaseA = createDeferred();
  let chatAStarted = false;
  let chatBStarted = false;

  options.setSendMessageImpl((async (activeChatId: string, text: string) => {
    options.sentPrompts.push({ chatId: activeChatId, text });
    if (activeChatId === chatA) {
      chatAStarted = true;
      await releaseA.promise;
      return;
    }

    if (activeChatId === chatB) {
      chatBStarted = true;
    }
  }) as SendMessage);

  await handleMessage(createTextEvent('om_workload_cross_a_1', chatA, 'A 长任务') as never);
  await waitFor(() => chatAStarted, 'cross chat A start');
  await handleMessage(createTextEvent('om_workload_cross_b_1', chatB, 'B 不应被 A 阻塞') as never);

  await waitFor(() => chatBStarted, 'cross chat B start');
  releaseA.resolve();
}

async function runStopDrainTest(options: {
  sentPrompts: Array<{ chatId: string; text: string }>;
  setSendMessageImpl: (impl: SendMessage) => void;
}): Promise<void> {
  const chatId = 'oc_workload_stop';
  const releaseStopTask = createDeferred();
  let stopTaskStarted = false;
  let stopCompleted = false;

  options.setSendMessageImpl((async (activeChatId: string, text: string) => {
    options.sentPrompts.push({ chatId: activeChatId, text });
    if (text === '停止前任务') {
      stopTaskStarted = true;
      await releaseStopTask.promise;
    }
  }) as SendMessage);

  await handleMessage(createTextEvent('om_workload_stop_1', chatId, '停止前任务') as never);
  await waitFor(() => stopTaskStarted, 'stop drain workload start');

  const stopPromise = stopMessageHandling().then(() => {
    stopCompleted = true;
  });
  await delay(50);
  assert.equal(stopCompleted, false, 'stop should wait for the active workload to finish');

  await handleMessage(createTextEvent('om_workload_stop_dropped', chatId, '停止后应丢弃') as never);
  releaseStopTask.resolve();
  await stopPromise;
  await delay(50);

  assert.equal(
    options.sentPrompts.some(item => item.chatId === chatId && item.text === '停止后应丢弃'),
    false,
    'handler should drop new messages after stop begins',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
