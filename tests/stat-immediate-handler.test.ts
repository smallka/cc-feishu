import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin,ou_ops';

const { handleMessage } = require('../src/handlers/message.handler') as typeof import('../src/handlers/message.handler');
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

function createTextEvent(messageId: string, text: string): MessageEvent {
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
      chat_id: 'oc_stat_immediate',
      chat_type: 'p2p',
    },
  };
}

async function main(): Promise<void> {
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);
  const originalAddReaction = messageService.addReaction.bind(messageService);
  const originalRemoveReaction = messageService.removeReaction.bind(messageService);
  const originalSendMessage = chatManager.sendMessage.bind(chatManager);
  const originalGetSessionInfo = chatManager.getSessionInfo.bind(chatManager);

  let releaseRunningMessage: (() => void) | null = null;
  const releaseMessage = () => {
    if (releaseRunningMessage) {
      releaseRunningMessage();
      releaseRunningMessage = null;
    }
  };
  const runningMessageStarted = new Promise<void>((resolve) => {
    chatManager.sendMessage = (async (_chatId: string, _text: string, options?: any) => {
      options?.onActivity?.({
        phase: 'turn_running',
        reason: 'synthetic long task',
        method: 'turn/progress',
        turnId: 'turn-stat-immediate',
      });
      resolve();
      await new Promise<void>((release) => {
        releaseRunningMessage = release;
      });
    }) as typeof chatManager.sendMessage;
  });

  try {
    const textMessages: string[] = [];
    const removedReactions: string[] = [];

    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      textMessages.push(text);
    }) as typeof messageService.sendTextMessage;
    messageService.addReaction = (async () => 'reaction-stat-immediate') as typeof messageService.addReaction;
    messageService.removeReaction = (async (_messageId: string, reactionId: string) => {
      removedReactions.push(reactionId);
    }) as typeof messageService.removeReaction;
    chatManager.getSessionInfo = (() => '当前没有活跃会话\nProvider: codex\n工作目录: C:\\work') as typeof chatManager.getSessionInfo;

    await handleMessage(createTextEvent('om_stat_immediate_long', '继续实现') as never);
    await runningMessageStarted;

    await handleMessage(createTextEvent('om_stat_immediate_status', '/stat') as never);

    assert.equal(textMessages.length, 1, '/stat should reply while the previous message is still running');
    assert.match(textMessages[0], /当前没有活跃会话/);
    assert.match(textMessages[0], /当前任务:/);
    assert.match(textMessages[0], /状态: 运行中/);
    assert.match(textMessages[0], /synthetic long task/);
    assert.deepEqual(removedReactions, [], 'running task should not have completed before /stat replies');

    releaseMessage();
    await waitFor(() => removedReactions.length === 1, 'running message cleanup');

    console.log('stat-immediate-handler.test.ts passed');
  } finally {
    releaseMessage();
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
    messageService.addReaction = originalAddReaction as typeof messageService.addReaction;
    messageService.removeReaction = originalRemoveReaction as typeof messageService.removeReaction;
    chatManager.sendMessage = originalSendMessage as typeof chatManager.sendMessage;
    chatManager.getSessionInfo = originalGetSessionInfo as typeof chatManager.getSessionInfo;
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`${label} was not observed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
