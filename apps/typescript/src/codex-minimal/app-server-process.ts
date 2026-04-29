import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import readline from 'node:readline';
import { CodexAppServerSpawnTarget, resolveCodexAppServerSpawnTarget } from '../codex/launch';
import logger from '../utils/logger';

const DEFAULT_STDERR_TAIL_BYTES = 2048;
const STOP_EXIT_TIMEOUT_MS = 3000;

type ExitListener = (exit: CodexAppServerProcessExit) => void;
type LineListener = (line: string) => void;
type LoggerLike = Pick<typeof logger, 'info' | 'warn' | 'error'>;
type TaskKill = (pid: number | undefined) => Promise<void>;
type SpawnFactory = (
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    stdio: ['pipe', 'pipe', 'pipe'];
  },
) => AppServerProcessHandle;

type ReadableLike = NodeJS.ReadableStream & {
  on(event: 'data', listener: (chunk: Buffer) => void): unknown;
};

type AppServerProcessHandle = Pick<
  ChildProcessWithoutNullStreams,
  'stdin' | 'stdout' | 'stderr' | 'pid' | 'exitCode' | 'signalCode' | 'kill'
> & {
  stdout: NodeJS.ReadableStream;
  stderr: ReadableLike;
  on(event: 'error', listener: (error: Error) => void): AppServerProcessHandle;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): AppServerProcessHandle;
  once(event: 'error', listener: (error: Error) => void): AppServerProcessHandle;
};

export interface CodexAppServerProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stderrTailBytes?: number;
  stopExitTimeoutMs?: number;
  spawnTarget?: CodexAppServerSpawnTarget;
  spawnFactory?: SpawnFactory;
  taskKill?: TaskKill;
  logger?: LoggerLike;
}

export interface CodexAppServerProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class CodexAppServerProcess {
  private readonly cwd?: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly stderrTailBytes: number;
  private readonly stopExitTimeoutMs: number;
  private readonly spawnTarget?: CodexAppServerSpawnTarget;
  private readonly spawnFactory: SpawnFactory;
  private readonly taskKill: TaskKill;
  private readonly processLogger: LoggerLike;
  private readonly lineListeners = new Set<LineListener>();
  private readonly exitListeners = new Set<ExitListener>();
  private readonly stderrChunks: Buffer[] = [];

  private child: AppServerProcessHandle | null = null;
  private readlineInterface: readline.Interface | null = null;
  private exitPromise: Promise<CodexAppServerProcessExit> | null = null;
  private resolvedExit: CodexAppServerProcessExit | null = null;
  private stopping = false;

  constructor(options: CodexAppServerProcessOptions = {}) {
    this.cwd = options.cwd;
    this.env = options.env;
    this.stderrTailBytes = options.stderrTailBytes ?? DEFAULT_STDERR_TAIL_BYTES;
    this.stopExitTimeoutMs = options.stopExitTimeoutMs ?? STOP_EXIT_TIMEOUT_MS;
    this.spawnTarget = options.spawnTarget;
    this.spawnFactory = options.spawnFactory ?? defaultSpawnFactory;
    this.taskKill = options.taskKill ?? runTaskKill;
    this.processLogger = options.logger ?? logger;
  }

  get stdin(): NodeJS.WritableStream {
    if (!this.child?.stdin) {
      throw new Error('Codex app-server process has not been started.');
    }

    return this.child.stdin;
  }

  start(): void {
    if (this.child) {
      throw new Error('Codex app-server process is already running.');
    }

    const spawnTarget = this.spawnTarget ?? resolveCodexAppServerSpawnTarget();
    const child = this.spawnFactory(spawnTarget.command, spawnTarget.args, {
      cwd: this.cwd,
      env: this.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child = child;
    this.stopping = false;
    this.stderrChunks.length = 0;
    this.resolvedExit = null;
    let settleExit: ((exit: CodexAppServerProcessExit) => void) | null = null;
    let exitFinalized = false;
    this.exitPromise = new Promise<CodexAppServerProcessExit>((resolve) => {
      settleExit = resolve;
      child.once('exit', (code, signal) => {
        finalizeExit({ code, signal });
      });
    });

    const finalizeExit = (exit: CodexAppServerProcessExit, error?: Error) => {
      if (exitFinalized) {
        return;
      }

      exitFinalized = true;
      this.resolvedExit = exit;
      if (error) {
        this.processLogger.error('[CodexAppServerProcess] app-server process error', {
          error,
          stopping: this.stopping,
          stderrTail: this.getStderrTail(),
        });
      } else {
        this.processLogger.info('[CodexAppServerProcess] app-server exited', {
          code: exit.code,
          signal: exit.signal,
          stopping: this.stopping,
          stderrTail: this.getStderrTail(),
        });
      }
      this.cleanupProcessHandles();
      for (const listener of this.exitListeners) {
        listener(exit);
      }
      settleExit?.(exit);
    };

    this.readlineInterface = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    this.readlineInterface.on('line', (line) => {
      for (const listener of this.lineListeners) {
        listener(line);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this.pushStderrChunk(chunk);
    });

    child.on('error', (error) => {
      finalizeExit({ code: child.exitCode, signal: child.signalCode }, error);
    });

    this.processLogger.info('[CodexAppServerProcess] started app-server', {
      pid: child.pid,
      cwd: this.cwd,
      launchDescription: spawnTarget.launchDescription,
    });
  }

  async stop(): Promise<CodexAppServerProcessExit | null> {
    if (!this.child) {
      return this.resolvedExit;
    }

    const child = this.child;
    const exitPromise = this.exitPromise;
    this.stopping = true;

    child.stdin.end();

    if (!exitPromise) {
      return null;
    }

    if (await waitForPromise(exitPromise, this.stopExitTimeoutMs)) {
      return this.resolvedExit;
    }

    if (child.exitCode === null && child.signalCode === null) {
      if (process.platform === 'win32') {
        await this.taskKill(child.pid);
        if (await waitForPromise(exitPromise, this.stopExitTimeoutMs)) {
          return this.resolvedExit;
        }

        child.kill('SIGTERM');
        if (await waitForPromise(exitPromise, this.stopExitTimeoutMs)) {
          return this.resolvedExit;
        }

        child.kill('SIGKILL');
        if (await waitForPromise(exitPromise, this.stopExitTimeoutMs)) {
          return this.resolvedExit;
        }

        throw new Error(buildStopTimeoutMessage(child.pid, this.getStderrTail()));
      } else {
        child.kill('SIGTERM');
        if (await waitForPromise(exitPromise, this.stopExitTimeoutMs)) {
          return this.resolvedExit;
        }
        child.kill('SIGKILL');
      }
    }

    if (await waitForPromise(exitPromise, this.stopExitTimeoutMs)) {
      return this.resolvedExit;
    }

    throw new Error(buildStopTimeoutMessage(child.pid, this.getStderrTail()));
  }

  onExit(listener?: ExitListener): Promise<CodexAppServerProcessExit> {
    if (listener) {
      this.exitListeners.add(listener);
    }

    if (this.resolvedExit) {
      return Promise.resolve(this.resolvedExit);
    }

    if (!this.exitPromise) {
      return Promise.reject(new Error('Codex app-server process has not been started.'));
    }

    return this.exitPromise;
  }

  onLine(listener: LineListener): () => void {
    this.lineListeners.add(listener);
    return () => {
      this.lineListeners.delete(listener);
    };
  }

  getStderrTail(): string {
    return Buffer.concat(this.stderrChunks).toString('utf8').trim();
  }

  private cleanupProcessHandles(): void {
    this.readlineInterface?.close();
    this.readlineInterface = null;
    this.child = null;
    this.exitPromise = null;
    this.stopping = false;
  }

  private pushStderrChunk(chunk: Buffer): void {
    this.stderrChunks.push(Buffer.from(chunk));

    let totalLength = 0;
    for (let index = this.stderrChunks.length - 1; index >= 0; index -= 1) {
      totalLength += this.stderrChunks[index].length;
      if (totalLength <= this.stderrTailBytes) {
        continue;
      }

      const overflow = totalLength - this.stderrTailBytes;
      this.stderrChunks[index] = this.stderrChunks[index].subarray(overflow);
      this.stderrChunks.splice(0, index);
      return;
    }
  }
}

function defaultSpawnFactory(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env: NodeJS.ProcessEnv;
    stdio: ['pipe', 'pipe', 'pipe'];
  },
): AppServerProcessHandle {
  return spawn(command, args, options);
}

async function runTaskKill(pid: number | undefined): Promise<void> {
  if (!pid) {
    return;
  }

  await new Promise<void>((resolve) => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
  });
}

async function waitForPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  return await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
}

function buildStopTimeoutMessage(pid: number | undefined, stderrTail: string): string {
  const baseMessage = `Codex app-server process did not exit after stop attempts${pid ? ` (pid=${pid})` : ''}.`;
  if (!stderrTail) {
    return baseMessage;
  }

  return `${baseMessage} stderr tail: ${stderrTail}`;
}
