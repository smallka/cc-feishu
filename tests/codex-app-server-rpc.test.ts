import assert from 'node:assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

const {
  CodexAppServerRpcClient,
} = require('../src/codex-minimal/app-server-rpc') as typeof import('../src/codex-minimal/app-server-rpc');

type FakeWriter = {
  writes: string[];
  write: (chunk: string | Uint8Array) => boolean;
};

type JsonRpcEnvelope = {
  jsonrpc: '2.0';
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
};

const quietLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function createWriter(): FakeWriter {
  return {
    writes: [],
    write(chunk: string | Uint8Array): boolean {
      this.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    },
  };
}

function parseWrites(writer: FakeWriter): JsonRpcEnvelope[] {
  return writer.writes.map(line => JSON.parse(line.trim()) as JsonRpcEnvelope);
}

async function expectRejectsWithMethod(promise: Promise<unknown>, expectedMethod: string): Promise<void> {
  await assert.rejects(
    promise,
    (error: unknown) => error instanceof Error && error.message.includes(expectedMethod),
  );
}

async function main() {
  {
    const writer = createWriter();
    const client = new CodexAppServerRpcClient({ stdin: writer, logger: quietLogger as any });
    const pending = client.request('initialize', {
      clientInfo: { name: 'rpc-test', version: '1.0.0' },
    });

    client.handleLine('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
    assert.deepEqual(await pending, { ok: true });
  }

  {
    const writer = createWriter();
    const client = new CodexAppServerRpcClient({ stdin: writer, logger: quietLogger as any });
    const pending = client.request('thread/start', { cwd: 'C:\\work\\cc-feishu' });

    client.handleLine('{"jsonrpc":"2.0","id":1,"error":{"code":123,"message":"boom"}}');
    await expectRejectsWithMethod(pending, 'thread/start');
  }

  {
    const writer = createWriter();
    const client = new CodexAppServerRpcClient({ stdin: writer, logger: quietLogger as any });
    const startThread = client.request('thread/start', { cwd: 'C:\\work\\cc-feishu' });

    client.handleLine('{"jsonrpc":"2.0","id":1,"result":{"thread":{"id":"thread-1"}}}');
    assert.deepEqual(await startThread, { thread: { id: 'thread-1' } });
    assert.equal(client.getThreadId(), 'thread-1');

    client.handleLine('{"jsonrpc":"2.0","method":"turn/started","params":{"threadId":"thread-1","turn":{"id":"turn-1"}}}');
    assert.equal(client.getTurnId(), 'turn-1');
  }

  {
    const writer = createWriter();
    const client = new CodexAppServerRpcClient({ stdin: writer, logger: quietLogger as any });
    const startThread = client.request('thread/start', { cwd: 'C:\\work\\cc-feishu' });

    client.handleLine('{"jsonrpc":"2.0","id":1,"result":{"thread":{"id":"thread-1"}}}');
    await startThread;

    client.handleLine('{"jsonrpc":"2.0","method":"error","params":{"threadId":"thread-1","willRetry":true,"error":{"message":"temporary transport issue"}}}');
    assert.equal(client.getTurnError(), null);

    client.handleLine('{"jsonrpc":"2.0","method":"turn/started","params":{"threadId":"thread-1","turn":{"id":"turn-1"}}}');
    client.handleLine('{"jsonrpc":"2.0","method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"failed","error":{"message":"real failure"}}}}');
    assert.equal(client.getTurnError(), 'real failure');
    assert.equal(client.getTurnId(), null);
  }

  {
    const writer = createWriter();
    const client = new CodexAppServerRpcClient({ stdin: writer, logger: quietLogger as any });
    const startThread = client.request('thread/start', { cwd: 'C:\\work\\cc-feishu' });

    client.handleLine('{"jsonrpc":"2.0","id":1,"result":{"thread":{"id":"thread-1"}}}');
    await startThread;

    client.handleLine('{"jsonrpc":"2.0","method":"turn/started","params":{"threadId":"thread-1","turn":{"id":"turn-1"}}}');
    client.handleLine('{"jsonrpc":"2.0","method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","status":"failed","error":{"message":"first failure"}}}}');
    assert.equal(client.getTurnError(), 'first failure');
    assert.equal(client.getTurnId(), null);

    client.handleLine('{"jsonrpc":"2.0","method":"turn/started","params":{"threadId":"thread-1","turn":{"id":"turn-2"}}}');
    assert.equal(client.getTurnId(), 'turn-2');
    assert.equal(client.getTurnError(), null);

    client.handleLine('{"jsonrpc":"2.0","method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-2","status":"completed"}}}');
    assert.equal(client.getTurnId(), null);
    assert.equal(client.getTurnError(), null);
  }

  {
    const writer = createWriter();
    const client = new CodexAppServerRpcClient({ stdin: writer, logger: quietLogger as any });
    const startThread = client.request('thread/start', { cwd: 'C:\\work\\cc-feishu' });

    client.handleLine('{"jsonrpc":"2.0","id":1,"result":{"thread":{"id":"thread-1"}}}');
    await startThread;

    client.handleLine('{"jsonrpc":"2.0","method":"item/completed","params":{"threadId":"thread-1","item":{"type":"error","text":"text-shaped item error"}}}');
    assert.equal(client.getTurnError(), 'text-shaped item error');

    client.handleLine('{"jsonrpc":"2.0","method":"turn/started","params":{"threadId":"thread-1","turn":{"id":"turn-2"}}}');
    client.handleLine('{"jsonrpc":"2.0","method":"item/completed","params":{"threadId":"thread-1","item":{"type":"error","message":"message-shaped item error"}}}');
    assert.equal(client.getTurnError(), 'message-shaped item error');
  }

  {
    const writer = createWriter();
    const client = new CodexAppServerRpcClient({ stdin: writer, logger: quietLogger as any });
    const startThread = client.request('thread/start', { cwd: 'C:\\work\\cc-feishu' });

    client.handleLine('{"jsonrpc":"2.0","id":1,"result":{"thread":{"id":"thread-1"}}}');
    await startThread;

    client.handleLine('{"jsonrpc":"2.0","method":"turn/started","params":{"threadId":"thread-2","turn":{"id":"ignored-turn"}}}');
    client.handleLine('{"jsonrpc":"2.0","method":"turn/completed","params":{"threadId":"thread-2","turn":{"id":"ignored-turn","status":"failed","error":{"message":"ignored failure"}}}}');

    assert.equal(client.getTurnId(), null);
    assert.equal(client.getTurnError(), null);
  }

  {
    const writer = createWriter();
    const client = new CodexAppServerRpcClient({ stdin: writer, logger: quietLogger as any });

    client.handleLine('{"jsonrpc":"2.0","id":41,"method":"item/commandExecution/requestApproval","params":{"command":"dir"}}');
    client.handleLine('{"jsonrpc":"2.0","id":42,"method":"execCommandApproval","params":{"command":"dir"}}');
    client.handleLine('{"jsonrpc":"2.0","id":43,"method":"item/fileChange/requestApproval","params":{"changes":[]}}');
    client.handleLine('{"jsonrpc":"2.0","id":44,"method":"applyPatchApproval","params":{"changes":[]}}');
    client.handleLine('{"jsonrpc":"2.0","id":45,"method":"server/customRequest","params":{"foo":"bar"}}');

    assert.deepEqual(parseWrites(writer), [
      { jsonrpc: '2.0', id: 41, result: { decision: 'accept' } },
      { jsonrpc: '2.0', id: 42, result: { decision: 'approved' } },
      { jsonrpc: '2.0', id: 43, result: { decision: 'accept' } },
      { jsonrpc: '2.0', id: 44, result: { decision: 'approved' } },
      { jsonrpc: '2.0', id: 45, result: {} },
    ]);
  }

  console.log('codex-app-server-rpc.test.ts passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
