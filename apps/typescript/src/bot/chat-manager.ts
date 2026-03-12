import logger from '../utils/logger';
import messageService from '../services/message.service';
import { createAgent } from '../agent/factory';
import type { AgentProvider } from '../config';
import type { ChatAgent } from '../agent/types';
import {
  getSessionList,
  getValidSessions,
  sessionExists,
  type SessionSummary,
} from '../claude/session-scanner';
import config from '../config';

interface ChatData {
  cwd: string;
  sessionId: string | undefined;
  sessionNotified?: boolean;
}

interface ResumeTarget {
  sessionId: string;
  cwd: string;
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  if (wholeSeconds < 60) {
    return `${wholeSeconds}秒`;
  }
  if (wholeSeconds < 3600) {
    const minutes = Math.floor(wholeSeconds / 60);
    const secs = wholeSeconds % 60;
    return `${minutes}分${secs}秒`;
  }
  if (wholeSeconds < 86400) {
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    return `${hours}小时${minutes}分`;
  }
  const days = Math.floor(wholeSeconds / 86400);
  const hours = Math.floor((wholeSeconds % 86400) / 3600);
  return `${days}天${hours}小时`;
}

export class ChatManager {
  private chats = new Map<string, ChatData>();
  private agents = new Map<string, ChatAgent>();
  private readonly defaultCwd: string;
  private readonly provider: AgentProvider;
  private responseCompleteCallback: (() => void) | null = null;
  private readonly startTime: number;

  constructor() {
    this.defaultCwd = config.claude.workRoot;
    this.provider = config.agent.provider;
    this.startTime = Date.now();
  }

  async start(): Promise<void> {
    logger.info('[ChatManager] Started', { provider: this.provider });
  }

  onResponseComplete(callback: () => void): void {
    this.responseCompleteCallback = callback;
  }

  getProvider(): AgentProvider {
    return this.provider;
  }

  supportsSessionResume(): boolean {
    return this.provider === 'claude';
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    const agent = this.getOrCreateAgent(chatId);
    logger.info('[ChatManager] Sending message', {
      chatId,
      provider: this.provider,
      agentId: agent.getAgentId(),
      sessionId: agent.getSessionId(),
      messageLength: text.length,
      messageText: text,
    });
    await agent.sendMessage(text);
  }

  async interrupt(chatId: string): Promise<'success' | 'timeout' | 'no_session' | 'error'> {
    const agent = this.agents.get(chatId);
    if (!agent) {
      logger.warn('[ChatManager] No agent to interrupt', { chatId });
      return 'no_session';
    }

    try {
      const sent = agent.interrupt();
      const result = sent ? 'success' : 'error';
      logger.info('[ChatManager] Interrupt result', {
        chatId,
        provider: this.provider,
        agentId: agent.getAgentId(),
        result,
      });
      return result;
    } catch (error: any) {
      logger.error('[ChatManager] Interrupt failed', { chatId, error: error.message });
      return 'error';
    }
  }

  async switchCwd(chatId: string, newCwd: string): Promise<void> {
    const data = this.chats.get(chatId);
    const currentCwd = data?.cwd ?? this.defaultCwd;
    if (currentCwd === newCwd) {
      logger.debug('[ChatManager] Cwd unchanged, skipping switch', { chatId, cwd: newCwd });
      return;
    }

    await this.destroyAgent(chatId, 'switching cwd');
    this.chats.set(chatId, { cwd: newCwd, sessionId: undefined, sessionNotified: false });
    logger.info('[ChatManager] Switched cwd', { chatId, oldCwd: currentCwd, newCwd, provider: this.provider });
  }

  async reset(chatId: string): Promise<string> {
    await this.destroyAgent(chatId, 'reset');

    const cwd = this.chats.get(chatId)?.cwd ?? this.defaultCwd;
    this.chats.set(chatId, { cwd, sessionId: undefined, sessionNotified: false });
    logger.info('[ChatManager] Session reset', { chatId, cwd, provider: this.provider });
    return cwd;
  }

  getSessionInfo(chatId: string): string {
    const agent = this.agents.get(chatId);
    const data = this.chats.get(chatId);

    if (!agent) {
      const cwd = data?.cwd ?? this.defaultCwd;
      return `当前没有活跃会话\nProvider: ${this.provider}\n工作目录: ${cwd}`;
    }

    const sessionId = agent.getSessionId() || '无';
    const cwd = agent.getCwd();
    const uptime = (Date.now() - agent.getStartTime()) / 1000;

    return [
      '会话信息:',
      `- Provider: ${this.provider}`,
      `- Session ID: ${sessionId === '无' ? sessionId : `${sessionId.slice(0, 16)}...`}`,
      `- 工作目录: ${cwd}`,
      `- 运行时长: ${formatDuration(uptime)}`,
    ].join('\n');
  }

  listSessions(chatId: string): string {
    if (!this.supportsSessionResume()) {
      const cwd = this.getChatCwd(chatId);
      return [
        `当前 provider: ${this.provider}`,
        `工作目录: \`${cwd}\``,
        '',
        '当前 provider 暂不支持 /resume 和历史会话列表。',
      ].join('\n');
    }

    const chatData = this.chats.get(chatId);
    const cwd = chatData?.cwd ?? this.defaultCwd;
    const isRoot = cwd === this.defaultCwd;
    const sessions = this.getValidSessionsForChat(chatId);

    if (sessions.length === 0) {
      return `工作目录: \`${cwd}\`\n\n暂无 session 记录`;
    }

    const currentSession = chatData?.sessionId;
    const lines: string[] = [];

    if (isRoot) {
      lines.push('**Sessions（根目录）**');
      lines.push(`工作目录: \`${cwd}\``);
      lines.push('');
      lines.push('**当前目录最近 5 条**');
      lines.push('');

      let currentDirCount = 0;
      for (let index = 0; index < sessions.length; index += 1) {
        const session = sessions[index];
        if (session.cwd !== cwd) {
          break;
        }

        currentDirCount = index + 1;
        lines.push(this.formatSessionLine(index + 1, session, currentSession));
        lines.push(`摘要 ${session.firstMessage}`);
        lines.push('');
      }

      if (currentDirCount < sessions.length) {
        lines.push('**其他目录最近会话**');
        lines.push('');

        for (let index = currentDirCount; index < sessions.length; index += 1) {
          const session = sessions[index];
          lines.push(`**${index + 1}.** \`${session.cwd}\``);
          lines.push(`   \`${session.sessionId.slice(0, 8)}...\`  ${formatDuration((Date.now() - session.mtimeMs) / 1000)}前`);
          lines.push(`   摘要 ${session.firstMessage}`);
          lines.push('');
        }
      }
    } else {
      lines.push(`**Sessions（${sessions.length} 条）**`);
      lines.push(`工作目录: \`${cwd}\``);
      lines.push('');

      sessions.forEach((session, index) => {
        lines.push(this.formatSessionLine(index + 1, session, currentSession));
        lines.push(`摘要 ${session.firstMessage}`);
        lines.push('');
      });
    }

    return lines.join('\n');
  }

  getSessionCount(chatId: string): number {
    if (!this.supportsSessionResume()) {
      return 0;
    }
    return getSessionList(this.getChatCwd(chatId), this.defaultCwd).length;
  }

  resolveResumeTarget(chatId: string, index: number): ResumeTarget | null {
    if (!this.supportsSessionResume()) {
      return null;
    }

    const sessions = getSessionList(this.getChatCwd(chatId), this.defaultCwd);
    if (index < 1 || index > sessions.length) {
      return null;
    }

    const target = sessions[index - 1];
    return {
      sessionId: target.sessionId,
      cwd: target.cwd,
    };
  }

  async resumeSession(chatId: string, sessionId: string): Promise<string> {
    if (!this.supportsSessionResume()) {
      return `当前 provider (${this.provider}) 暂不支持 /resume。`;
    }

    const cwd = this.getChatCwd(chatId);
    if (!sessionExists(cwd, sessionId)) {
      return `❌ Session 不存在: ${sessionId}\n使用 /resume 查看可用的 sessions`;
    }

    await this.destroyAgent(chatId, 'resuming session');
    this.chats.set(chatId, {
      cwd,
      sessionId,
      sessionNotified: false,
    });

    logger.info('[ChatManager] Resumed session', { chatId, cwd, sessionId });
    return `✅ 已切换到 session: ${sessionId}\n工作目录: ${cwd}`;
  }

  getDebugInfo(): string {
    const uptime = (Date.now() - this.startTime) / 1000;
    const info = [
      '**系统状态**',
      `- Provider: ${this.provider}`,
      `- 运行时长: ${formatDuration(uptime)}`,
      `- 活跃会话: ${this.chats.size}`,
      `- 活跃 Agent: ${this.agents.size}`,
      '',
      '**会话列表**',
    ];

    if (this.chats.size === 0) {
      info.push('当前没有活跃会话');
    }

    for (const [chatId, data] of this.chats) {
      const agent = this.agents.get(chatId);
      let sessionId = data.sessionId || '无';
      if (sessionId !== '无') {
        sessionId = `${sessionId.slice(0, 8)}...`;
      }

      if (agent) {
        const agentId = agent.getAgentId();
        const agentIdShort = agentId.length > 12 ? `${agentId.slice(0, 12)}...` : agentId;
        const status = agent.isInitialized() ? '空闲' : '未连接';

        info.push(
          `- Chat: \`${chatId.slice(0, 8)}...\`\n`
          + `  - Agent: ${status} \`${agentIdShort}\`\n`
          + `  - Session: \`${sessionId}\`\n`
          + `  - CWD: \`${data.cwd}\``,
        );
      } else {
        info.push(
          `- Chat: \`${chatId.slice(0, 8)}...\`\n`
          + '  - Agent: 未启动\n'
          + `  - Session: \`${sessionId}\`\n`
          + `  - CWD: \`${data.cwd}\``,
        );
      }
    }

    return info.join('\n');
  }

  async stop(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.destroy();
    }
    this.agents.clear();
    logger.info('[ChatManager] Stopped');
  }

  private getOrCreateAgent(chatId: string): ChatAgent {
    let agent = this.agents.get(chatId);
    if (agent?.isAlive()) {
      logger.debug('[ChatManager] Reusing existing agent', {
        chatId,
        provider: this.provider,
        agentId: agent.getAgentId(),
        sessionId: agent.getSessionId(),
      });
      return agent;
    }

    if (agent) {
      logger.info('[ChatManager] Cleaning up dead agent', {
        chatId,
        provider: this.provider,
        agentId: agent.getAgentId(),
        sessionId: agent.getSessionId(),
      });
      agent.destroy().catch(() => {});
      this.agents.delete(chatId);
    }

    const data = this.chats.get(chatId);
    const cwd = data?.cwd ?? this.defaultCwd;
    const storedSessionId = data?.sessionId;
    const resumeSessionId = this.supportsSessionResume() && storedSessionId && data?.cwd === cwd
      ? storedSessionId
      : undefined;

    logger.info('[ChatManager] Creating new agent', {
      chatId,
      provider: this.provider,
      cwd,
      resumeSessionId,
      willResume: !!resumeSessionId,
    });

    agent = createAgent({
      provider: this.provider,
      chatId,
      cwd,
      resumeSessionId,
    });
    this.agents.set(chatId, agent);

    const expectedSessionId = agent.getSessionId();

    agent.onResponse((text) => {
      const currentData = this.chats.get(chatId);

      if (currentData && !currentData.sessionNotified) {
        const actualSessionId = agent.getSessionId();
        const sessionChanged = actualSessionId !== expectedSessionId;

        if (sessionChanged || !resumeSessionId) {
          let message = '';
          if (!resumeSessionId) {
            message = `新会话已创建: ${cwd} (${actualSessionId ?? 'pending'})`;
          } else if (sessionChanged) {
            message = `恢复失败，已创建新会话: ${cwd} (${actualSessionId ?? 'pending'})`;
          }

          if (message) {
            messageService.sendTextMessage(chatId, message).catch(() => {});
          }
        }

        this.chats.set(chatId, {
          ...currentData,
          sessionNotified: true,
          sessionId: actualSessionId,
        });
      }

      logger.info('[ChatManager] Agent response received', {
        chatId,
        provider: this.provider,
        agentId: agent.getAgentId(),
        textLength: text.length,
        responseText: text,
      });
      this.sendResponse(chatId, text);
      this.responseCompleteCallback?.();
    });

    agent.onError((error) => {
      logger.error('[ChatManager] Agent error', { chatId, provider: this.provider, error: error.message });
      messageService.sendTextMessage(chatId, `错误: ${error.message}`).catch(() => {});
    });

    this.chats.set(chatId, { cwd, sessionId: agent.getSessionId(), sessionNotified: false });
    return agent;
  }

  private getChatCwd(chatId: string): string {
    return this.chats.get(chatId)?.cwd ?? this.defaultCwd;
  }

  private getValidSessionsForChat(chatId: string): SessionSummary[] {
    return getValidSessions(this.getChatCwd(chatId), this.defaultCwd);
  }

  private formatSessionLine(index: number, session: SessionSummary, currentSession?: string): string {
    const marker = session.sessionId === currentSession ? ' 当前' : '';
    const age = formatDuration((Date.now() - session.mtimeMs) / 1000);
    return `**${index}.** \`${session.sessionId.slice(0, 8)}...\`${marker}  ${age}前`;
  }

  private sendResponse(chatId: string, text: string): void {
    const maxLen = 4000;
    if (text.length <= maxLen) {
      messageService.sendCardMessage(chatId, text).then(() => {
        logger.debug('[ChatManager] Response sent', { chatId, textLength: text.length });
      }).catch(err => {
        logger.error('[ChatManager] Failed to send response', { chatId, error: err.message });
      });
      return;
    }

    this.sendLongMessage(chatId, text, maxLen).catch(err => {
      logger.error('[ChatManager] Failed to send long response', { chatId, error: err.message });
    });
  }

  private async sendLongMessage(chatId: string, text: string, maxLen: number): Promise<void> {
    for (let i = 0; i < text.length; i += maxLen) {
      const chunk = text.slice(i, i + maxLen);
      try {
        await messageService.sendTextMessage(chatId, chunk);
      } catch (err: any) {
        logger.error('[ChatManager] Failed to send chunk', { chatId, error: err.message });
      }
    }
  }

  private async destroyAgent(chatId: string, reason: string): Promise<void> {
    const agent = this.agents.get(chatId);
    if (!agent) {
      return;
    }

    try {
      await agent.destroy();
    } catch (error: any) {
      logger.error(`[ChatManager] Error destroying agent while ${reason}`, {
        chatId,
        provider: this.provider,
        error: error.message,
      });
    }
    this.agents.delete(chatId);
  }
}

export const chatManager = new ChatManager();


