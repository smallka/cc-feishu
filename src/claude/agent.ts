import logger from '../utils/logger';
import { CLILauncher } from './launcher';
import { CLIBridge } from './bridge';

export type OnResponseCallback = (text: string) => void;
export type OnErrorCallback = (error: Error) => void;

let agentCounter = 0;

export class Agent {
  private readonly agentId: string;
  private readonly chatId: string;
  private readonly cwd: string;
  private readonly launcher: CLILauncher;
  private readonly bridge: CLIBridge;
  private readonly startTime: number;
  private destroyed = false;
  private onResponseCallback: OnResponseCallback | null = null;
  private onErrorCallback: OnErrorCallback | null = null;

  constructor(chatId: string, cwd: string, resumeSessionId?: string) {
    this.agentId = `agent${++agentCounter}`;
    this.chatId = chatId;
    this.cwd = cwd;
    this.startTime = Date.now();

    logger.info('[Agent] Creating agent', {
      chatId,
      agentId: this.agentId,
      sessionId: resumeSessionId,
      cwd,
      isResume: !!resumeSessionId,
    });

    // 创建 launcher 和 bridge
    this.launcher = new CLILauncher(this.agentId);
    this.bridge = new CLIBridge(this.agentId, resumeSessionId);

    // 设置 bridge 回调
    this.bridge.setOnResponse((text) => {
      logger.info('[Agent] Received response', {
        chatId: this.chatId,
        agentId: this.agentId,
        textLength: text.length,
      });
      if (this.onResponseCallback) {
        this.onResponseCallback(text);
      }
    });

    // 监听进程退出
    this.launcher.onExit((code) => {
      logger.info('[Agent] CLI process exited', {
        chatId: this.chatId,
        agentId: this.agentId,
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
    this.launcher.start(cwd, resumeSessionId);

    // 连接 bridge
    const process = this.launcher.getProcess();
    if (process) {
      this.bridge.attachProcess(process);
    } else {
      const error = new Error('Failed to start CLI process');
      this.destroy(error).catch(() => {});
    }
  }

  async sendMessage(text: string, onComplete?: () => Promise<void>): Promise<void> {
    if (this.destroyed) {
      logger.warn('[Agent] Cannot send message, agent destroyed', {
        chatId: this.chatId,
        agentId: this.agentId,
      });
      return;
    }

    logger.info('[Agent] Sending message', {
      chatId: this.chatId,
      agentId: this.agentId,
      messageLength: text.length,
    });

    try {
      await this.bridge.waitForInit();
    } catch (err) {
      await this.destroy(err as Error);
      throw err;
    }

    this.bridge.sendUserMessage(text, onComplete);
  }

  interrupt(): boolean {
    if (this.destroyed) {
      logger.warn('[Agent] Cannot interrupt, agent destroyed', {
        chatId: this.chatId,
        agentId: this.agentId,
      });
      return false;
    }

    logger.info('[Agent] Interrupting', {
      chatId: this.chatId,
      agentId: this.agentId,
    });

    return this.bridge.sendInterrupt();
  }

  async destroy(error?: Error): Promise<void> {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;

    logger.info('[Agent] Destroying agent', {
      chatId: this.chatId,
      agentId: this.agentId,
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

  getSessionId(): string | undefined {
    return this.bridge.getSessionId();
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

  getStartTime(): number {
    return this.startTime;
  }

  getPid(): number | undefined {
    return this.launcher.getProcess()?.pid;
  }
}
