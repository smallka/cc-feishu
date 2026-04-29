import assert from 'node:assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

import type { CreateAgentOptions } from '../src/agent/factory';

const {
  ChatManager,
} = require('../src/bot/chat-manager') as typeof import('../src/bot/chat-manager');

function createFakeAgent() {
  return {
    sendMessage: async () => undefined,
    interrupt: () => false,
    destroy: async () => undefined,
    getAgentId: () => 'fake-agent',
    getCwd: () => 'C:\\work\\repo-alpha',
    getSessionId: () => undefined,
    isInitialized: () => false,
    isAlive: () => true,
    onResponse: () => undefined,
    onError: () => undefined,
    getStartTime: () => Date.now(),
  };
}

async function main(): Promise<void> {
  {
    const manager = new ChatManager({
      defaultCwd: 'C:\\work',
      defaultProvider: 'codex',
      agentFactory: () => createFakeAgent() as any,
    });

    assert.equal(manager.supportsSessionResume('oc_codex'), false);
    assert.match(manager.listSessions('oc_codex'), /当前 provider 暂不支持 \/resume/);
    assert.deepEqual(manager.getRecentSessions('oc_codex'), []);
    assert.equal(manager.getSessionCount('oc_codex'), 0);
  }

  {
    const capturedOptions: CreateAgentOptions[] = [];
    const manager = new ChatManager({
      defaultCwd: 'C:\\work',
      defaultProvider: 'codex',
      agentFactory: (options) => {
        capturedOptions.push(options);
        return createFakeAgent() as any;
      },
    });

    (manager as any).chats.set('oc_codex', {
      cwd: 'C:\\work\\repo-alpha',
      provider: 'codex',
      sessionId: 'codex-resume-id',
      sessionNotified: false,
    });

    await manager.sendMessage('oc_codex', 'hello codex');
    assert.equal(capturedOptions.length, 1);
    assert.equal(capturedOptions[0].provider, 'codex');
    assert.equal(capturedOptions[0].resumeSessionId, undefined);
  }

  {
    const capturedOptions: CreateAgentOptions[] = [];
    const manager = new ChatManager({
      defaultCwd: 'C:\\work',
      defaultProvider: 'claude',
      agentFactory: (options) => {
        capturedOptions.push(options);
        return createFakeAgent() as any;
      },
    });

    (manager as any).chats.set('oc_claude', {
      cwd: 'C:\\work\\repo-beta',
      provider: 'claude',
      sessionId: 'claude-resume-id',
      sessionNotified: false,
    });

    await manager.sendMessage('oc_claude', 'hello claude');
    assert.equal(capturedOptions.length, 1);
    assert.equal(capturedOptions[0].provider, 'claude');
    assert.equal(capturedOptions[0].resumeSessionId, 'claude-resume-id');
  }

  console.log('codex-resume-disabled.test.ts passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
