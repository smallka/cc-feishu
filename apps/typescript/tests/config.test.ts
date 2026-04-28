import assert from 'assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

type ConfigModule = typeof import('../src/config');

const sandboxRoot = mkdtempSync(path.join(tmpdir(), 'cc-feishu-config-'));
const originalCwd = process.cwd();

function loadConfig(): ConfigModule['default'] {
  const modulePath = require.resolve('../src/config');
  delete require.cache[modulePath];
  return (require('../src/config') as ConfigModule).default;
}

function withEnv(env: Record<string, string | undefined>, run: () => void): void {
  const previousValues = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(env)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const [key, value] of previousValues.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function main(): Promise<void> {
  try {
    withEnv({
      FEISHU_APP_ID: 'test-app-id',
      FEISHU_APP_SECRET: 'test-app-secret',
      FEISHU_ALLOWED_OPEN_IDS: 'ou_admin',
    }, () => {
      withEnv({
        AGENT_WORK_ROOT: 'C:\\work\\preferred-root',
        CLAUDE_WORK_ROOT: 'C:\\work\\legacy-root',
        CHAT_BINDINGS_FILE: undefined,
      }, () => {
        const config = loadConfig();
        assert.equal((config as any).agent.workRoot, 'C:\\work\\preferred-root');
      });

      withEnv({
        AGENT_WORK_ROOT: '',
        CLAUDE_WORK_ROOT: 'C:\\work\\legacy-root',
        CHAT_BINDINGS_FILE: undefined,
      }, () => {
        const config = loadConfig();
        assert.equal((config as any).agent.workRoot, 'C:\\work\\legacy-root');
      });

      process.chdir(sandboxRoot);
      withEnv({
        AGENT_WORK_ROOT: '',
        CLAUDE_WORK_ROOT: '',
        CHAT_BINDINGS_FILE: 'data/chat-bindings.json',
      }, () => {
        const config = loadConfig();
        assert.equal((config as any).agent.workRoot, sandboxRoot);
        assert.equal(
          config.storage.chatBindingsFile,
          path.resolve(sandboxRoot, 'data/chat-bindings.json'),
        );
      });
    });

    console.log('config.test.ts passed');
  } finally {
    process.chdir(originalCwd);
    rmSync(sandboxRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
