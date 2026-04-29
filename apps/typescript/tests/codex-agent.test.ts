import assert from 'node:assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

const sessionModulePath = require.resolve('../src/codex-minimal/session');
const launchModulePath = require.resolve('../src/codex/launch');
const agentModulePath = require.resolve('../src/codex/agent');

class FakeCodexMinimalSession {
  static instances: FakeCodexMinimalSession[] = [];

  readonly options: Record<string, unknown>;
  running = false;
  interruptCalls = 0;
  destroyCalls = 0;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeCodexMinimalSession.instances.push(this);
  }

  async sendMessage(): Promise<{ text: string; threadId: string | null }> {
    return {
      text: '',
      threadId: null,
    };
  }

  interrupt(): boolean {
    this.interruptCalls += 1;
    return true;
  }

  isRunning(): boolean {
    return this.running;
  }

  async destroy(): Promise<void> {
    this.destroyCalls += 1;
  }

  getThreadId(): string {
    return 'thread-1';
  }
}

function loadCodexAgentModule() {
  const sessionModule = require(sessionModulePath) as typeof import('../src/codex-minimal/session');
  const launchModule = require(launchModulePath) as typeof import('../src/codex/launch');
  const originalSessionClass = sessionModule.CodexMinimalSession;
  const originalResolveLaunchOverrides = launchModule.resolveLegacyCodexLaunchOverrides;

  (sessionModule as any).CodexMinimalSession = FakeCodexMinimalSession;
  (launchModule as any).resolveLegacyCodexLaunchOverrides = () => ({});
  delete require.cache[agentModulePath];

  return {
    module: require(agentModulePath) as typeof import('../src/codex/agent'),
    restore(): void {
      (sessionModule as any).CodexMinimalSession = originalSessionClass;
      (launchModule as any).resolveLegacyCodexLaunchOverrides = originalResolveLaunchOverrides;
      delete require.cache[agentModulePath];
    },
  };
}

async function main(): Promise<void> {
  const loaded = loadCodexAgentModule();

  try {
    FakeCodexMinimalSession.instances.length = 0;
    const { CodexAgent } = loaded.module;
    const agent = new CodexAgent('oc_test', 'C:\\work\\repo-alpha', 'resume-session-id');

    assert.equal(FakeCodexMinimalSession.instances.length, 1);
    const session = FakeCodexMinimalSession.instances[0];
    assert.equal(Object.prototype.hasOwnProperty.call(session.options, 'resumeSessionId'), false);

    session.running = true;
    await agent.destroy();

    assert.equal(session.destroyCalls, 1);
  } finally {
    loaded.restore();
  }

  console.log('codex-agent.test.ts passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
