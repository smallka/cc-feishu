import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin,ou_ops';

const { handleMessage } = require('../src/handlers/message.handler') as typeof import('../src/handlers/message.handler');
const { chatBindingStore } = require('../src/bot/chat-binding-store') as typeof import('../src/bot/chat-binding-store');
const { chatManager } = require('../src/bot/chat-manager') as typeof import('../src/bot/chat-manager');
const menuContext = (require('../src/bot/menu-context') as typeof import('../src/bot/menu-context')).default;
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
      chat_type: 'group_chat',
    },
  };
}

async function main(): Promise<void> {
  const chatId = 'oc_control_immediate';
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);
  const originalSendCardMessage = messageService.sendCardMessage.bind(messageService);
  const originalAddReaction = messageService.addReaction.bind(messageService);
  const originalRemoveReaction = messageService.removeReaction.bind(messageService);
  const originalSendMessage = chatManager.sendMessage.bind(chatManager);
  const originalSwitchCwd = chatManager.switchCwd.bind(chatManager);
  const originalSwitchProvider = chatManager.switchProvider.bind(chatManager);
  const originalGetSessionInfo = chatManager.getSessionInfo.bind(chatManager);
  const originalBindingGet = chatBindingStore.get.bind(chatBindingStore);

  try {
    const textMessages: string[] = [];
    const cardMessages: string[] = [];
    const sentPrompts: string[] = [];
    const switchedCwds: string[] = [];
    const switchedProviders: string[] = [];
    let resolveQueuedPrompt: (() => void) | null = null;
    const queuedPromptObserved = new Promise<void>((resolve) => {
      resolveQueuedPrompt = resolve;
    });

    chatBindingStore.get = ((bindingChatId: string) => {
      if (bindingChatId === chatId) {
        return {
          cwd: 'C:\\work\\cc-feishu',
          updatedAt: '2026-05-12T00:00:00.000Z',
        };
      }
      return originalBindingGet(bindingChatId);
    }) as typeof chatBindingStore.get;

    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      textMessages.push(text);
    }) as typeof messageService.sendTextMessage;
    messageService.sendCardMessage = (async (_chatId: string, markdown: string) => {
      cardMessages.push(markdown);
    }) as typeof messageService.sendCardMessage;
    messageService.addReaction = (async () => 'reaction-id') as typeof messageService.addReaction;
    messageService.removeReaction = (async () => {}) as typeof messageService.removeReaction;
    chatManager.sendMessage = (async (_chatId: string, text: string) => {
      sentPrompts.push(text);
      resolveQueuedPrompt?.();
    }) as typeof chatManager.sendMessage;
    chatManager.switchCwd = (async (_chatId: string, cwd: string) => {
      switchedCwds.push(cwd);
    }) as typeof chatManager.switchCwd;
    chatManager.switchProvider = (async (_chatId: string, provider: 'claude' | 'codex') => {
      switchedProviders.push(provider);
      return { changed: true, cwd: 'C:\\work' };
    }) as typeof chatManager.switchProvider;
    chatManager.getSessionInfo = (() => '当前没有活跃会话\nProvider: codex\n工作目录: C:\\work') as typeof chatManager.getSessionInfo;

    await handleMessage(createTextEvent('om_control_help', chatId, '/help') as never);
    assert.equal(sentPrompts.length, 0, '/help should not enter the agent queue');
    assert.match(textMessages.at(-1) ?? '', /可用命令/);

    await handleMessage(createTextEvent('om_control_agent', chatId, '/agent') as never);
    assert.equal(sentPrompts.length, 0, '/agent should not enter the agent queue');
    assert.match(cardMessages.at(-1) ?? '', /选择 Agent/);

    await handleMessage(createTextEvent('om_control_menu', chatId, '1') as never);
    assert.equal(menuContext.get(chatId), null);
    assert.deepEqual(switchedProviders, ['claude']);
    assert.equal(sentPrompts.length, 0, 'menu selection should not enter the agent queue');

    await handleMessage(createTextEvent('om_control_plain', chatId, '继续实现') as never);
    await queuedPromptObserved;
    assert.deepEqual(sentPrompts, ['继续实现']);

    console.log('control-routing-immediate.test.ts passed');
  } finally {
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
    messageService.sendCardMessage = originalSendCardMessage as typeof messageService.sendCardMessage;
    messageService.addReaction = originalAddReaction as typeof messageService.addReaction;
    messageService.removeReaction = originalRemoveReaction as typeof messageService.removeReaction;
    chatManager.sendMessage = originalSendMessage as typeof chatManager.sendMessage;
    chatManager.switchCwd = originalSwitchCwd as typeof chatManager.switchCwd;
    chatManager.switchProvider = originalSwitchProvider as typeof chatManager.switchProvider;
    chatManager.getSessionInfo = originalGetSessionInfo as typeof chatManager.getSessionInfo;
    chatBindingStore.get = originalBindingGet as typeof chatBindingStore.get;
    menuContext.clear(chatId);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
