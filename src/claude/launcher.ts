import { spawn, ChildProcess } from 'child_process';
import logger from '../utils/logger';
import config from '../config';

export class CLILauncher {
  private process: ChildProcess | null = null;
  private exitCallbacks: Array<(code: number | null) => void> = [];
  private readonly agentId: string;

  constructor(agentId: string) {
    this.agentId = agentId;
  }

  getProcess(): ChildProcess | null {
    return this.process;
  }

  onExit(cb: (code: number | null) => void): void {
    this.exitCallbacks.push(cb);
  }

  start(cwd: string, resumeSessionId?: string): void {

    const args = [
      '--print',
      '--verbose',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--model', config.claude.model,
      '--permission-prompt-tool', 'stdio',
    ];

    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    }

    args.push('-p', '');

    logger.info('[CLILauncher] Spawning Claude Code CLI', { agentId: this.agentId, resume: !!resumeSessionId, cwd });

    // 清除 CLAUDECODE 环境变量，避免嵌套会话检测
    const env = { ...process.env };
    delete env.CLAUDECODE;

    this.process = spawn('claude', args, {
      cwd: cwd ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    this.process.stdout?.on('data', (_data: Buffer) => {
      // stdout 现在用于 NDJSON 通信，不再记录日志
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) logger.debug('[CLILauncher] CLI stderr', { agentId: this.agentId, text });
    });

    this.process.on('exit', (code) => {
      logger.info('[CLILauncher] CLI process exited', { agentId: this.agentId, code });
      this.process = null;
      // 触发所有退出回调
      for (const cb of this.exitCallbacks) {
        try {
          cb(code);
        } catch (err) {
          logger.error('[CLILauncher] Error in exit callback', { agentId: this.agentId, error: err });
        }
      }
    });

    this.process.on('error', (err) => {
      logger.error('[CLILauncher] CLI process error', { agentId: this.agentId, error: err.message });
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

