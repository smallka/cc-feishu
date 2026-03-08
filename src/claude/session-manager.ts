import logger from '../utils/logger';
import { chatManager } from '../bot/chat-manager';
import messageService from '../services/message.service';
import { Agent } from './agent';

export class SessionManager {
  private agents = new Map<string, Agent>();

  async start(): Promise<void> {
    logger.info('[SessionManager] Started');
  }

  getCwd(chatId: string): string {
    return chatManager.getCwd(chatId);
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const agent = this.getOrCreateAgent(chatId);
    logger.debug('[SessionManager] Sending message', {
      chatId,
      agentId: agent.getAgentId(),
      sessionId: agent.getSessionId(),
      messageLength: text.length
    });
    await agent.sendMessage(text);
  }

  interruptSession(chatId: string): 'success' | 'no_session' | 'not_running' {
    const agent = this.agents.get(chatId);
    if (!agent) {
      logger.warn('[SessionManager] No agent to interrupt', { chatId });
      return 'no_session';
    }
    const result = agent.interrupt() ? 'success' : 'not_running';
    logger.info('[SessionManager] Interrupt result', { chatId, agentId: agent.getAgentId(), result });
    return result;
  }

  async switchCwd(chatId: string, newCwd: string): Promise<void> {
    const agent = this.agents.get(chatId);
    if (agent) {
      await agent.destroy();
      this.agents.delete(chatId);
    }
    chatManager.clearSession(chatId);
    chatManager.setSession(chatId, newCwd, '');
    logger.info('[SessionManager] Switched cwd', { chatId, newCwd });
  }

  async resetSession(chatId: string): Promise<void> {
    const agent = this.agents.get(chatId);
    if (agent) {
      await agent.destroy();
      this.agents.delete(chatId);
    }
    chatManager.clearSession(chatId);
    logger.info('[SessionManager] Session reset', { chatId });
  }

  getSessionInfo(chatId: string): string {
    const cwd = this.getCwd(chatId);
    const agent = this.agents.get(chatId);
    const storedId = chatManager.getSessionId(chatId);
    const cwdLine = `工作目录: ${cwd}`;
    if (!agent && !storedId) return `${cwdLine}\n当前没有活跃的 Claude Code 会话`;
    if (!agent) return `${cwdLine}\n会话 ID: ${storedId}\n状态: 未运行（可恢复）`;
    const alive = agent.isAlive();
    return `${cwdLine}\n会话 ID: ${agent.getSessionId()}\n状态: ${alive ? '运行中' : '已断开'}`;
  }

  private getOrCreateAgent(chatId: string): Agent {
    let agent = this.agents.get(chatId);
    if (agent?.isAlive()) {
      logger.debug('[SessionManager] Reusing existing agent', {
        chatId,
        agentId: agent.getAgentId(),
        sessionId: agent.getSessionId()
      });
      return agent;
    }

    if (agent) {
      logger.info('[SessionManager] Cleaning up dead agent', {
        chatId,
        agentId: agent.getAgentId(),
        sessionId: agent.getSessionId()
      });
      agent.destroy().catch(() => {});
      this.agents.delete(chatId);
    }

    const cwd = chatManager.getCwd(chatId);
    const storedSessionId = chatManager.getSessionId(chatId);
    const storedCwd = chatManager.getCwd(chatId);
    const resumeSessionId = (storedSessionId && storedCwd === cwd) ? storedSessionId : undefined;

    logger.info('[SessionManager] Creating new agent', {
      chatId,
      cwd,
      resumeSessionId,
      willResume: !!resumeSessionId
    });

    agent = new Agent(cwd, resumeSessionId);
    this.agents.set(chatId, agent);

    agent.onResponse((text) => {
      logger.debug('[SessionManager] Agent response received', {
        chatId,
        agentId: agent.getAgentId(),
        textLength: text.length
      });
      this.sendPlainText(chatId, text);
    });

    agent.onError((error) => {
      logger.error('[SessionManager] Agent error', { chatId, error: error.message });
      messageService.sendTextMessage(chatId, `错误: ${error.message}`).catch(() => {});
    });

    if (!resumeSessionId) {
      chatManager.setSession(chatId, cwd, agent.getSessionId());
    }

    return agent;
  }

  private sendPlainText(chatId: string, text: string): void {
    const MAX_LEN = 4000;
    if (text.length <= MAX_LEN) {
      messageService.sendTextMessage(chatId, text).then(() => {
        logger.debug('[SessionManager] Response sent', { chatId, textLength: text.length });
      }).catch(err => {
        logger.error('[SessionManager] Failed to send response', { chatId, error: err.message });
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
        logger.error('[SessionManager] Failed to send chunk', { chatId, error: err.message });
      }
    }
  }

  async stop(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.destroy();
    }
    this.agents.clear();
    logger.info('[SessionManager] Stopped');
  }
}

