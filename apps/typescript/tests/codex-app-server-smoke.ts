import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
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

const launchConfig = resolveCodexLaunchConfig();

assert.equal(launchConfig.executablePath, process.env.CODEX_CMD?.trim() || 'codex');
assert.deepEqual(launchConfig.argsPrefix, [], 'argsPrefix must stay empty for codex app-server');

const child = spawn(launchConfig.executablePath, ['app-server'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: buildSpawnEnv(),
  shell: process.platform === 'win32',
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

  console.log('codex app-server 可直接通过 `codex app-server` 启动');
  console.log('默认 transport 可通过 stdio 完成最小握手');
  console.log('stdout 为逐行 JSON');
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

function buildSpawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform !== 'win32') {
    return env;
  }

  const appData = env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  const npmBin = path.join(appData, 'npm');
  const currentPath = env.PATH ?? '';
  const pathEntries = currentPath.split(path.delimiter).filter(Boolean);

  if (!pathEntries.includes(npmBin)) {
    env.PATH = [npmBin, currentPath].filter(Boolean).join(path.delimiter);
  }

  return env;
}
