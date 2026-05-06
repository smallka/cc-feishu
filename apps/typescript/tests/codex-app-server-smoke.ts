import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const { resolveCodexLaunchConfig } = require('../src/codex/launch') as typeof import('../src/codex/launch');
const { resolveCodexAppServerSpawnTarget } = require('../src/codex/launch') as typeof import('../src/codex/launch');

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

type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

const launchConfig = resolveCodexLaunchConfig();
assert.deepEqual(launchConfig.argsPrefix, [], 'argsPrefix must stay empty for codex app-server');

const executablePath = launchConfig.executablePath;
const spawnTarget = resolveCodexAppServerSpawnTarget();

assert.equal(executablePath, process.env.CODEX_CMD?.trim() || 'codex');
if (process.platform === 'win32') {
  assert.equal(spawnTarget.command.toLowerCase(), 'cmd.exe');
  assert.deepEqual(spawnTarget.args.slice(0, 4), ['/d', '/s', '/c', executablePath]);
  assert.equal(spawnTarget.args[4], 'app-server');
} else {
  assert.equal(spawnTarget.command, executablePath);
  assert.deepEqual(spawnTarget.args, ['app-server']);
}

const child = spawn(spawnTarget.command, spawnTarget.args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

const stdoutLines: string[] = [];
const stderrChunks: string[] = [];
const pendingResponses = new Map<number, PendingResponse>();
const expectedCwd = process.cwd();
const expectedCommand = 'node -e "process.stdout.write(process.cwd())"';
const commandApprovalMethods = new Set(['item/commandExecution/requestApproval', 'execCommandApproval']);
let nextRequestId = 1;
let threadId: string | null = null;
let successfulResponseCount = 0;
let settled = false;
let shuttingDown = false;
let childExit: ChildExit | null = null;
let serverRequestCount = 0;
const serverRequestMethods = new Set<string>();
const approvedCommands: string[] = [];
let turnCompletedParams: Record<string, unknown> | null = null;
const terminalErrors: string[] = [];
const finalAgentMessages: string[] = [];

const rl = readline.createInterface({
  input: child.stdout,
  crlfDelay: Infinity,
});

const exitPromise = new Promise<ChildExit>((resolve) => {
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
    resolve(childExit);
  });
});

const timeout = setTimeout(() => {
  void fail(new Error('smoke test timed out before turn/completed'));
}, 60000);

child.stderr.on('data', (chunk: Buffer) => {
  stderrChunks.push(chunk.toString());
});

child.on('error', (error) => {
  void fail(error);
});

child.on('exit', (code, signal) => {
  if (!settled && !shuttingDown) {
    void fail(new Error(`codex app-server exited early with code=${code} signal=${signal}`));
  }
});

rl.on('line', (line) => {
  stdoutLines.push(line);

  let message: JsonRpcMessage;
  try {
    message = JSON.parse(line) as JsonRpcMessage;
  } catch (error) {
    void fail(new Error(`stdout is not valid JSONL: ${(error as Error).message}\nline=${line}`));
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

  handleNotification(message);
});

void run().catch((error) => {
  void fail(error as Error);
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
    cwd: expectedCwd,
    approvalPolicy: 'untrusted',
  });

  threadId = extractThreadId(threadResponse.result);
  assert.ok(threadId, 'thread/start response must include threadId');

  await request('turn/start', {
    threadId,
    approvalPolicy: 'untrusted',
    input: [
      {
        type: 'text',
        text: `Run the exact read-only command \`${expectedCommand}\` to print the current working directory. Do not guess or infer it without running the command. Your final answer must include the exact directory string returned by that command, verbatim: ${expectedCwd}.`,
        text_elements: [],
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
  serverRequestCount += 1;
  const method = message.method ?? 'unknown';
  serverRequestMethods.add(method);

  if (commandApprovalMethods.has(method)) {
    const approvedCommand = extractApprovedCommand(message.params);
    if (approvedCommand) {
      approvedCommands.push(approvedCommand);
    }
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

function handleNotification(message: JsonRpcMessage) {
  if (!message.method) {
    return;
  }

  if (message.method === 'item/completed') {
    const agentMessage = extractFinalAgentMessage(message.params);
    if (agentMessage) {
      finalAgentMessages.push(agentMessage);
    }

    const itemError = extractItemError(message.params);
    if (itemError) {
      terminalErrors.push(itemError);
    }
    return;
  }

  if (message.method === 'turn/completed') {
    turnCompletedParams = message.params ?? {};
    const turnError = extractTurnError(turnCompletedParams);
    if (turnError) {
      terminalErrors.push(turnError);
    }
    void finalizeIfReady();
    return;
  }

  if (message.method === 'error') {
    terminalErrors.push(JSON.stringify(message.params ?? {}));
    return;
  }

  if (message.method === 'turn/failed' || message.method === 'turn/error') {
    terminalErrors.push(JSON.stringify(message.params ?? {}));
  }
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

async function finalizeIfReady() {
  if (!threadId || !turnCompletedParams) {
    return;
  }

  try {
    assert.ok(stdoutLines.length > 0, 'expected stdout JSONL output');
    assert.ok(successfulResponseCount >= 3, 'expected initialize, thread/start, and turn/start responses');
    assert.equal(extractTurnStatus(turnCompletedParams), 'completed', 'turn/completed must report a completed turn');
    assert.equal(extractTurnError(turnCompletedParams), null, 'turn/completed must not include a terminal error');
    assert.deepEqual(terminalErrors, [], 'expected no terminal errors');
    assert.ok(serverRequestCount >= 1, 'expected at least one server request');
    assert.ok(
      [...commandApprovalMethods].some((method) => serverRequestMethods.has(method)),
      `expected a command approval request, got: ${[...serverRequestMethods].join(', ') || 'none'}`
    );
    assert.ok(
      approvedCommands.some((command) => isExpectedApprovedCommand(command)),
      `expected approved cwd command, got: ${approvedCommands.join(' | ') || 'none'}`
    );
    assert.ok(finalAgentMessages.some((message) => message.trim().length > 0), 'expected final agent output');
    assert.ok(
      finalAgentMessages.some((message) => message.includes(expectedCwd)),
      `expected final agent output to include cwd: ${expectedCwd}`
    );

    settled = true;
    clearTimeout(timeout);
    rl.close();
    await shutdownChild();

    console.log(`codex app-server launch verified via ${spawnTarget.launchDescription}`);
    console.log('default stdio transport completed the minimal JSON-RPC handshake');
    console.log(`final agent output: ${finalAgentMessages[finalAgentMessages.length - 1]}`);
  } catch (error) {
    await fail(error as Error);
  }
}

async function fail(error: Error) {
  if (settled) {
    return;
  }

  settled = true;
  clearTimeout(timeout);
  rl.close();

  for (const pending of pendingResponses.values()) {
    pending.reject(error);
  }
  pendingResponses.clear();

  await shutdownChild();

  if (stderrChunks.length > 0) {
    console.error('[stderr]');
    console.error(stderrChunks.join(''));
  }
  if (stdoutLines.length > 0) {
    console.error('[stdout tail]');
    console.error(stdoutLines.slice(-20).join('\n'));
  }

  console.error(error.stack || error.message);
  process.exitCode = 1;
}

function extractTurnStatus(params: Record<string, unknown>): string | null {
  const directStatus = params.status;
  if (typeof directStatus === 'string') {
    return directStatus;
  }

  const turn = params.turn;
  if (turn && typeof turn === 'object') {
    const nestedStatus = (turn as { status?: unknown }).status;
    if (typeof nestedStatus === 'string') {
      return nestedStatus;
    }
  }

  return null;
}

function extractTurnError(params: Record<string, unknown>): string | null {
  const directError = params.error;
  if (directError && typeof directError === 'object') {
    const message = (directError as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  }

  const turn = params.turn;
  if (turn && typeof turn === 'object') {
    const nestedError = (turn as { error?: unknown }).error;
    if (nestedError && typeof nestedError === 'object') {
      const message = (nestedError as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
    }
  }

  return null;
}

function extractItemError(params: Record<string, unknown> | undefined): string | null {
  if (!params) {
    return null;
  }

  const item = params.item;
  if (!item || typeof item !== 'object') {
    return null;
  }

  if ((item as { type?: unknown }).type !== 'error') {
    return null;
  }

  const text = (item as { text?: unknown }).text;
  if (typeof text === 'string' && text.trim()) {
    return text.trim();
  }

  const message = (item as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : JSON.stringify(item);
}

function extractFinalAgentMessage(params: Record<string, unknown> | undefined): string | null {
  if (!params) {
    return null;
  }

  const item = params.item;
  if (!item || typeof item !== 'object') {
    return null;
  }

  if ((item as { type?: unknown }).type !== 'agentMessage') {
    return null;
  }

  const phase = (item as { phase?: unknown }).phase;
  if (typeof phase === 'string' && phase !== 'final_answer') {
    return null;
  }

  const text = collectText(item).join(' ').trim();
  return text || null;
}

function isExpectedApprovedCommand(command: string): boolean {
  return command === expectedCommand || (
    command.includes('node -e') &&
    command.includes('process.stdout.write(process.cwd())')
  );
}

function extractApprovedCommand(params: Record<string, unknown> | undefined): string | null {
  if (!params) {
    return null;
  }

  const directCommand = normalizeApprovedCommand(params.command);
  if (directCommand) {
    return directCommand;
  }

  const item = params.item;
  if (item && typeof item === 'object') {
    const nestedCommand = normalizeApprovedCommand((item as { command?: unknown }).command);
    if (nestedCommand) {
      return nestedCommand;
    }
  }

  return null;
}

function normalizeApprovedCommand(command: unknown): string | null {
  if (typeof command === 'string') {
    return command.trim() || null;
  }

  if (Array.isArray(command)) {
    const commandParts = command.filter((part): part is string => typeof part === 'string' && part.length > 0);
    if (commandParts.length > 0) {
      return commandParts.join(' ');
    }
  }

  return null;
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectText(entry));
  }

  const objectValue = value as Record<string, unknown>;
  const collected: string[] = [];

  for (const [key, entry] of Object.entries(objectValue)) {
    if (key === 'text' && typeof entry === 'string') {
      collected.push(entry);
      continue;
    }

    if (key === 'content' || key === 'message' || key === 'parts') {
      collected.push(...collectText(entry));
    }
  }

  return collected;
}

async function shutdownChild() {
  if (shuttingDown) {
    await waitForExit(1000);
    return;
  }

  shuttingDown = true;

  if (!childExit) {
    child.stdin.end();
    if (await waitForExit(3000)) {
      return;
    }
  }

  if (!child.pid || childExit) {
    return;
  }

  if (process.platform === 'win32') {
    await runTaskKill(child.pid);
    await waitForExit(3000);
    return;
  }

  child.kill('SIGTERM');
  if (await waitForExit(3000)) {
    return;
  }

  child.kill('SIGKILL');
  await waitForExit(3000);
}

async function waitForExit(timeoutMs: number): Promise<boolean> {
  if (childExit) {
    return true;
  }

  return await Promise.race([
    exitPromise.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
}

async function runTaskKill(pid: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
  });
}
