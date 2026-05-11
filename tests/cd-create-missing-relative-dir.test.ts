import assert from 'assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin,ou_ops';

const sandboxRoot = mkdtempSync(path.join(tmpdir(), 'cc-feishu-cd-create-'));

const config = (require('../src/config') as typeof import('../src/config')).default;
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
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);
  const originalSendCardMessage = messageService.sendCardMessage.bind(messageService);
  const originalSwitchCwd = chatManager.switchCwd.bind(chatManager);
  const originalSupportsSessionResume = chatManager.supportsSessionResume.bind(chatManager);

  try {
    config.agent.workRoot = sandboxRoot;

    const switchedCwds: string[] = [];
    chatManager.switchCwd = (async (_chatId: string, cwd: string) => {
      switchedCwds.push(cwd);
    }) as typeof chatManager.switchCwd;
    chatManager.supportsSessionResume = (() => false) as typeof chatManager.supportsSessionResume;

    const singleLayerTarget = path.resolve(sandboxRoot, 'repo-alpha');
    let createPromptCard = '';
    let singleLayerText = '';
    const createPromptObserved = waitForSignal('create prompt card');
    messageService.sendCardMessage = (async (_chatId: string, markdown: string) => {
      createPromptCard = markdown;
      createPromptObserved.resolve();
    }) as typeof messageService.sendCardMessage;
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      singleLayerText = text;
    }) as typeof messageService.sendTextMessage;

    await handleMessage(createTextEvent('om_cd_create_prompt', 'oc_cd_create_prompt', '/cd repo-alpha') as never);
    await createPromptObserved.promise;

    assert.equal(singleLayerText, '', 'missing single-layer relative path should prompt instead of failing immediately');
    assert.equal(existsSync(singleLayerTarget), false, 'directory should not be created before confirmation');
    assert.deepEqual(switchedCwds, [], 'directory should not be switched before confirmation');
    assert.match(createPromptCard, /创建工作目录/);
    assert.match(createPromptCard, /repo-alpha/);
    assert.match(createPromptCard, /创建并切换到该目录/);

    let nestedPathText = '';
    let nestedCardSent = false;
    const nestedErrorObserved = waitForSignal('nested path error');
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      nestedPathText = text;
      nestedErrorObserved.resolve();
    }) as typeof messageService.sendTextMessage;
    messageService.sendCardMessage = (async () => {
      nestedCardSent = true;
    }) as typeof messageService.sendCardMessage;

    await handleMessage(createTextEvent('om_cd_nested_missing', 'oc_cd_nested_missing', '/cd nested/repo') as never);
    await nestedErrorObserved.promise;

    assert.equal(nestedPathText, '目录不存在: nested/repo');
    assert.equal(nestedCardSent, false, 'multi-segment relative path should not offer directory creation');

    let invalidNameText = '';
    let invalidNameCardSent = false;
    const invalidNameObserved = waitForSignal('invalid-name error');
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      invalidNameText = text;
      invalidNameObserved.resolve();
    }) as typeof messageService.sendTextMessage;
    messageService.sendCardMessage = (async () => {
      invalidNameCardSent = true;
    }) as typeof messageService.sendCardMessage;

    await handleMessage(createTextEvent('om_cd_invalid_name', 'oc_cd_invalid_name', '/cd bad:name') as never);
    await invalidNameObserved.promise;

    assert.equal(invalidNameText, '目录名不合法: bad:name');
    assert.equal(invalidNameCardSent, false, 'invalid directory name should not offer creation');

    const createAndBindTarget = path.resolve(sandboxRoot, 'repo-beta');
    let createAndBindPrompt = '';
    const createAndBindPromptObserved = waitForSignal('create-and-bind prompt');
    messageService.sendCardMessage = (async (_chatId: string, markdown: string) => {
      createAndBindPrompt = markdown;
      createAndBindPromptObserved.resolve();
    }) as typeof messageService.sendCardMessage;
    messageService.sendTextMessage = (async () => {}) as typeof messageService.sendTextMessage;
    switchedCwds.length = 0;

    await handleMessage(createTextEvent('om_cd_create_bind_prompt', 'oc_cd_create_bind', '/cd repo-beta') as never);
    await createAndBindPromptObserved.promise;
    assert.match(createAndBindPrompt, /repo-beta/);

    let createAndBindText = '';
    const createAndBindObserved = waitForSignal('create-and-bind confirmation');
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      createAndBindText = text;
      createAndBindObserved.resolve();
    }) as typeof messageService.sendTextMessage;
    messageService.sendCardMessage = (async () => {}) as typeof messageService.sendCardMessage;

    await handleMessage(createTextEvent('om_cd_create_bind_confirm', 'oc_cd_create_bind', '1') as never);
    await createAndBindObserved.promise;

    assert.equal(existsSync(createAndBindTarget), true, 'confirmed creation should create the directory');
    assert.deepEqual(switchedCwds, [createAndBindTarget], 'confirmed creation should bind the new directory');
    assert.equal(createAndBindText, `已切换工作目录: ${createAndBindTarget}`);

    console.log('cd-create-missing-relative-dir.test.ts passed');
  } finally {
    config.agent.workRoot = originalWorkRoot;
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
    messageService.sendCardMessage = originalSendCardMessage as typeof messageService.sendCardMessage;
    chatManager.switchCwd = originalSwitchCwd as typeof chatManager.switchCwd;
    chatManager.supportsSessionResume = originalSupportsSessionResume as typeof chatManager.supportsSessionResume;
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
