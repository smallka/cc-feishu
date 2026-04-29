import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';

const {
  CodexAppServerProcess,
} = require('../src/codex-minimal/app-server-process') as typeof import('../src/codex-minimal/app-server-process');

type ExitSignal = NodeJS.Signals | null;

const quietLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

class FakeChildProcess extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid: number;
  exitCode: number | null = null;
  signalCode: ExitSignal = null;
  killSignals: NodeJS.Signals[] = [];
  private readonly onKill?: (signal: NodeJS.Signals, child: FakeChildProcess) => void;

  constructor(pid: number, onKill?: (signal: NodeJS.Signals, child: FakeChildProcess) => void) {
    super();
    this.pid = pid;
    this.onKill = onKill;
  }

  finish(code: number | null, signal: ExitSignal): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }

  fail(error: Error): void {
    this.emit('error', error);
  }

  kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    this.onKill?.(signal, this);
    return true;
  }
}

async function withPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T> | T): Promise<T> {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });

  try {
    return await fn();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(process, 'platform', originalDescriptor);
    }
  }
}

async function main() {
  {
    const children = [new FakeChildProcess(101), new FakeChildProcess(102)];
    let spawnIndex = 0;
    const processInstance = new CodexAppServerProcess({
      logger: quietLogger as any,
      spawnFactory: () => children[spawnIndex++],
      spawnTarget: {
        command: 'fake-codex',
        args: ['app-server'],
        launchDescription: 'fake spawn',
      },
    });

    processInstance.start();
    const firstExit = processInstance.onExit();
    children[0].finish(0, null);
    assert.deepEqual(await firstExit, { code: 0, signal: null });

    processInstance.start();
    const secondExit = processInstance.onExit();
    children[1].finish(0, null);
    assert.deepEqual(await secondExit, { code: 0, signal: null });
  }

  {
    const children = [new FakeChildProcess(111), new FakeChildProcess(112)];
    let spawnIndex = 0;
    const processInstance = new CodexAppServerProcess({
      logger: quietLogger as any,
      spawnFactory: () => children[spawnIndex++],
      spawnTarget: {
        command: 'fake-codex',
        args: ['app-server'],
        launchDescription: 'fake spawn',
      },
    });

    processInstance.start();
    const firstExit = processInstance.onExit();
    children[0].fail(new Error('synthetic process error'));
    assert.deepEqual(await firstExit, { code: null, signal: null });

    processInstance.start();
    const secondExit = processInstance.onExit();
    children[1].finish(0, null);
    assert.deepEqual(await secondExit, { code: 0, signal: null });
  }

  {
    const children = [new FakeChildProcess(121), new FakeChildProcess(122)];
    let spawnIndex = 0;
    const processInstance = new CodexAppServerProcess({
      logger: quietLogger as any,
      spawnFactory: () => children[spawnIndex++],
      spawnTarget: {
        command: 'fake-codex',
        args: ['app-server'],
        launchDescription: 'fake spawn',
      },
    });

    children[0].stdin.on('finish', () => {
      children[0].finish(0, null);
    });

    processInstance.start();
    assert.deepEqual(await processInstance.stop(), { code: 0, signal: null });

    processInstance.start();
    const secondExit = processInstance.onExit();
    children[1].finish(0, null);
    assert.deepEqual(await secondExit, { code: 0, signal: null });
  }

  {
    const child = new FakeChildProcess(201);
    const processInstance = new CodexAppServerProcess({
      logger: quietLogger as any,
      stderrTailBytes: 4,
      spawnFactory: () => child,
      spawnTarget: {
        command: 'fake-codex',
        args: ['app-server'],
        launchDescription: 'fake spawn',
      },
    });

    processInstance.start();
    child.stderr.write('abc');
    child.stderr.write('def');
    child.finish(0, null);
    await processInstance.onExit();
    assert.equal(processInstance.getStderrTail(), 'cdef');
  }

  await withPlatform('linux', async () => {
    const child = new FakeChildProcess(301, (signal, currentChild) => {
      if (signal === 'SIGKILL') {
        currentChild.finish(null, 'SIGKILL');
      }
    });
    const processInstance = new CodexAppServerProcess({
      logger: quietLogger as any,
      stopExitTimeoutMs: 1,
      spawnFactory: () => child,
      spawnTarget: {
        command: 'fake-codex',
        args: ['app-server'],
        launchDescription: 'fake spawn',
      },
    });

    processInstance.start();
    const exit = await processInstance.stop();
    assert.deepEqual(child.killSignals, ['SIGTERM', 'SIGKILL']);
    assert.deepEqual(exit, { code: null, signal: 'SIGKILL' });
  });

  await withPlatform('win32', async () => {
    let taskKillCalls = 0;
    const child = new FakeChildProcess(401, (signal, currentChild) => {
      if (signal === 'SIGTERM') {
        currentChild.finish(null, 'SIGTERM');
      }
    });
    const processInstance = new CodexAppServerProcess({
      logger: quietLogger as any,
      stopExitTimeoutMs: 1,
      spawnFactory: () => child,
      spawnTarget: {
        command: 'fake-codex',
        args: ['app-server'],
        launchDescription: 'fake spawn',
      },
      taskKill: async () => {
        taskKillCalls += 1;
      },
    });

    processInstance.start();
    const exit = await processInstance.stop();
    assert.equal(taskKillCalls, 1);
    assert.deepEqual(child.killSignals, ['SIGTERM']);
    assert.deepEqual(exit, { code: null, signal: 'SIGTERM' });
  });
}

void main().then(
  () => {
    console.log('codex-app-server-process.test.ts passed');
  },
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
