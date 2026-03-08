import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import { CLILauncher } from './launcher';
import { CLIBridge } from './bridge';

export type OnResponseCallback = (text: string) => void;
export type OnErrorCallback = (error: Error) => void;

export class Agent {
  private readonly agentId: string;
  private readonly cwd: string;
  private readonly sessionId: string;
  private readonly launcher: CLILauncher;
  private readonly bridge: CLIBridge;
  private destroyed = false;
  private onResponseCallback: OnResponseCallback | null = null;
  private onErrorCallback: OnErrorCallback | null = null;

  constructor(cwd: string, resumeSessionId?: string) {
    this.agentId = randomUUID();
    this.cwd = cwd;
    this.sessionId = resumeSessionId || randomUUID();

    logger.info('[Agent] Creating agent', {
      agentId: this.agentId,
      sessionId: this.sessionId,
      cwd,
      isResume: !!resumeSessionId,
      operation: 'create'
    });

    // 创建 launcher 和 bridge
    this.launcher = new CLILauncher(this.sessionId);
    this.bridge = new CLIBridge(this.sessionId);

    // 设置 bridge 回调
    this.bridge.setOnResponse((text) => {
      logger.debug('[Agent] Received response', {
        agentId: this.agentId,
        sessionId: this.sessionId,
        textLength: text.length,
      });
      if (this.onResponseCallback) {
        this.onResponseCallback(text);
      }
    });

    // 监听进程退出
    this.launcher.onExit((code) => {
      logger.info('[Agent] CLI process exited', {
        agentId: this.agentId,
        sessionId: this.sessionId,
        code,
        wasDestroyed: this.destroyed
      });

      if (this.destroyed) {
        return;
      }

      const error = new Error(`CLI process exited unexpectedly with code ${code}`);
      this.destroy(error).catch(() => {});
    });

    // 启动 CLI 进程
    this.launcher.start({ cwd, resume: !!resumeSessionId });

    // 连接 bridge
    const process = this.launcher.getProcess();
    if (process) {
      this.bridge.attachProcess(process);
    } else {
      const error = new Error('Failed to start CLI process');
      this.destroy(error).catch(() => {});
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (this.destroyed) {
      logger.warn('[Agent] Cannot send message, agent destroyed', {
        agentId: this.agentId,
        sessionId: this.sessionId,
      });
      return;
    }

    logger.debug('[Agent] Sending message', {
      agentId: this.agentId,
      sessionId: this.sessionId,
      messageLength: text.length,
      operation: 'send'
    });

    try {
      await this.bridge.waitForInit();
    } catch (err) {
      await this.destroy(err as Error);
      throw err;
    }

    this.bridge.sendUserMessage(text);
  }

  interrupt(): boolean {
    if (this.destroyed) {
      logger.warn('[Agent] Cannot interrupt, agent destroyed', {
        agentId: this.agentId,
        sessionId: this.sessionId,
      });
      return false;
    }

    logger.info('[Agent] Interrupting', {
      agentId: this.agentId,
      sessionId: this.sessionId,
      operation: 'interrupt'
    });

    return this.bridge.sendInterrupt();
  }

  async destroy(error?: Error): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    logger.info('[Agent] Destroying agent', {
      agentId: this.agentId,
      sessionId: this.sessionId,
      hasError: !!error,
      error: error?.message,
    });

    // 如果有错误，触发 onError 回调
    if (error && this.onErrorCallback) {
      try {
        this.onErrorCallback(error);
      } catch (err) {
        logger.error('[Agent] Error in onError callback', {
          agentId: this.agentId,
          error: err,
        });
      }
    }

    // 拒绝所有等待中的 init Promise
    this.bridge.rejectInit('Agent destroyed');

    // 分离 bridge
    this.bridge.detachProcess();

    // 杀掉进程
    await this.launcher.kill();
  }

  getAgentId(): string {
    return this.agentId;
  }

  getCwd(): string {
    return this.cwd;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  isAlive(): boolean {
    return !this.destroyed && this.launcher.isAlive();
  }

  onResponse(callback: OnResponseCallback): void {
    this.onResponseCallback = callback;
  }

  onError(callback: OnErrorCallback): void {
    this.onErrorCallback = callback;
  }
}
