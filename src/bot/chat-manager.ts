import logger from '../utils/logger';
import messageService from '../services/message.service';
import { Agent } from '../claude/agent';
import config from '../config';

interface ChatData {
  cwd: string;
  sessionId: string | undefined;
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

  getCwd(chatId: string): string {
    return this.store.get(chatId)?.cwd ?? this.defaultCwd;
  }

  getSessionId(chatId: string): string | undefined {
    return this.store.get(chatId)?.sessionId;
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
    const agent = this.agents.get(chatId);
    if (agent) {
      await agent.destroy();
      this.agents.delete(chatId);
    }
    this.store.delete(chatId);
    this.store.set(chatId, { cwd: newCwd, sessionId: undefined });
    logger.info('[ChatManager] Switched cwd', { chatId, newCwd });
  }

  async reset(chatId: string): Promise<void> {
    const agent = this.agents.get(chatId);
    if (agent) {
      await agent.destroy();
      this.agents.delete(chatId);
    }
    this.store.delete(chatId);
    logger.info('[ChatManager] Session reset', { chatId });
  }

  getSessionInfo(chatId: string): string {
    const cwd = this.getCwd(chatId);
    const agent = this.agents.get(chatId);
    const storedId = this.getSessionId(chatId);
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

    const cwd = this.getCwd(chatId);
    const storedSessionId = this.getSessionId(chatId);
    const storedCwd = this.getCwd(chatId);
    const resumeSessionId = (storedSessionId && storedCwd === cwd) ? storedSessionId : undefined;

    logger.info('[ChatManager] Creating new agent', {
      chatId,
      cwd,
      resumeSessionId,
      willResume: !!resumeSessionId
    });

    agent = new Agent(chatId, cwd, resumeSessionId);
    this.agents.set(chatId, agent);

    agent.onResponse((text) => {
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

    if (!resumeSessionId) {
      this.store.set(chatId, { cwd, sessionId: agent.getSessionId() });
    }

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
