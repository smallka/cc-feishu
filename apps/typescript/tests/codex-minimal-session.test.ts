import assert from 'node:assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

const {
  CodexMinimalSession,
  TurnAbortedError,
} = require('../src/codex-minimal/session') as typeof import('../src/codex-minimal/session');

async function captureError<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

async function main() {
  {
    const session = new CodexMinimalSession({
      workingDirectory: 'C:\\work\\cc-feishu',
    });
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];

    (session as any).threadId = 'thread-1';
    (session as any).activeTurnId = 'turn-1';
    (session as any).activeTurn = {
      interruptRequested: false,
    };
    (session as any).rpcClient = {
      request(method: string, params: Record<string, unknown>): Promise<Record<string, never>> {
        requests.push({ method, params });
        return Promise.resolve({});
      },
    };

    assert.equal(session.interrupt(), true);
    await Promise.resolve();
    assert.equal((session as any).activeTurn.interruptRequested, true);
    assert.deepEqual(requests, [
      {
        method: 'turn/interrupt',
        params: {
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
      },
    ]);
  }

  {
    const session = new CodexMinimalSession({
      workingDirectory: 'C:\\work\\cc-feishu',
    });
    const activeTurn = (session as any).createActiveTurn(undefined);

    activeTurn.turnId = 'turn-1';
    activeTurn.interruptRequested = true;
    (session as any).threadId = 'thread-1';
    (session as any).activeTurn = activeTurn;
    (session as any).rpcClient = {
      getTurnError(): null {
        return null;
      },
    };

    (session as any).handleAppServerLine(JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          id: 'turn-1',
          status: 'interrupted',
        },
      },
    }));

    const abortError = await captureError(activeTurn.promise);
    assert.ok(abortError instanceof TurnAbortedError);
  }

  {
    const session = new CodexMinimalSession({
      workingDirectory: 'C:\\work\\cc-feishu',
    });
    const activeTurn = (session as any).createActiveTurn(undefined);

    activeTurn.turnId = 'turn-2';
    activeTurn.interruptRequested = true;
    (session as any).threadId = 'thread-1';
    (session as any).activeTurn = activeTurn;
    (session as any).rpcClient = {
      getTurnError(): null {
        return null;
      },
    };

    (session as any).handleAppServerLine(JSON.stringify({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          id: 'turn-2',
          status: 'failed',
          error: {
            message: 'real failure',
          },
        },
      },
    }));

    const failureError = await captureError(activeTurn.promise);
    assert.ok(failureError instanceof Error);
    assert.equal((failureError as Error).message, 'real failure');
    assert.equal(failureError instanceof TurnAbortedError, false);
  }

  console.log('codex-minimal-session.test.ts passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
