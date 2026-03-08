import logger from '../utils/logger';
import messageService from '../services/message.service';
import { Agent } from '../claude/agent';
import config from '../config';

interface ChatData {
  cwd: string;
  sessionId: string | undefined;
  expectedSessionId?: string;
  sessionNotified?: boolean;
}

export class ChatManager {
  private store: Map<string, ChatData> = new Map();
  private agents = new Map<string, Agent>();
  private defaultCwd: string;
  private responseCompleteCallback: (() => void) | null = null;

  constructor() {
    this.defaultCwd = config.claude.workRoot;
  }

  async start(): Promise<void> {
    logger.info('[ChatManager] Started');
  }

  onResponseComplete(callback: () => void): void {
    this.responseCompleteCallback = callback;
  }


  async sendMessage(chatId: string, text: string): Promise<void> {
    const agent = this.getOrCreateAgent(chatId);
    logger.debug('[ChatManager] Sending message', {
      chatId,
      agentId: agent.getAgentId(),
      sessionId: agent.getSessionId(),
      messageLength: text.length
    });
    await agent.sendMessage(text);
  }

  interrupt(chatId: string): 'success' | 'no_session' | 'not_running' {
    const agent = this.agents.get(chatId);
    if (!agent) {
      logger.warn('[ChatManager] No agent to interrupt', { chatId });
      return 'no_session';
    }
    const result = agent.interrupt() ? 'success' : 'not_running';
    logger.info('[ChatManager] Interrupt result', { chatId, agentId: agent.getAgentId(), result });
    return result;
  }

  async switchCwd(chatId: string, newCwd: string): Promise<void> {
    const data = this.store.get(chatId);
    const currentCwd = data?.cwd ?? this.defaultCwd;
    if (currentCwd === newCwd) {
      logger.debug('[ChatManager] Cwd unchanged, skipping switch', { chatId, cwd: newCwd });
      return;
    }
    const agent = this.agents.get(chatId);
    if (agent) {
      await agent.destroy();
      this.agents.delete(chatId);
    }
    this.store.delete(chatId);
    this.store.set(chatId, { cwd: newCwd, sessionId: undefined });
    logger.info('[ChatManager] Switched cwd', { chatId, oldCwd: currentCwd, newCwd });
  }

  async reset(chatId: string): Promise<string> {
    const agent = this.agents.get(chatId);
    if (agent) {
      await agent.destroy();
      this.agents.delete(chatId);
    }
    const cwd = this.store.get(chatId)?.cwd ?? this.defaultCwd;
    this.store.delete(chatId);
    logger.info('[ChatManager] Session reset', { chatId });
    return cwd;
  }

  getSessionInfo(chatId: string): string {
    const data = this.store.get(chatId);
    const cwd = data?.cwd ?? this.defaultCwd;
    const agent = this.agents.get(chatId);
    const storedId = data?.sessionId;
    const cwdLine = `工作目录: ${cwd}`;
    if (!agent && !storedId) return `${cwdLine}\n当前没有活跃的 Claude Code 会话`;
    if (!agent) return `${cwdLine}\n会话 ID: ${storedId}\n状态: 未运行（可恢复）`;
    const alive = agent.isAlive();
    return `${cwdLine}\n会话 ID: ${agent.getSessionId()}\n状态: ${alive ? '运行中' : '已断开'}`;
  }

  private getOrCreateAgent(chatId: string): Agent {
    let agent = this.agents.get(chatId);
    if (agent?.isAlive()) {
      logger.debug('[ChatManager] Reusing existing agent', {
        chatId,
        agentId: agent.getAgentId(),
        sessionId: agent.getSessionId()
      });
      return agent;
    }

    if (agent) {
      logger.info('[ChatManager] Cleaning up dead agent', {
        chatId,
        agentId: agent.getAgentId(),
        sessionId: agent.getSessionId()
      });
      agent.destroy().catch(() => {});
      this.agents.delete(chatId);
    }

    const data = this.store.get(chatId);
    const cwd = data?.cwd ?? this.defaultCwd;
    const storedSessionId = data?.sessionId;
    const resumeSessionId = (storedSessionId && data?.cwd === cwd) ? storedSessionId : undefined;

    logger.info('[ChatManager] Creating new agent', {
      chatId,
      cwd,
      resumeSessionId,
      willResume: !!resumeSessionId
    });

    agent = new Agent(chatId, cwd, resumeSessionId);
    this.agents.set(chatId, agent);

    const expectedSessionId = agent.getSessionId();

    agent.onResponse((text) => {
      const data = this.store.get(chatId);

      // 第一次响应时检查 session 是否变化
      if (data && !data.sessionNotified) {
        const actualSessionId = agent.getSessionId();
        const sessionChanged = actualSessionId !== expectedSessionId;

        if (sessionChanged || !resumeSessionId) {
          // session 变化了，或者是新建的
          let message = '';
          if (!resumeSessionId) {
            message = `🆕 新会话: ${cwd} (${actualSessionId})`;
          } else if (sessionChanged) {
            message = `⚠️ 恢复失败，已创建新会话: ${cwd} (${actualSessionId})`;
          }

          if (message) {
            messageService.sendTextMessage(chatId, message).catch(() => {});
          }
        }

        // 标记已通知，更新实际 sessionId
        this.store.set(chatId, { ...data, sessionNotified: true, sessionId: actualSessionId });
      }

      logger.debug('[ChatManager] Agent response received', {
        chatId,
        agentId: agent.getAgentId(),
        textLength: text.length
      });
      this.sendResponse(chatId, text);
      if (this.responseCompleteCallback) {
        this.responseCompleteCallback();
      }
    });

    agent.onError((error) => {
      logger.error('[ChatManager] Agent error', { chatId, error: error.message });
      messageService.sendTextMessage(chatId, `错误: ${error.message}`).catch(() => {});
    });

    this.store.set(chatId, { cwd, sessionId: agent.getSessionId() });

    return agent;
  }

  private sendResponse(chatId: string, text: string): void {
    const MAX_LEN = 4000;
    if (text.length <= MAX_LEN) {
      messageService.sendCardMessage(chatId, text).then(() => {
        logger.debug('[ChatManager] Response sent', { chatId, textLength: text.length });
      }).catch(err => {
        logger.error('[ChatManager] Failed to send response', { chatId, error: err.message });
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
        logger.error('[ChatManager] Failed to send chunk', { chatId, error: err.message });
      }
    }
  }

  async stop(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.destroy();
    }
    this.agents.clear();
    logger.info('[ChatManager] Stopped');
  }
}

export const chatManager = new ChatManager();
