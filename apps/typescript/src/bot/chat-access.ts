import type { ChatBinding } from './chat-binding-store';

export interface ResolveChatAccessOptions {
  text: string;
  senderOpenId: string;
  allowedOpenIds: readonly string[];
  binding: ChatBinding | null;
}

export type ChatAccessDecision =
  | { kind: 'allowed' }
  | { kind: 'unauthorized' }
  | { kind: 'unbound' };

export function resolveChatAccess(options: ResolveChatAccessOptions): ChatAccessDecision {
  const { text, senderOpenId, allowedOpenIds, binding } = options;

  if (!allowedOpenIds.includes(senderOpenId)) {
    return { kind: 'unauthorized' };
  }

  if (binding || canOperateWithoutBinding(text)) {
    return { kind: 'allowed' };
  }

  return { kind: 'unbound' };
}

function canOperateWithoutBinding(text: string): boolean {
  return text === '/help' || text === '/cd' || text.startsWith('/cd ');
}
