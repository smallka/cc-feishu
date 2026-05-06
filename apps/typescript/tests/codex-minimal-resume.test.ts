import assert from 'node:assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

const processModulePath = require.resolve('../src/codex-minimal/app-server-process');
const rpcModulePath = require.resolve('../src/codex-minimal/app-server-rpc');
const sessionModulePath = require.resolve('../src/codex-minimal/session');

class FakeCodexAppServerProcess {
  static instances: FakeCodexAppServerProcess[] = [];

  readonly stdin = {
    write: () => undefined,
  };

  constructor(_options: Record<string, unknown>) {
    FakeCodexAppServerProcess.instances.push(this);
  }

  start(): void {}

  onLine(): () => void {
    return () => undefined;
  }

  onExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return Promise.resolve({ code: 0, signal: null });
  }

  async stop(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return { code: 0, signal: null };
  }

  getStderrTail(): string {
    return '';
  }
}

class FakeCodexAppServerRpcClient {
  static instances: FakeCodexAppServerRpcClient[] = [];

  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  readonly notifications: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private threadId: string | null = null;

  constructor(_options: Record<string, unknown>) {
    FakeCodexAppServerRpcClient.instances.push(this);
  }

  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.requests.push({ method, params });

    if (method === 'thread/start') {
      this.threadId = 'thread-started';
      return Promise.resolve({
        thread: {
          id: this.threadId,
        },
      });
    }

    if (method === 'thread/resume') {
      this.threadId = typeof params.threadId === 'string' ? params.threadId : 'thread-resumed';
      return Promise.resolve({
        thread: {
          id: this.threadId,
        },
      });
    }

    return Promise.resolve({});
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.notifications.push({ method, params });
  }

  handleLine(): void {}

  closeAllPending(): void {}

  getThreadId(): string | null {
    return this.threadId;
  }

  getTurnId(): string | null {
    return null;
  }

  getTurnError(): string | null {
    return null;
  }
}

function loadSessionModule() {
  const processModule = require(processModulePath) as typeof import('../src/codex-minimal/app-server-process');
  const rpcModule = require(rpcModulePath) as typeof import('../src/codex-minimal/app-server-rpc');
  const originalProcessClass = processModule.CodexAppServerProcess;
  const originalRpcClass = rpcModule.CodexAppServerRpcClient;

  (processModule as any).CodexAppServerProcess = FakeCodexAppServerProcess;
  (rpcModule as any).CodexAppServerRpcClient = FakeCodexAppServerRpcClient;
  delete require.cache[sessionModulePath];

  return {
    module: require(sessionModulePath) as typeof import('../src/codex-minimal/session'),
    restore(): void {
      (processModule as any).CodexAppServerProcess = originalProcessClass;
      (rpcModule as any).CodexAppServerRpcClient = originalRpcClass;
      delete require.cache[sessionModulePath];
    },
  };
}

async function main(): Promise<void> {
  const loaded = loadSessionModule();

  try {
    {
      FakeCodexAppServerProcess.instances.length = 0;
      FakeCodexAppServerRpcClient.instances.length = 0;

      const { CodexMinimalSession } = loaded.module;
      const session = new CodexMinimalSession({
        workingDirectory: 'C:\\work\\repo-alpha',
      });

      await (session as any).startOnce(1);

      assert.equal(FakeCodexAppServerRpcClient.instances.length, 1);
      const rpcClient = FakeCodexAppServerRpcClient.instances[0];
      assert.deepEqual(
        rpcClient.requests.map(request => request.method),
        ['initialize', 'thread/start'],
      );
      assert.equal(rpcClient.requests[1].params.cwd, 'C:\\work\\repo-alpha');
      assert.equal(rpcClient.requests[1].params.sandbox, 'danger-full-access');
      assert.equal('sandboxMode' in rpcClient.requests[1].params, false);
      assert.equal('skipGitRepoCheck' in rpcClient.requests[1].params, false);
      assert.equal('networkAccessEnabled' in rpcClient.requests[1].params, false);
      assert.equal((session as any).threadId, 'thread-started');
    }

    {
      FakeCodexAppServerProcess.instances.length = 0;
      FakeCodexAppServerRpcClient.instances.length = 0;

      const { CodexMinimalSession } = loaded.module;
      const session = new CodexMinimalSession({
        workingDirectory: 'C:\\work\\repo-alpha',
        resumeSessionId: 'resume-thread-id',
      });

      await (session as any).startOnce(1);

      assert.equal(FakeCodexAppServerRpcClient.instances.length, 1);
      const rpcClient = FakeCodexAppServerRpcClient.instances[0];
      assert.deepEqual(
        rpcClient.requests.map(request => request.method),
        ['initialize', 'thread/resume'],
      );
      assert.equal(rpcClient.requests[1].params.threadId, 'resume-thread-id');
      assert.equal(rpcClient.requests[1].params.cwd, 'C:\\work\\repo-alpha');
      assert.equal(rpcClient.requests[1].params.sandbox, 'danger-full-access');
      assert.equal('persistExtendedHistory' in rpcClient.requests[1].params, false);
      assert.equal((session as any).threadId, 'resume-thread-id');
    }
  } finally {
    loaded.restore();
  }

  console.log('codex-minimal-resume.test.ts passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
