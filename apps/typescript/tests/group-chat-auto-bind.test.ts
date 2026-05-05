import assert from 'assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin,ou_ops';

const sandboxRoot = mkdtempSync(path.join(tmpdir(), 'cc-feishu-group-autobind-'));
process.env.AGENT_WORK_ROOT = sandboxRoot;

const config = (require('../src/config') as typeof import('../src/config')).default;
const { handleMessage } = require('../src/handlers/message.handler') as typeof import('../src/handlers/message.handler');
const { chatBindingStore } = require('../src/bot/chat-binding-store') as typeof import('../src/bot/chat-binding-store');
const { chatManager } = require('../src/bot/chat-manager') as typeof import('../src/bot/chat-manager');
const chatService = (require('../src/services/chat.service') as typeof import('../src/services/chat.service')).default;
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

function waitForSignal(label: string): { promise: Promise<void>; resolve: () => void } {
  let resolveSignal: (() => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, 5_000);
    resolveSignal = () => {
      clearTimeout(timer);
      resolve();
    };
  });

  return {
    promise,
    resolve: () => resolveSignal?.(),
  };
}

async function main(): Promise<void> {
  const originalWorkRoot = config.agent.workRoot;
  const originalBindingGet = chatBindingStore.get.bind(chatBindingStore);
  const originalBindingSet = chatBindingStore.set.bind(chatBindingStore);
  const originalSendMessage = chatManager.sendMessage.bind(chatManager);
  const originalGetChatName = chatService.getChatName.bind(chatService);
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);
  const originalAddReaction = messageService.addReaction.bind(messageService);
  const originalRemoveReaction = messageService.removeReaction.bind(messageService);

  const bindings = new Map<string, { cwd: string; updatedAt: string }>();
  const bindingChecks = new Map<string, { existedAtBind: boolean; isDirectoryAtBind: boolean }>();
  const textMessages = new Map<string, string[]>();
  const sendCalls: Array<{ chatId: string; text: string }> = [];

  try {
    config.agent.workRoot = sandboxRoot;

    const existingTarget = path.resolve(sandboxRoot, 'repo-alpha');
    mkdirSync(existingTarget, { recursive: true });

    chatBindingStore.get = ((chatId: string) => {
      return bindings.get(chatId) ?? null;
    }) as typeof chatBindingStore.get;

    chatBindingStore.set = ((chatId: string, cwd: string) => {
      const binding = {
        cwd,
        updatedAt: '2026-05-05T00:00:00.000Z',
      };
      bindingChecks.set(chatId, {
        existedAtBind: existsSync(cwd),
        isDirectoryAtBind: existsSync(cwd) && statSync(cwd).isDirectory(),
      });
      bindings.set(chatId, binding);
      return binding;
    }) as typeof chatBindingStore.set;

    chatService.getChatName = (async (chatId: string) => {
      switch (chatId) {
        case 'oc_group_existing':
          return 'repo-alpha';
        case 'oc_group_new':
          return 'repo/beta?.';
        case 'oc_group_invalid':
          return '..';
        default:
          return null;
      }
    }) as typeof chatService.getChatName;

    messageService.addReaction = (async () => null) as typeof messageService.addReaction;
    messageService.removeReaction = (async () => {}) as typeof messageService.removeReaction;
    messageService.sendTextMessage = (async (chatId: string, text: string) => {
      const messages = textMessages.get(chatId) ?? [];
      messages.push(text);
      textMessages.set(chatId, messages);
    }) as typeof messageService.sendTextMessage;

    let existingResolve: (() => void) | null = null;
    const existingObserved = new Promise<void>((resolve) => {
      existingResolve = resolve;
    });
    chatManager.sendMessage = (async (chatId: string, text: string) => {
      sendCalls.push({ chatId, text });
      if (chatId === 'oc_group_existing') {
        existingResolve?.();
      }
    }) as typeof chatManager.sendMessage;

    await handleMessage(createTextEvent('om_group_existing', 'oc_group_existing', '继续实现') as never);
    await existingObserved;

    assert.deepEqual(sendCalls.find(call => call.chatId === 'oc_group_existing'), {
      chatId: 'oc_group_existing',
      text: '继续实现',
    });
    assert.equal(bindings.get('oc_group_existing')?.cwd, existingTarget);
    assert.deepEqual(bindingChecks.get('oc_group_existing'), {
      existedAtBind: true,
      isDirectoryAtBind: true,
    });
    assert.match((textMessages.get('oc_group_existing') ?? []).join('\n'), /检测到同名目录已存在，已直接绑定/);

    const newTarget = path.resolve(sandboxRoot, 'repo beta');
    const newObserved = waitForSignal('new group auto-bind');
    chatManager.sendMessage = (async (chatId: string, text: string) => {
      sendCalls.push({ chatId, text });
      if (chatId === 'oc_group_new') {
        newObserved.resolve();
      }
    }) as typeof chatManager.sendMessage;

    await handleMessage(createTextEvent('om_group_new', 'oc_group_new', '继续实现') as never);
    await newObserved.promise;

    assert.equal(existsSync(newTarget), true, 'missing group directory should be created automatically');
    assert.deepEqual(sendCalls.find(call => call.chatId === 'oc_group_new'), {
      chatId: 'oc_group_new',
      text: '继续实现',
    });
    assert.equal(bindings.get('oc_group_new')?.cwd, newTarget);
    assert.deepEqual(bindingChecks.get('oc_group_new'), {
      existedAtBind: true,
      isDirectoryAtBind: true,
    }, 'binding should happen only after the directory exists');
    assert.match((textMessages.get('oc_group_new') ?? []).join('\n'), /已根据群名自动创建并绑定工作目录/);
    assert.match((textMessages.get('oc_group_new') ?? []).join('\n'), /群名已按 Windows 目录规则规范化为: repo beta/);

    let invalidSendCalled = false;
    const invalidObserved = waitForSignal('invalid group warning');
    chatManager.sendMessage = (async (chatId: string, text: string) => {
      sendCalls.push({ chatId, text });
      if (chatId === 'oc_group_invalid') {
        invalidSendCalled = true;
      }
    }) as typeof chatManager.sendMessage;
    messageService.sendTextMessage = (async (chatId: string, text: string) => {
      const messages = textMessages.get(chatId) ?? [];
      messages.push(text);
      textMessages.set(chatId, messages);
      if (chatId === 'oc_group_invalid') {
        invalidObserved.resolve();
      }
    }) as typeof messageService.sendTextMessage;

    await handleMessage(createTextEvent('om_group_invalid', 'oc_group_invalid', '继续实现') as never);
    await invalidObserved.promise;

    assert.equal(invalidSendCalled, false, 'invalid normalized group name should not continue into the agent');
    assert.equal(bindings.has('oc_group_invalid'), false, 'invalid normalized group name should not create a binding');
    assert.match((textMessages.get('oc_group_invalid') ?? []).join('\n'), /请使用 \/cd <路径> 手动绑定/);

    console.log('group-chat-auto-bind.test.ts passed');
  } finally {
    config.agent.workRoot = originalWorkRoot;
    chatBindingStore.get = originalBindingGet as typeof chatBindingStore.get;
    chatBindingStore.set = originalBindingSet as typeof chatBindingStore.set;
    chatManager.sendMessage = originalSendMessage as typeof chatManager.sendMessage;
    chatService.getChatName = originalGetChatName as typeof chatService.getChatName;
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
    messageService.addReaction = originalAddReaction as typeof messageService.addReaction;
    messageService.removeReaction = originalRemoveReaction as typeof messageService.removeReaction;
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
