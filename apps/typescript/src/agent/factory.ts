import type { ChatAgent } from './types';
import { Agent as ClaudeAgent } from '../claude/agent';
import { CodexAgent } from '../codex/agent';

export type AgentProvider = 'claude' | 'codex';

export interface CreateAgentOptions {
  provider?: AgentProvider;
  chatId: string;
  cwd: string;
  resumeSessionId?: string;
}

export function createAgent(options: CreateAgentOptions): ChatAgent {
  switch (options.provider ?? 'claude') {
    case 'codex':
      return new CodexAgent(options.chatId, options.cwd, options.resumeSessionId);
    case 'claude':
    default:
      return new ClaudeAgent(options.chatId, options.cwd, options.resumeSessionId);
  }
}
