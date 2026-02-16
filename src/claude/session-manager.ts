import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import { ClaudeWsServer } from './ws-server';
import { CLIBridge } from './bridge';
import { CLILauncher } from './launcher';
import { getSessionId, setSessionId, removeSessionId } from './session-store';
import messageService from '../services/message.service';

interface Session {
  chatId: string;
  sessionId: string;
  bridge: CLIBridge;
  launcher: CLILauncher;
}

export class SessionManager {
  private sessions = new Map<string, Session>(); // chatId -> Session
  private wsServer: ClaudeWsServer;
  private wsPort: number;

  constructor(wsPort: number) {
    this.wsPort = wsPort;
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

  async sendMessage(chatId: string, text: string): Promise<void> {
    const session = this.getOrCreateSession(chatId);
    session.bridge.sendUserMessage(text);
  }

  async resetSession(chatId: string): Promise<void> {
    const session = this.sessions.get(chatId);
    if (session) {
      await session.launcher.kill();
      session.bridge.detachSocket();
      this.sessions.delete(chatId);
    }
    removeSessionId(chatId);
    logger.info('Session reset', { chatId });
  }

  getSessionInfo(chatId: string): string {
    const session = this.sessions.get(chatId);
    const storedId = getSessionId(chatId);
    if (!session && !storedId) return '当前没有活跃的 Claude Code 会话';
    if (!session) return `会话 ID: ${storedId}\n状态: 未运行（可恢复）`;
    const alive = session.launcher.isAlive();
    return `会话 ID: ${session.sessionId}\n状态: ${alive ? '运行中' : '已断开'}`;
  }

  private getOrCreateSession(chatId: string): Session {
    let session = this.sessions.get(chatId);
    if (session && session.launcher.isAlive()) {
      return session;
    }

    // 清理旧的内存 session
    if (session) {
      session.launcher.kill().catch(() => {});
      this.sessions.delete(chatId);
    }

    // 检查持久化存储，决定 resume 还是新建
    const storedSessionId = getSessionId(chatId);
    const sessionId = storedSessionId ?? randomUUID();
    const resume = !!storedSessionId;

    const bridge = new CLIBridge(sessionId);
    const launcher = new CLILauncher(sessionId);

    bridge.setOnResponse((text) => {
      const MAX_LEN = 4000;
      if (text.length <= MAX_LEN) {
        messageService.sendTextMessage(chatId, text).catch(err => {
          logger.error('Failed to send response', { chatId, error: err.message });
        });
      } else {
        this.sendLongMessage(chatId, text, MAX_LEN);
      }
    });

    // CLI 未初始化就退出时，区分 resume 失败和其他启动错误
    launcher.onExit((code) => {
      if (!bridge.isInitialized()) {
        if (resume) {
          logger.warn('Resume failed, clearing stored session', { chatId, sessionId, code });
          removeSessionId(chatId);
        } else {
          logger.error('CLI failed to start', { chatId, sessionId, code });
        }
      }
    });

    launcher.start({ wsPort: this.wsPort, resume });

    if (!resume) {
      setSessionId(chatId, sessionId);
    }

    session = { chatId, sessionId, bridge, launcher };
    this.sessions.set(chatId, session);
    logger.info(resume ? 'Resuming session' : 'New session created', { chatId, sessionId });
    return session;
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
    for (const session of this.sessions.values()) {
      await session.launcher.kill();
    }
    this.sessions.clear();
    this.wsServer.stop();
  }
}
