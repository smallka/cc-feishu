import { spawn, ChildProcess } from 'child_process';
import logger from '../utils/logger';

export interface LaunchOptions {
  wsPort: number;
  resume?: boolean;
  cwd?: string;
}

export class CLILauncher {
  private process: ChildProcess | null = null;
  private exitCallback: ((code: number | null) => void) | null = null;
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCallback = cb;
  }

  start(options: LaunchOptions): void {
    const { wsPort, resume, cwd } = options;
    const sdkUrl = `ws://localhost:${wsPort}/ws/cli/${this.sessionId}`;

    const args = [
      '--sdk-url', sdkUrl,
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
    ];

    if (resume) {
      args.push('--resume', this.sessionId);
    } else {
      args.push('--session-id', this.sessionId);
    }

    args.push('-p', '');

    logger.info('Spawning Claude Code CLI', { sessionId: this.sessionId, resume: !!resume, sdkUrl });

    // 清除 CLAUDECODE 环境变量，避免嵌套会话检测
    const env = { ...process.env };
    delete env.CLAUDECODE;

    this.process = spawn('claude', args, {
      cwd: cwd ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) logger.debug('CLI stdout', { sessionId: this.sessionId, text });
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) logger.debug('CLI stderr', { sessionId: this.sessionId, text });
    });

    this.process.on('exit', (code) => {
      logger.info('CLI process exited', { sessionId: this.sessionId, code });
      this.process = null;
      this.exitCallback?.(code);
    });

    this.process.on('error', (err) => {
      logger.error('CLI process error', { sessionId: this.sessionId, error: err.message });
    });
  }

  isAlive(): boolean {
    return this.process !== null && !this.process.killed;
  }

  kill(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }
      this.process.on('exit', () => resolve());
      this.process.kill('SIGTERM');
      // 5 秒后强制 kill
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);
    });
  }
}
