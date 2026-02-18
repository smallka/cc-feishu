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
}

export class SessionManager {
  private sessions = new Map<string, Session>(); // chatId -> active Session
  private streamingCards = new Map<string, StreamingCard>(); // chatId -> active StreamingCard
  private wsServer: ClaudeWsServer;
  private wsPort: number;
  private defaultCwd: string;

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
  }

  getCwd(chatId: string): string {
    return getCurrentCwd(chatId) ?? this.defaultCwd;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const cwd = this.getCwd(chatId);
    const session = this.getOrCreateSession(chatId, cwd);
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
        const card = this.streamingCards.get(chatId);
        this.streamingCards.delete(chatId);

        if (card && card.isActive()) {
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

    session = { chatId, sessionId, cwd, bridge, launcher };
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

  async stop(): Promise<void> {
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
