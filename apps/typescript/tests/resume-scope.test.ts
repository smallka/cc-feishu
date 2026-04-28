import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function writeSession(
  sessionsDir: string,
  datePath: string,
  cwd: string,
  sessionId: string,
  firstMessage: string,
  mtimeMs: number,
): void {
  const targetDir = join(sessionsDir, datePath);
  mkdirSync(targetDir, { recursive: true });

  const filePath = join(targetDir, `rollout-${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      timestamp: new Date(mtimeMs).toISOString(),
      type: 'session_meta',
      payload: {
        id: sessionId,
        cwd,
      },
    }),
    JSON.stringify({
      timestamp: new Date(mtimeMs + 1).toISOString(),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: firstMessage,
          },
        ],
      },
    }),
  ];

  writeFileSync(filePath, `${lines.join('\n')}\n`);
  const timestamp = new Date(mtimeMs);
  utimesSync(filePath, timestamp, timestamp);
}

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

const sandboxRoot = mkdtempSync(join(tmpdir(), 'cc-feishu-resume-scope-'));
const sessionsDir = join(sandboxRoot, '.codex', 'sessions');
const bindingsFile = join(sandboxRoot, 'data', 'chat-bindings.json');
const currentCwd = 'C:\\work\\repo-alpha';
const siblingCwd = 'C:\\work\\repo-beta';
const defaultCwd = 'C:\\work';
const os = require('os') as typeof import('os') & { homedir: () => string };
const originalHomedir = os.homedir;

mkdirSync(sessionsDir, { recursive: true });
os.homedir = () => sandboxRoot;

const {
  ChatBindingStore,
} = require('../src/bot/chat-binding-store') as typeof import('../src/bot/chat-binding-store');
const {
  ChatManager,
} = require('../src/bot/chat-manager') as typeof import('../src/bot/chat-manager');

async function main(): Promise<void> {
  try {
    writeSession(
      sessionsDir,
      join('2026', '04', '28'),
      siblingCwd,
      'session-other',
      'other project session',
      Date.now() - 20_000,
    );
    writeSession(
      sessionsDir,
      join('2026', '04', '28'),
      currentCwd,
      'session-current',
      'current project session',
      Date.now() - 10_000,
    );

    const store = new ChatBindingStore(bindingsFile);
    store.set('oc_bound', currentCwd);

    const manager = new ChatManager({
      bindingStore: store,
      defaultCwd,
      defaultProvider: 'codex',
    });

    assert.deepEqual(manager.resolveResumeTargetBySessionId('oc_bound', 'session-current'), {
      sessionId: 'session-current',
      cwd: currentCwd,
    });
    assert.equal(
      manager.resolveResumeTargetBySessionId('oc_bound', 'session-other'),
      null,
      'resume by session_id should stay within the chat cwd scope',
    );

    console.log('resume-scope.test.ts passed');
  } finally {
    os.homedir = originalHomedir;
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
