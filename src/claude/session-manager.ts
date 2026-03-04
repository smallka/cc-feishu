import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import { ClaudeWsServer } from './ws-server';
import { CLIBridge } from './bridge';
import { CLILauncher } from './launcher';
import {
  getSessionId, setSessionId, removeSessionId,
  getCurrentCwd, setCurrentCwd, getAllCwds,
} from './session-store';
import { scanSessions, SessionSummary } from './session-scanner';
import messageService from '../services/message.service';
import { StreamingCard } from '../services/streaming-card';
import config from '../config';

interface Session {
  chatId: string;
  sessionId: string;
  cwd: string;
  bridge: CLIBridge;
  launcher: CLILauncher;
  lastActiveTime: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>(); // chatId -> active Session
  private streamingCards = new Map<string, StreamingCard>(); // chatId -> active StreamingCard
  private pendingCallbacks = new Map<string, () => void>(); // chatId -> onDone callback
  private wsServer: ClaudeWsServer;
  private wsPort: number;
  private defaultCwd: string;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private idleCleanupTimer: NodeJS.Timeout | null = null;

  constructor(wsPort: number) {
    this.wsPort = wsPort;
    this.defaultCwd = config.claude.workRoot;
    this.wsServer = new ClaudeWsServer(wsPort);

    this.wsServer.onCLIConnect((sessionId, ws) => {
      const session = this.findBySessionId(sessionId);
      if (session) {
        session.bridge.attachSocket(ws);
      }
    });

    this.wsServer.onCLIMessage((sessionId, data) => {
      const session = this.findBySessionId(sessionId);
      if (session) {
        session.bridge.handleCLIData(data);
      }
    });

    this.wsServer.onCLIClose((sessionId) => {
      const session = this.findBySessionId(sessionId);
      if (session) {
        session.bridge.detachSocket();
      }
    });
  }

  async start(): Promise<void> {
    await this.wsServer.start();
    this.startHealthCheck();
    this.startIdleCleanup();
  }

  getCwd(chatId: string): string {
    return getCurrentCwd(chatId) ?? this.defaultCwd;
  }

  async sendMessage(chatId: string, text: string, onDone?: () => void): Promise<void> {
    const cwd = this.getCwd(chatId);
    const session = this.getOrCreateSession(chatId, cwd);
    session.lastActiveTime = Date.now(); // 更新活跃时间
    if (onDone) {
      this.pendingCallbacks.set(chatId, onDone);
    }
    session.bridge.sendUserMessage(text);
  }

  async switchCwd(chatId: string, newCwd: string): Promise<void> {
    const card = this.streamingCards.get(chatId);
    if (card) {
      await card.close('(已切换工作目录)').catch(() => {});
      this.streamingCards.delete(chatId);
    }

    // 杀掉当前活跃的 CLI
    const current = this.sessions.get(chatId);
    if (current) {
      await current.launcher.kill();
      current.bridge.detachSocket();
      this.sessions.delete(chatId);
    }

    // 更新持久化的当前目录
    setCurrentCwd(chatId, newCwd, this.defaultCwd);

    // 立即启动新目录的 CLI
    this.getOrCreateSession(chatId, newCwd);
  }

  async resetSession(chatId: string): Promise<void> {
    const card = this.streamingCards.get(chatId);
    if (card) {
      await card.close('(会话已重置)').catch(() => {});
      this.streamingCards.delete(chatId);
    }

    const cwd = this.getCwd(chatId);
    const session = this.sessions.get(chatId);
    if (session) {
      await session.launcher.kill();
      session.bridge.detachSocket();
      this.sessions.delete(chatId);
    }
    removeSessionId(chatId, cwd);
    logger.info('Session reset', { chatId, cwd });
  }

  getSessionInfo(chatId: string): string {
    const cwd = this.getCwd(chatId);
    const session = this.sessions.get(chatId);
    const storedId = getSessionId(chatId, cwd);
    const cwdLine = `工作目录: ${cwd}`;
    if (!session && !storedId) return `${cwdLine}\n当前没有活跃的 Claude Code 会话`;
    if (!session) return `${cwdLine}\n会话 ID: ${storedId}\n状态: 未运行（可恢复）`;
    const alive = session.launcher.isAlive();
    return `${cwdLine}\n会话 ID: ${session.sessionId}\n状态: ${alive ? '运行中' : '已断开'}`;
  }

  listCwds(chatId: string): string[] {
    return getAllCwds(chatId);
  }

  listResumableSessions(chatId: string): SessionSummary[] {
    const cwd = this.getCwd(chatId);
    const currentSessionId = this.sessions.get(chatId)?.sessionId
      ?? getSessionId(chatId, cwd);
    return scanSessions(cwd).filter(s => s.sessionId !== currentSessionId);
  }

  async resumeSession(chatId: string, sessionId: string): Promise<boolean> {
    const card = this.streamingCards.get(chatId);
    if (card) {
      await card.close('(正在恢复会话)').catch(() => {});
      this.streamingCards.delete(chatId);
    }

    const current = this.sessions.get(chatId);
    if (current) {
      await current.launcher.kill();
      current.bridge.detachSocket();
      this.sessions.delete(chatId);
    }

    const cwd = this.getCwd(chatId);
    // 更新 store 映射，使 getOrCreateSession 能以 resume 模式启动
    setSessionId(chatId, cwd, sessionId, this.defaultCwd);
    const session = this.getOrCreateSession(chatId, cwd);

    try {
      await session.bridge.waitForInit();
      return true;
    } catch {
      return false;
    }
  }

  private getOrCreateSession(chatId: string, cwd: string): Session {
    let session = this.sessions.get(chatId);
    if (session && session.cwd === cwd && session.launcher.isAlive()) {
      return session;
    }

    // 清理旧的内存 session（cwd 不同或进程已死）
    if (session) {
      session.launcher.kill().catch(() => {});
      this.sessions.delete(chatId);
    }

    const storedSessionId = getSessionId(chatId, cwd);
    const sessionId = storedSessionId ?? randomUUID();
    const resume = !!storedSessionId;

    const bridge = new CLIBridge(sessionId);
    const launcher = new CLILauncher(sessionId);

    // 进程退出时清理流式卡片
    launcher.onExit(() => {
      const card = this.streamingCards.get(chatId);
      if (card) {
        card.close('(CLI 进程已退出)').catch(() => {});
        this.streamingCards.delete(chatId);
        logger.info('Streaming card closed due to CLI exit', { chatId, sessionId });
      }
    });

    if (config.streaming.enabled) {
      bridge.setOnPartialText(async (accumulatedText) => {
        let card = this.streamingCards.get(chatId);
        if (!card) {
          // 先占位防止并发重入创建多张卡片
          card = new StreamingCard(chatId);
          this.streamingCards.set(chatId, card);
          const ok = await card.start();
          if (!ok) {
            this.streamingCards.delete(chatId);
            return; // 创建失败，onResponse 时降级为纯文本
          }
        }
        card.update(accumulatedText);
      });

      bridge.setOnResponse((text) => {
        const callback = this.pendingCallbacks.get(chatId);
        this.pendingCallbacks.delete(chatId);
        if (callback) callback();

        const card = this.streamingCards.get(chatId);
        this.streamingCards.delete(chatId);

        if (card) {
          card.close(text).catch(err => {
            logger.error('Failed to close streaming card, fallback to text', { chatId, error: err.message });
            this.sendPlainText(chatId, text);
          });
        } else {
          this.sendPlainText(chatId, text);
        }
      });
    } else {
      bridge.setOnResponse((text) => {
        const callback = this.pendingCallbacks.get(chatId);
        this.pendingCallbacks.delete(chatId);
        if (callback) callback();

        this.sendPlainText(chatId, text);
      });
    }

    launcher.onExit((code) => {
      if (!bridge.isInitialized()) {
        bridge.rejectInit('CLI exited before init');
        if (resume) {
          logger.warn('Resume failed, clearing stored session', { chatId, sessionId, cwd, code });
          removeSessionId(chatId, cwd);
        } else {
          logger.error('CLI failed to start', { chatId, sessionId, cwd, code });
        }
      }
    });

    launcher.start({ wsPort: this.wsPort, resume, cwd });

    if (!resume) {
      setSessionId(chatId, cwd, sessionId, this.defaultCwd);
    }

    session = { chatId, sessionId, cwd, bridge, launcher, lastActiveTime: Date.now() };
    this.sessions.set(chatId, session);
    logger.info(resume ? 'Resuming session' : 'New session created', { chatId, sessionId, cwd });
    return session;
  }

  private sendPlainText(chatId: string, text: string): void {
    const MAX_LEN = 4000;
    if (text.length <= MAX_LEN) {
      messageService.sendTextMessage(chatId, text).catch(err => {
        logger.error('Failed to send response', { chatId, error: err.message });
      });
    } else {
      this.sendLongMessage(chatId, text, MAX_LEN);
    }
  }

  private async sendLongMessage(chatId: string, text: string, maxLen: number) {
    for (let i = 0; i < text.length; i += maxLen) {
      const chunk = text.slice(i, i + maxLen);
      try {
        await messageService.sendTextMessage(chatId, chunk);
      } catch (err: any) {
        logger.error('Failed to send chunk', { chatId, error: err.message });
      }
    }
  }

  private findBySessionId(sessionId: string): Session | undefined {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) return session;
    }
    return undefined;
  }

  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    const interval = config.claude.healthCheckInterval;
    this.healthCheckTimer = setInterval(() => {
      this.checkCliHealth();
    }, interval);

    logger.debug('CLI health check started', { interval });
  }

  private checkCliHealth(): void {
    const inactiveTimeout = config.claude.inactiveTimeout;
    const now = Date.now();

    for (const [chatId, session] of this.sessions.entries()) {
      if (!session.bridge.isHealthy(inactiveTimeout)) {
        const timeSinceLastResponse = now - session.bridge.getLastResponseTime();
        logger.warn('CLI inactive detected', {
          chatId,
          sessionId: session.sessionId,
          timeSinceLastResponse,
          inactiveTimeout,
        });

        // 超过阈值，判定为僵死
        if (timeSinceLastResponse > inactiveTimeout) {
          logger.error('CLI process appears dead', {
            chatId,
            sessionId: session.sessionId,
            timeSinceLastResponse,
          });

          // 清理僵死会话
          this.cleanupDeadSession(chatId, session).catch(err => {
            logger.error('Failed to cleanup dead session', { chatId, error: err });
          });
        }
      }
    }
  }

  private async cleanupDeadSession(chatId: string, session: Session): Promise<void> {
    // 关闭流式卡片
    const card = this.streamingCards.get(chatId);
    if (card) {
      await card.close('(CLI 进程无响应)').catch(() => {});
      this.streamingCards.delete(chatId);
    }

    // 终止进程
    await session.launcher.kill();

    // 移除会话
    this.sessions.delete(chatId);

    // 发送通知
    await messageService.sendTextMessage(
      chatId,
      '⚠️ CLI 进程无响应已自动清理，请使用 /new 重新开始会话。'
    ).catch(err => {
      logger.error('Failed to send dead session notification', { chatId, error: err });
    });

    logger.info('Dead session cleaned up', {
      chatId,
      sessionId: session.sessionId,
    });
  }

  private startIdleCleanup(): void {
    if (this.idleCleanupTimer) {
      clearInterval(this.idleCleanupTimer);
    }

    const interval = config.claude.idleCleanupInterval;
    this.idleCleanupTimer = setInterval(() => {
      this.cleanupIdleSessions();
    }, interval);

    logger.debug('Idle session cleanup started', { interval });
  }

  private async cleanupIdleSessions(): Promise<void> {
    const idleTimeout = config.claude.idleTimeout;
    const now = Date.now();

    for (const [chatId, session] of this.sessions.entries()) {
      const idleTime = now - session.lastActiveTime;

      if (idleTime > idleTimeout) {
        logger.info('Cleaning up idle session', {
          chatId,
          sessionId: session.sessionId,
          idleTime,
          idleTimeout,
        });

        // 可选：发送通知
        if (config.claude.notifyBeforeCleanup) {
          await messageService.sendTextMessage(
            chatId,
            `💤 会话已空闲 ${Math.round(idleTime / 60000)} 分钟，自动清理。使用 /resume 可恢复历史会话。`
          ).catch(err => {
            logger.warn('Failed to send idle cleanup notification', { chatId, error: err });
          });
        }

        // 关闭流式卡片
        const card = this.streamingCards.get(chatId);
        if (card) {
          await card.close('(会话空闲已清理)').catch(() => {});
          this.streamingCards.delete(chatId);
        }

        // 终止进程
        await session.launcher.kill();

        // 移除会话（保留 session-store 记录）
        this.sessions.delete(chatId);

        logger.info('Idle session cleaned up', {
          chatId,
          sessionId: session.sessionId,
        });
      }
    }
  }

  async closeStreamingCard(chatId: string): Promise<void> {
    const card = this.streamingCards.get(chatId);
    if (card) {
      await card.close('(处理中断)').catch(() => {});
      this.streamingCards.delete(chatId);
    }
  }

  async restartAllSessions(): Promise<string[]> {
    const affectedChats: string[] = [];

    for (const [chatId, session] of this.sessions.entries()) {
      affectedChats.push(chatId);

      // 关闭流式卡片
      await this.closeStreamingCard(chatId);

      // 杀掉 CLI 进程
      await session.launcher.kill();

      logger.info('Session restarted for model change', {
        chatId,
        sessionId: session.sessionId,
        cwd: session.cwd,
      });
    }

    // 清空会话映射，下次消息时会自动重建
    this.sessions.clear();

    return affectedChats;
  }

  async stop(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.idleCleanupTimer) {
      clearInterval(this.idleCleanupTimer);
      this.idleCleanupTimer = null;
    }

    for (const [, card] of this.streamingCards) {
      await card.close('(服务关闭)').catch(() => {});
    }
    this.streamingCards.clear();

    for (const session of this.sessions.values()) {
      await session.launcher.kill();
    }
    this.sessions.clear();
    this.wsServer.stop();
  }
}
