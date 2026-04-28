import assert from 'assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin,ou_ops';

const sandboxRoot = mkdtempSync(join(tmpdir(), 'cc-feishu-chat-binding-'));
const bindingsFile = join(sandboxRoot, 'data', 'chat-bindings.json');

const {
  ChatBindingStore,
} = require('../src/bot/chat-binding-store') as typeof import('../src/bot/chat-binding-store');
const {
  resolveChatAccess,
} = require('../src/bot/chat-access') as typeof import('../src/bot/chat-access');
const {
  ChatManager,
} = require('../src/bot/chat-manager') as typeof import('../src/bot/chat-manager');

async function main(): Promise<void> {
  try {
    const store = new ChatBindingStore(bindingsFile);
    assert.equal(store.get('oc_unbound'), null, 'new store should start empty');

    const savedBinding = store.set('oc_bound', 'C:\\work\\repo-alpha');
    assert.equal(savedBinding.cwd, 'C:\\work\\repo-alpha');
    assert.ok(savedBinding.updatedAt, 'binding should capture updated timestamp');

    const reloadedStore = new ChatBindingStore(bindingsFile);
    assert.deepEqual(reloadedStore.get('oc_bound'), savedBinding, 'binding should survive store reload');

    assert.deepEqual(resolveChatAccess({
      text: '继续实现',
      senderOpenId: 'ou_admin',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: null,
    }), {
      kind: 'unbound',
    });

    assert.deepEqual(resolveChatAccess({
      text: '/cd repo-alpha',
      senderOpenId: 'ou_admin',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: null,
    }), {
      kind: 'allowed',
    });

    assert.deepEqual(resolveChatAccess({
      text: '/help',
      senderOpenId: 'ou_admin',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: null,
    }), {
      kind: 'allowed',
    });

    assert.deepEqual(resolveChatAccess({
      text: '/resume',
      senderOpenId: 'ou_admin',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: null,
    }), {
      kind: 'allowed',
    });

    assert.deepEqual(resolveChatAccess({
      text: '1',
      senderOpenId: 'ou_admin',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: null,
      hasActiveMenuSelection: true,
    }), {
      kind: 'allowed',
    });

    assert.deepEqual(resolveChatAccess({
      text: '1',
      senderOpenId: 'ou_admin',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: null,
      hasActiveMenuSelection: false,
    }), {
      kind: 'unbound',
    });

    assert.deepEqual(resolveChatAccess({
      text: '继续实现',
      senderOpenId: 'ou_admin',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: savedBinding,
      bindingValid: false,
    }), {
      kind: 'invalid_binding',
    });

    assert.deepEqual(resolveChatAccess({
      text: '/cd',
      senderOpenId: 'ou_admin',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: savedBinding,
      bindingValid: false,
    }), {
      kind: 'allowed',
    });

    assert.deepEqual(resolveChatAccess({
      text: '1',
      senderOpenId: 'ou_admin',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: savedBinding,
      bindingValid: false,
      hasActiveMenuSelection: true,
    }), {
      kind: 'allowed',
    });

    assert.deepEqual(resolveChatAccess({
      text: '继续实现',
      senderOpenId: 'ou_guest',
      allowedOpenIds: ['ou_admin', 'ou_ops'],
      binding: savedBinding,
    }), {
      kind: 'unauthorized',
    });

    const manager = new ChatManager({
      bindingStore: reloadedStore,
      defaultCwd: 'C:\\work',
      defaultProvider: 'codex',
    });

    assert.equal(manager.getCurrentCwd('oc_bound'), 'C:\\work\\repo-alpha');
    assert.equal(manager.getCurrentCwd('oc_unknown'), 'C:\\work');

    await manager.switchCwd('oc_bound', 'C:\\work\\repo-beta');
    assert.equal(reloadedStore.get('oc_bound')?.cwd, 'C:\\work\\repo-beta');

    const restartedManager = new ChatManager({
      bindingStore: new ChatBindingStore(bindingsFile),
      defaultCwd: 'C:\\work',
      defaultProvider: 'codex',
    });
    assert.equal(restartedManager.getCurrentCwd('oc_bound'), 'C:\\work\\repo-beta');

    await restartedManager.reset('oc_bound');
    assert.equal(new ChatBindingStore(bindingsFile).get('oc_bound')?.cwd, 'C:\\work\\repo-beta');

    console.log('chat-binding.test.ts passed');
  } finally {
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
