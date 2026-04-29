import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import util from 'node:util';

import { getVendoredSdkEntryPath, loadCodexSdk } from './loader';
import { CodexMinimalSession, ConcurrentTurnError, TurnAbortedError } from './session';
import { resolveLegacyCodexLaunchOverrides } from '../codex/launch';

interface CheckResult {
  name: string;
  detail: string;
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

function printCheck(result: CheckResult): void {
  console.log(`PASS ${result.name}: ${result.detail}`);
}

async function main(): Promise<void> {
  const checks: CheckResult[] = [];
  const launchConfig = resolveLegacyCodexLaunchOverrides();

  console.log(`[codex-minimal] node=${process.version}`);
  console.log(`[codex-minimal] sdk-entry=${getVendoredSdkEntryPath()}`);
  console.log(`[codex-minimal] codex-launch=${util.inspect(launchConfig)}`);

  const sdk = await loadCodexSdk();
  assert.equal(typeof sdk.Codex, 'function');
  checks.push({
    name: 'CommonJS loader can import the ESM Codex SDK boundary',
    detail: 'Dynamic import of the vendored ESM entry succeeded.',
  });

  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-minimal-'));
  const session = new CodexMinimalSession({
    workingDirectory,
    codexPathOverride: launchConfig.executablePath,
    codexArgsPrefix: launchConfig.argsPrefix,
  });

  try {
    const firstTurn = await withTimeout(
      session.sendMessage('Reply with exactly FIRST_RUN_OK and nothing else.'),
      120000,
      'first turn',
    );

    assert.match(firstTurn.text, /FIRST_RUN_OK/i);
    assert.ok(firstTurn.threadId);
    checks.push({
      name: 'skipGitRepoCheck works in a non-Git directory',
      detail: `Turn succeeded in ${workingDirectory} with thread ${firstTurn.threadId}.`,
    });

    const originalThreadId = firstTurn.threadId;
    const longTurnPromise = withTimeout(
      session.sendMessage(
        'Write the token LONG_RUN on separate lines 2000 times. Do not summarize or stop early.',
      ),
      120000,
      'long turn',
    );

    const concurrentError = await captureError(
      session.sendMessage('Reply with exactly CONCURRENT_SHOULD_NOT_START and nothing else.'),
    );
    assert.ok(concurrentError instanceof ConcurrentTurnError);
    checks.push({
      name: 'Concurrent turns are blocked for one session',
      detail: (concurrentError as Error).message,
    });

    await delay(100);
    assert.equal(session.interrupt(), true);

    const abortError = await captureError(longTurnPromise);
    assert.ok(abortError instanceof TurnAbortedError, `expected TurnAbortedError, got ${String(abortError)}`);
    checks.push({
      name: 'stop aborts the current turn',
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
      name: 'A thread can continue after an aborted turn',
      detail: `Thread ${resumedTurn.threadId} remained usable after abort.`,
    });
  } finally {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
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
