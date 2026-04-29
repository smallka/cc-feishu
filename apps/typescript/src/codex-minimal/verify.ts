import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

interface CheckResult {
  name: string;
  detail: string;
}

interface CodexMinimalSessionLike {
  sendMessage: (
    text: string,
    options?: {
      onActivity?: () => void;
      imagePaths?: string[];
    },
  ) => Promise<{
    text: string;
    threadId: string | null;
  }>;
  interrupt: () => boolean;
  isRunning: () => boolean;
  getThreadId: () => string | null;
  close?: () => Promise<void>;
}

interface AppServerProbe {
  getLatestProcess: () => object | null;
  getLineListener: (processInstance: object | null) => ((line: string) => void) | null;
  restore: () => void;
}

function ensureMinimalTestEnv(): void {
  process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
  process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} exceeded ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function captureError<T>(promise: Promise<T>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

async function waitForValue<T>(
  readValue: () => T | null | undefined,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const value = readValue();
    if (value !== null && value !== undefined) {
      return value;
    }
    await delay(25);
  }

  throw new Error(`${label} was not observed within ${timeoutMs}ms`);
}

function printCheck(result: CheckResult): void {
  console.log(`PASS ${result.name}: ${result.detail}`);
}

function installAppServerProbe(): AppServerProbe {
  const appServerModule = require('./app-server-process') as typeof import('./app-server-process');
  const processPrototype = appServerModule.CodexAppServerProcess.prototype as {
    start: () => void;
    onLine: (listener: (line: string) => void) => () => void;
  };
  const originalStart = processPrototype.start;
  const originalOnLine = processPrototype.onLine;
  let latestProcess: object | null = null;
  const lineListeners = new WeakMap<object, (line: string) => void>();

  processPrototype.start = function patchedStart(this: object): void {
    latestProcess = this;
    return originalStart.call(this);
  };

  processPrototype.onLine = function patchedOnLine(
    this: object,
    listener: (line: string) => void,
  ): () => void {
    lineListeners.set(this, listener);
    return originalOnLine.call(this, listener);
  };

  return {
    getLatestProcess: () => latestProcess,
    getLineListener: (processInstance: object | null) => {
      if (!processInstance) {
        return null;
      }
      return lineListeners.get(processInstance) ?? null;
    },
    restore: () => {
      processPrototype.start = originalStart;
      processPrototype.onLine = originalOnLine;
    },
  };
}

async function closeSession(session: CodexMinimalSessionLike): Promise<void> {
  if (typeof session.close === 'function') {
    await session.close();
  }
}

async function removeDirectoryWithRetry(targetPath: string): Promise<void> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function injectNotification(
  listener: (line: string) => void,
  method: string,
  threadId: string,
): void {
  listener(JSON.stringify({
    jsonrpc: '2.0',
    method,
    params: { threadId },
  }));
}

async function main(): Promise<void> {
  ensureMinimalTestEnv();

  const checks: CheckResult[] = [];
  const appServerProbe = installAppServerProbe();
  const sessionModule = require('./session') as typeof import('./session');
  const launchModule = require('../codex/launch') as typeof import('../codex/launch');
  const { CodexMinimalSession, ConcurrentTurnError, TurnAbortedError } = sessionModule;
  const launchConfig = launchModule.resolveLegacyCodexLaunchOverrides();

  console.log(`[codex-minimal] node=${process.version}`);
  console.log(`[codex-minimal] codex-launch=${util.inspect(launchConfig)}`);

  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-minimal-'));
  const session: CodexMinimalSessionLike = new CodexMinimalSession({
    workingDirectory,
    codexPathOverride: launchConfig.executablePath,
    codexArgsPrefix: launchConfig.argsPrefix,
  });

  try {
    const firstTurnActivity = { count: 0 };
    const firstTurn = await withTimeout(
      session.sendMessage('Reply with exactly FIRST_RUN_OK and nothing else.', {
        onActivity: () => {
          firstTurnActivity.count += 1;
        },
      }),
      120000,
      'first turn',
    );

    assert.match(firstTurn.text, /FIRST_RUN_OK/i);
    assert.ok(firstTurn.threadId);
    checks.push({
      name: '首轮消息成功',
      detail: `Thread ${firstTurn.threadId} returned FIRST_RUN_OK.`,
    });

    checks.push({
      name: '非 Git 目录可运行',
      detail: `Turn succeeded in ${workingDirectory}.`,
    });

    assert.ok(firstTurnActivity.count > 0, 'expected first turn to trigger onActivity');
    checks.push({
      name: 'onActivity 至少会在主线程 turn/* / item/* 事件上触发',
      detail: `Observed ${firstTurnActivity.count} activity callbacks during the first turn.`,
    });

    const processInstance = await waitForValue(
      () => appServerProbe.getLatestProcess(),
      5000,
      'app-server process',
    );
    const lineListener = await waitForValue(
      () => appServerProbe.getLineListener(processInstance),
      5000,
      'app-server line listener',
    );

    const originalThreadId = firstTurn.threadId;
    const longTurnActivity = { count: 0 };
    const longTurnPromise = withTimeout(
      session.sendMessage(
        'Write the token LONG_RUN on separate lines 2000 times. Do not summarize or stop early.',
        {
          onActivity: () => {
            longTurnActivity.count += 1;
          },
        },
      ),
      120000,
      'long turn',
    );

    const concurrentError = await captureError(
      session.sendMessage('Reply with exactly CONCURRENT_SHOULD_NOT_START and nothing else.'),
    );
    assert.ok(concurrentError instanceof ConcurrentTurnError);
    checks.push({
      name: '同一 session 阻止并发 turn',
      detail: (concurrentError as Error).message,
    });

    await waitForValue(
      () => (session.isRunning() ? true : null),
      5000,
      'running turn state',
    );
    await waitForValue(
      () => ((session as { activeTurnId?: string | null }).activeTurnId ?? null),
      5000,
      'active turn id',
    );

    const sameThreadBaseline = longTurnActivity.count;
    injectNotification(lineListener, 'turn/progress', originalThreadId);
    injectNotification(lineListener, 'item/updated', originalThreadId);
    assert.equal(
      longTurnActivity.count,
      sameThreadBaseline + 2,
      'expected current-thread turn/* and item/* notifications to trigger onActivity',
    );

    const otherThreadBaseline = longTurnActivity.count;
    injectNotification(lineListener, 'turn/progress', `${originalThreadId}-other`);
    injectNotification(lineListener, 'item/updated', `${originalThreadId}-other`);
    assert.equal(
      longTurnActivity.count,
      otherThreadBaseline,
      'expected non-current thread notifications to be ignored',
    );
    checks.push({
      name: '非当前 threadId 事件不会触发 onActivity',
      detail: 'Synthetic notifications for another thread were ignored.',
    });

    const stderrBaseline = longTurnActivity.count;
    (processInstance as { pushStderrChunk?: (chunk: Buffer) => void }).pushStderrChunk?.(
      Buffer.from('synthetic stderr activity probe'),
    );
    assert.equal(
      longTurnActivity.count,
      stderrBaseline,
      'expected stderr data not to trigger onActivity',
    );
    checks.push({
      name: 'stderr 输出不会触发 onActivity',
      detail: 'Synthetic stderr data did not increment activity callbacks.',
    });

    assert.equal(session.interrupt(), true);

    const abortError = await captureError(longTurnPromise);
    assert.ok(abortError instanceof TurnAbortedError, `expected TurnAbortedError, got ${String(abortError)}`);
    checks.push({
      name: 'interrupt() 使当前 turn 变成 TurnAbortedError',
      detail: (abortError as Error).message,
    });

    const resumedTurn = await withTimeout(
      session.sendMessage('Reply with exactly AFTER_ABORT_OK and nothing else.'),
      120000,
      'post-abort turn',
    );

    assert.match(resumedTurn.text, /AFTER_ABORT_OK/i);
    assert.equal(resumedTurn.threadId, originalThreadId);
    checks.push({
      name: '中断后同一 threadId 仍可继续下一轮',
      detail: `Thread ${resumedTurn.threadId} remained usable after interrupt.`,
    });
  } finally {
    try {
      await closeSession(session);
    } finally {
      appServerProbe.restore();
      await removeDirectoryWithRetry(workingDirectory);
    }
  }

  for (const check of checks) {
    printCheck(check);
  }

  console.log(`[codex-minimal] verified ${checks.length} checks.`);
}

main().catch(error => {
  console.error('[codex-minimal] verification failed');
  if (error instanceof Error) {
    console.error(error.stack || error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
