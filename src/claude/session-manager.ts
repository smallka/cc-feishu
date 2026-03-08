import { randomUUID } from 'crypto';
import logger from '../utils/logger';
import { CLIBridge } from './bridge';
import { CLILauncher } from './launcher';
import {
  getLastCwd, getLastSessionId, setLastSession, clearLastSession,
} from '../bot/chat-store';
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
  private pendingCallbacks = new Map<string, () => void>(); // chatId -> onDone callback
  private defaultCwd: string;

  constructor() {
    this.defaultCwd = config.claude.workRoot;
  }

  async start(): Promise<void> {
    // 启动完成
  }

  getCwd(chatId: string): string {
    return getLastCwd(chatId) ?? this.defaultCwd;
  }

  async sendMessage(chatId: string, text: string, onDone?: () => void): Promise<void> {
    const cwd = this.getCwd(chatId);
    const session = this.getOrCreateSession(chatId, cwd);
    if (onDone) {
      this.pendingCallbacks.set(chatId, onDone);
    }
    session.bridge.sendUserMessage(text);
  }

  /**
   * 打断指定会话的当前任务
   * @returns 'success' | 'no_session' | 'not_running'
   */
  interruptSession(chatId: string): 'success' | 'no_session' | 'not_running' {
    const session = this.sessions.get(chatId);
    if (!session) {
      logger.warn('[SessionManager] Session not found, cannot interrupt', { chatId });
      return 'no_session';
    }

    if (!session.bridge.canInterrupt()) {
      logger.warn('[SessionManager] AI not running, cannot interrupt', {
        chatId,
        cliSessionId: session.sessionId,
      });
      return 'not_running';
    }

    const success = session.bridge.sendInterrupt();
    if (success) {
      logger.info('[SessionManager] Session interrupted', {
        chatId,
        cliSessionId: session.sessionId,
        cwd: session.cwd,
      });
      return 'success';
    }

    return 'not_running';
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
      logger.info('Switching cwd, killing current CLI session', {
        chatId,
        cliSessionId: current.sessionId,
        oldCwd: current.cwd,
        newCwd,
      });
      await current.launcher.kill();
      current.bridge.detachProcess();
      this.sessions.delete(chatId);
    }

    // 更新持久化
    setLastSession(chatId, newCwd, randomUUID());

    // 立即启动新目录的 CLI
    this.getOrCreateSession(chatId, newCwd);
  }

  async resetSession(chatId: string): Promise<void> {
    const card = this.streamingCards.get(chatId);
    if (card) {
      await card.close('(会话已重置)').catch(() => {});
      this.streamingCards.delete(chatId);
    }

    const session = this.sessions.get(chatId);
    if (session) {
      await session.launcher.kill();
      session.bridge.detachProcess();
      this.sessions.delete(chatId);
      clearLastSession(chatId);
      logger.info('CLI session reset', { chatId, cwd: session.cwd, cliSessionId: session.sessionId });
    } else {
      clearLastSession(chatId);
      logger.info('CLI session reset (no active session)', { chatId });
    }
  }

  getSessionInfo(chatId: string): string {
    const cwd = this.getCwd(chatId);
    const session = this.sessions.get(chatId);
    const storedId = getLastSessionId(chatId);
    const cwdLine = `工作目录: ${cwd}`;
    if (!session && !storedId) return `${cwdLine}\n当前没有活跃的 Claude Code 会话`;
    if (!session) return `${cwdLine}\n会话 ID: ${storedId}\n状态: 未运行（可恢复）`;
    const alive = session.launcher.isAlive();
    return `${cwdLine}\n会话 ID: ${session.sessionId}\n状态: ${alive ? '运行中' : '已断开'}`;
  }

  listCwds(chatId: string): string[] {
    const lastCwd = getLastCwd(chatId);
    return lastCwd ? [lastCwd] : [];
  }

  listResumableSessions(chatId: string): SessionSummary[] {
    const cwd = this.getCwd(chatId);
    const currentSessionId = this.sessions.get(chatId)?.sessionId
      ?? getLastSessionId(chatId);
    return scanSessions(cwd).filter(s => s.sessionId !== currentSessionId);
  }

  async resumeSession(chatId: string, cliSessionId: string): Promise<boolean> {
    const card = this.streamingCards.get(chatId);
    if (card) {
      await card.close('(正在恢复会话)').catch(() => {});
      this.streamingCards.delete(chatId);
    }

    const current = this.sessions.get(chatId);
    if (current) {
      logger.info('Resuming CLI session, killing current session', {
        chatId,
        oldCliSessionId: current.sessionId,
        newCliSessionId: cliSessionId,
        cwd: current.cwd,
      });
      await current.launcher.kill();
      current.bridge.detachProcess();
      this.sessions.delete(chatId);
    } else {
      logger.info('Resuming CLI session', {
        chatId,
        cliSessionId,
        cwd: this.getCwd(chatId),
      });
    }

    const cwd = this.getCwd(chatId);
    // 更新 store 映射，使 getOrCreateSession 能以 resume 模式启动
    setLastSession(chatId, cwd, cliSessionId);
    const session = this.getOrCreateSession(chatId, cwd);

    try {
      await session.bridge.waitForInit();
      logger.info('CLI session resumed successfully', { chatId, cliSessionId, cwd });
      return true;
    } catch (err) {
      logger.error('CLI session resume failed', { chatId, cliSessionId, cwd, error: err });
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

    const storedSessionId = getLastSessionId(chatId);
    const storedCwd = getLastCwd(chatId);
    // 只有当 cwd 匹配时才 resume
    const canResume = storedSessionId && storedCwd === cwd;
    const sessionId = canResume ? storedSessionId : randomUUID();
    const resume = !!canResume;

    const bridge = new CLIBridge(sessionId);
    const launcher = new CLILauncher(sessionId);

    // 进程退出时清理流式卡片
    launcher.onExit(() => {
      const card = this.streamingCards.get(chatId);
      if (card) {
        card.close('(CLI 进程已退出)').catch(() => {});
        this.streamingCards.delete(chatId);
        logger.info('Streaming card closed due to CLI exit', { chatId, cliSessionId: sessionId });
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
          logger.warn('Resume failed, clearing stored CLI session', { chatId, cliSessionId: sessionId, cwd, code });
          clearLastSession(chatId);
        } else {
          logger.error('CLI failed to start', { chatId, cliSessionId: sessionId, cwd, code });
        }
      }
    });

    launcher.start({ resume, cwd });

    // 启动后立即连接 bridge 和进程
    const process = launcher.getProcess();
    if (process) {
      bridge.attachProcess(process);
    }

    if (!resume) {
      setLastSession(chatId, cwd, sessionId);
    }

    session = { chatId, sessionId, cwd, bridge, launcher };
    this.sessions.set(chatId, session);
    logger.info(resume ? 'Resuming CLI session' : 'New CLI session created', { chatId, cliSessionId: sessionId, cwd });
    return session;
  }

  private sendPlainText(chatId: string, text: string): void {
    const MAX_LEN = 4000;
    const session = this.sessions.get(chatId);
    const cliSessionId = session?.sessionId;
    if (text.length <= MAX_LEN) {
      messageService.sendTextMessage(chatId, text).catch(err => {
        logger.error('Failed to send response', { chatId, cliSessionId, error: err.message });
      });
    } else {
      this.sendLongMessage(chatId, text, MAX_LEN);
    }
  }

  private async sendLongMessage(chatId: string, text: string, maxLen: number) {
    const session = this.sessions.get(chatId);
    const cliSessionId = session?.sessionId;
    for (let i = 0; i < text.length; i += maxLen) {
      const chunk = text.slice(i, i + maxLen);
      try {
        await messageService.sendTextMessage(chatId, chunk);
      } catch (err: any) {
        logger.error('Failed to send chunk', { chatId, cliSessionId, error: err.message });
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

      logger.info('CLI session restarted for model change', {
        chatId,
        cliSessionId: session.sessionId,
        cwd: session.cwd,
      });
    }

    // 清空会话映射，下次消息时会自动重建
    this.sessions.clear();

    return affectedChats;
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
  }
}
