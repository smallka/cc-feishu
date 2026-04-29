import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const { resolveCodexLaunchConfig } = require('../src/codex/launch') as typeof import('../src/codex/launch');

type JsonRpcMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
};

type PendingResponse = {
  resolve: (message: JsonRpcMessage) => void;
  reject: (error: Error) => void;
};

type SpawnTarget = {
  command: string;
  args: string[];
  launchDescription: string;
};

const launchConfig = resolveCodexLaunchConfig();
const spawnTarget = resolveSpawnTarget(launchConfig);

assert.equal(launchConfig.executablePath, process.env.CODEX_CMD?.trim() || 'codex');
assert.deepEqual(launchConfig.argsPrefix, [], 'argsPrefix must stay empty for codex app-server');
if (process.platform === 'win32') {
  assert.equal(spawnTarget.command.toLowerCase(), 'cmd.exe');
  assert.deepEqual(spawnTarget.args.slice(0, 4), ['/d', '/s', '/c', launchConfig.executablePath]);
  assert.equal(spawnTarget.args[4], 'app-server');
} else {
  assert.equal(spawnTarget.command, launchConfig.executablePath);
  assert.deepEqual(spawnTarget.args, ['app-server']);
}

const child = spawn(spawnTarget.command, spawnTarget.args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

const stdoutLines: string[] = [];
const stderrChunks: string[] = [];
const pendingResponses = new Map<number, PendingResponse>();
let nextRequestId = 1;
let threadId: string | null = null;
let turnCompleted = false;
let successfulResponseCount = 0;
let settled = false;

const rl = readline.createInterface({
  input: child.stdout,
  crlfDelay: Infinity,
});

const timeout = setTimeout(() => {
  fail(new Error('smoke test timed out before turn/completed'));
}, 60000);

child.stderr.on('data', (chunk: Buffer) => {
  stderrChunks.push(chunk.toString());
});

child.on('error', (error) => {
  fail(error);
});

child.on('exit', (code, signal) => {
  if (!settled) {
    fail(new Error(`codex app-server exited early with code=${code} signal=${signal}`));
  }
});

rl.on('line', (line) => {
  stdoutLines.push(line);

  let message: JsonRpcMessage;
  try {
    message = JSON.parse(line) as JsonRpcMessage;
  } catch (error) {
    fail(new Error(`stdout is not valid JSONL: ${(error as Error).message}\nline=${line}`));
    return;
  }

  if (typeof message.id === 'number' && message.method) {
    handleServerRequest(message);
    return;
  }

  if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
    const pending = pendingResponses.get(message.id);
    if (!pending) {
      return;
    }

    pendingResponses.delete(message.id);

    if (message.error) {
      pending.reject(
        new Error(
          `JSON-RPC ${message.id} failed: ${message.error.message ?? 'unknown error'} (code=${message.error.code ?? 'unknown'})`
        )
      );
      return;
    }

    successfulResponseCount += 1;
    pending.resolve(message);
    return;
  }

  if (message.method === 'turn/completed') {
    turnCompleted = true;
    finalizeIfReady();
  }
});

void run().catch((error) => {
  fail(error as Error);
});

async function run() {
  await request('initialize', {
    clientInfo: {
      name: 'cc-feishu-typescript-smoke',
      version: '1.0.0',
    },
    capabilities: {
      experimentalApi: true,
    },
  });

  notify('initialized');

  const threadResponse = await request('thread/start', {
    cwd: process.cwd(),
    experimentalRawEvents: true,
    persistExtendedHistory: false,
  });

  threadId = extractThreadId(threadResponse.result);
  assert.ok(threadId, 'thread/start response must include threadId');

  await request('turn/start', {
    threadId,
    input: [
      {
        type: 'text',
        text: 'Run a read-only command to report the current working directory, then answer in one sentence.',
      },
    ],
  });
}

function request(method: string, params: Record<string, unknown>): Promise<JsonRpcMessage> {
  const id = nextRequestId++;

  return new Promise<JsonRpcMessage>((resolve, reject) => {
    pendingResponses.set(id, { resolve, reject });
    writeJson({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });
  });
}

function notify(method: string, params?: Record<string, unknown>) {
  writeJson({
    jsonrpc: '2.0',
    method,
    ...(params ? { params } : {}),
  });
}

function handleServerRequest(message: JsonRpcMessage) {
  const method = message.method ?? 'unknown';

  if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
    respond(message.id!, { decision: 'accept' });
    return;
  }

  if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
    respond(message.id!, { decision: 'accept' });
    return;
  }

  console.log(`[probe] server request: ${method}`);
  respond(message.id!, {});
}

function respond(id: number, result: Record<string, unknown>) {
  writeJson({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function writeJson(payload: Record<string, unknown>) {
  child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function extractThreadId(result: unknown): string | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const thread = (result as { thread?: { id?: unknown } }).thread;
  if (thread && typeof thread.id === 'string') {
    return thread.id;
  }

  return null;
}

function finalizeIfReady() {
  if (!threadId || !turnCompleted) {
    return;
  }

  assert.ok(stdoutLines.length > 0, 'expected stdout JSONL output');
  assert.ok(successfulResponseCount >= 1, 'expected at least one successful response');

  settled = true;
  clearTimeout(timeout);
  rl.close();
  child.stdin.end();
  child.kill();

  console.log(`codex app-server launch verified via ${spawnTarget.launchDescription}`);
  console.log('default stdio transport completed the minimal JSON-RPC handshake');
  console.log('stdout uses line-delimited JSON');
}

function fail(error: Error) {
  if (settled) {
    return;
  }

  settled = true;
  clearTimeout(timeout);
  rl.close();
  child.stdin.end();
  child.kill();

  for (const pending of pendingResponses.values()) {
    pending.reject(error);
  }
  pendingResponses.clear();

  if (stderrChunks.length > 0) {
    console.error('[stderr]');
    console.error(stderrChunks.join(''));
  }
  if (stdoutLines.length > 0) {
    console.error('[stdout tail]');
    console.error(stdoutLines.slice(-20).join('\n'));
  }

  console.error(error.message);
  process.exitCode = 1;
}

function resolveSpawnTarget(config: { executablePath: string }): SpawnTarget {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', config.executablePath, 'app-server'],
      launchDescription: `cmd.exe trampoline (${config.executablePath} app-server)`,
    };
  }

  return {
    command: config.executablePath,
    args: ['app-server'],
    launchDescription: `direct spawn (${config.executablePath} app-server)`,
  };
}
