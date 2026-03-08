import logger from '../utils/logger';
import messageService from '../services/message.service';
import { Agent } from '../claude/agent';
import config from '../config';

interface ChatData {
  cwd: string;
  sessionId: string | undefined;
  sessionNotified?: boolean;
}

export class ChatManager {
  private chats: Map<string, ChatData> = new Map();
  private agents = new Map<string, Agent>();
  private defaultCwd: string;
  private responseCompleteCallback: (() => void) | null = null;
  private startTime: number;

  constructor() {
    this.defaultCwd = config.claude.workRoot;
    this.startTime = Date.now();
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
    const data = this.chats.get(chatId);
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
    this.chats.set(chatId, { cwd: newCwd, sessionId: undefined });
    logger.info('[ChatManager] Switched cwd', { chatId, oldCwd: currentCwd, newCwd });
  }

  async reset(chatId: string): Promise<string> {
    const agent = this.agents.get(chatId);
    if (agent) {
      await agent.destroy();
      this.agents.delete(chatId);
    }
    const cwd = this.chats.get(chatId)?.cwd ?? this.defaultCwd;
    this.chats.delete(chatId);
    logger.info('[ChatManager] Session reset', { chatId });
    return cwd;
  }

  getSessionInfo(chatId: string): string {
    const data = this.chats.get(chatId);
    const agent = this.agents.get(chatId);

    if (!data && !agent) {
      return `工作目录: ${this.defaultCwd}\n当前没有活跃的 Claude Code 会话`;
    }

    if (agent) {
      const uptime = Math.floor((Date.now() - agent.getStartTime()) / 1000);
      const status = agent.isAlive() ? '运行中 ✅' : '已断开 ❌';
      const sessionId = agent.getSessionId() || '无 sessionId';
      return `工作目录: ${agent.getCwd()}\nSession: ${sessionId}\nAgent: ${agent.getAgentId()} (${uptime}s, ${status})`;
    }

    const sessionId = data?.sessionId || '无 sessionId';
    return `工作目录: ${data?.cwd ?? this.defaultCwd}\nSession: ${sessionId}\n状态: 未运行（可恢复）`;
  }

  getDebugInfo(): string {
    const systemUptime = Math.floor((Date.now() - this.startTime) / 1000);
    const lines: string[] = [];
    lines.push(`**系统调试信息**`);
    lines.push(`\n系统运行时长: ${systemUptime}s`);
    lines.push(`\nChat: ${this.chats.size} | Agent: ${this.agents.size}`);
    lines.push(`\n---\n`);

    if (this.chats.size === 0) {
      lines.push('当前无 Chat');
    } else {
      for (const [chatId, data] of this.chats) {
        const agent = this.agents.get(chatId);
        const shortId = chatId.slice(0, 8);

        if (agent) {
          const uptime = Math.floor((Date.now() - agent.getStartTime()) / 1000);
          const status = agent.isAlive() ? '✅' : '❌';
          const sessionId = agent.getSessionId() || '无 sessionId';
          lines.push(`\`${shortId}\` **→** \`${agent.getAgentId()}\` (${uptime}s ${status})`);
          lines.push(`\n&emsp;&emsp;${agent.getCwd()} (${sessionId})\n`);
        } else {
          const sessionId = data.sessionId || '无 sessionId';
          lines.push(`\`${shortId}\` **→** 无 Agent`);
          lines.push(`\n&emsp;&emsp;${data.cwd} (${sessionId})\n`);
        }
      }

      const orphanAgents = Array.from(this.agents.keys()).filter(id => !this.chats.has(id));
      if (orphanAgents.length > 0) {
        lines.push(`\n**孤立 Agent**\n`);
        for (const chatId of orphanAgents) {
          const agent = this.agents.get(chatId);
          if (agent) {
            const uptime = Math.floor((Date.now() - agent.getStartTime()) / 1000);
            lines.push(`\`${agent.getAgentId()}\` (${uptime}s)\n`);
          }
        }
      }
    }

    return lines.join('');
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

    const data = this.chats.get(chatId);
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
      const data = this.chats.get(chatId);

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
        this.chats.set(chatId, { ...data, sessionNotified: true, sessionId: actualSessionId });
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

    this.chats.set(chatId, { cwd, sessionId: agent.getSessionId() });

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
