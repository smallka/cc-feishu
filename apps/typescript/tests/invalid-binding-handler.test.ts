import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin,ou_ops';

const { handleMessage } = require('../src/handlers/message.handler') as typeof import('../src/handlers/message.handler');
const { chatBindingStore } = require('../src/bot/chat-binding-store') as typeof import('../src/bot/chat-binding-store');
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
      chat_id: 'oc_invalid_binding',
    },
  };
}

async function main(): Promise<void> {
  const originalBindingGet = chatBindingStore.get.bind(chatBindingStore);
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);
  const originalInterrupt = chatManager.interrupt.bind(chatManager);
  const originalReset = chatManager.reset.bind(chatManager);
  const originalGetSessionInfo = chatManager.getSessionInfo.bind(chatManager);

  try {
    chatBindingStore.get = ((chatId: string) => {
      if (chatId === 'oc_invalid_binding') {
        return {
          cwd: 'C:\\work\\missing-repo',
          updatedAt: '2026-04-28T00:00:00.000Z',
        };
      }
      return originalBindingGet(chatId);
    }) as typeof chatBindingStore.get;

    let statText = '';
    let sessionInfoCalled = false;
    const statDelivered = new Promise<void>((resolve) => {
      messageService.sendTextMessage = (async (_chatId: string, text: string) => {
        statText = text;
        resolve();
      }) as typeof messageService.sendTextMessage;
    });
    chatManager.getSessionInfo = ((chatId: string) => {
      sessionInfoCalled = true;
      return originalGetSessionInfo(chatId);
    }) as typeof chatManager.getSessionInfo;

    await handleMessage(createTextEvent('om_invalid_stat', '/stat') as never);
    await statDelivered;

    assert.equal(statText, '当前群绑定目录不存在: C:\\work\\missing-repo\n请重新使用 /cd <路径> 绑定。');
    assert.equal(sessionInfoCalled, false, '/stat should not show stale session info for an invalid binding');

    let newText = '';
    let interruptCalled = false;
    let resetCalled = false;
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      newText = text;
    }) as typeof messageService.sendTextMessage;
    chatManager.interrupt = (async () => {
      interruptCalled = true;
      return 'no_session';
    }) as typeof chatManager.interrupt;
    chatManager.reset = (async () => {
      resetCalled = true;
      return 'C:\\work\\missing-repo';
    }) as typeof chatManager.reset;

    await handleMessage(createTextEvent('om_invalid_new', '/new') as never);

    assert.equal(newText, '会话已重置。\n当前群绑定目录不存在: C:\\work\\missing-repo\n请重新使用 /cd <路径> 绑定。');
    assert.equal(interruptCalled, true, '/new should still interrupt the current session');
    assert.equal(resetCalled, true, '/new should still clear the current session state');

    console.log('invalid-binding-handler.test.ts passed');
  } finally {
    chatBindingStore.get = originalBindingGet as typeof chatBindingStore.get;
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
    chatManager.interrupt = originalInterrupt as typeof chatManager.interrupt;
    chatManager.reset = originalReset as typeof chatManager.reset;
    chatManager.getSessionInfo = originalGetSessionInfo as typeof chatManager.getSessionInfo;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
