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
    chat_type: string;
  };
}

function createTextEvent(messageId: string, chatId: string, chatType: string, text: string): MessageEvent {
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
      chat_type: chatType,
    },
  };
}

async function main(): Promise<void> {
  const originalBindingGet = chatBindingStore.get.bind(chatBindingStore);
  const originalBindingSet = chatBindingStore.set.bind(chatBindingStore);
  const originalSendMessage = chatManager.sendMessage.bind(chatManager);
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);
  const originalAddReaction = messageService.addReaction.bind(messageService);
  const originalRemoveReaction = messageService.removeReaction.bind(messageService);

  try {
    let privateWarningText = '';
    let groupWarningText = '';
    let persistedBinding = false;
    let resolvePrivateOutcome: (() => void) | null = null;
    const privateOutcomeObserved = new Promise<void>((resolve) => {
      resolvePrivateOutcome = resolve;
    });

    chatBindingStore.get = ((chatId: string) => {
      if (chatId === 'oc_private_default' || chatId === 'oc_group_unbound') {
        return null;
      }
      return originalBindingGet(chatId);
    }) as typeof chatBindingStore.get;

    chatBindingStore.set = ((chatId: string, cwd: string) => {
      if (chatId === 'oc_private_default') {
        persistedBinding = true;
      }
      return originalBindingSet(chatId, cwd);
    }) as typeof chatBindingStore.set;

    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      privateWarningText = text;
      resolvePrivateOutcome?.();
    }) as typeof messageService.sendTextMessage;
    messageService.addReaction = (async () => null) as typeof messageService.addReaction;
    messageService.removeReaction = (async () => {}) as typeof messageService.removeReaction;

    let privateSendArgs: { chatId: string; text: string } | null = null;

    chatManager.sendMessage = (async (chatId: string, text: string) => {
      privateSendArgs = { chatId, text };
      resolvePrivateOutcome?.();
    }) as typeof chatManager.sendMessage;

    await handleMessage(createTextEvent(
      'om_private_default',
      'oc_private_default',
      'p2p_chat',
      '继续实现',
    ) as never);
    await privateOutcomeObserved;

    assert.deepEqual(privateSendArgs, {
      chatId: 'oc_private_default',
      text: '继续实现',
    });
    assert.equal(persistedBinding, false, 'private chat fallback should not persist a binding');
    assert.equal(privateWarningText, '', 'private chat fallback should not emit unbound warnings');

    let groupSendCalled = false;
    let resolveGroupText: (() => void) | null = null;
    const groupTextObserved = new Promise<void>((resolve) => {
      resolveGroupText = resolve;
    });

    chatManager.sendMessage = (async () => {
      groupSendCalled = true;
    }) as typeof chatManager.sendMessage;
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      groupWarningText = text;
      resolveGroupText?.();
    }) as typeof messageService.sendTextMessage;

    await handleMessage(createTextEvent(
      'om_group_unbound',
      'oc_group_unbound',
      'group_chat',
      '继续实现',
    ) as never);
    await groupTextObserved;

    assert.equal(groupSendCalled, false, 'group chat should still require explicit binding');
    assert.equal(
      groupWarningText,
      '当前群尚未绑定工作目录，请先使用 /cd <路径> 绑定。',
    );

    console.log('private-chat-default-cwd.test.ts passed');
  } finally {
    chatBindingStore.get = originalBindingGet as typeof chatBindingStore.get;
    chatBindingStore.set = originalBindingSet as typeof chatBindingStore.set;
    chatManager.sendMessage = originalSendMessage as typeof chatManager.sendMessage;
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
    messageService.addReaction = originalAddReaction as typeof messageService.addReaction;
    messageService.removeReaction = originalRemoveReaction as typeof messageService.removeReaction;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
