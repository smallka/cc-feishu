import type { ChatBinding } from './chat-binding-store';

export interface ResolveChatAccessOptions {
  text: string;
  senderOpenId: string;
  allowedOpenIds: readonly string[];
  binding: ChatBinding | null;
  isDirectChat?: boolean;
  bindingValid?: boolean;
  hasActiveMenuSelection?: boolean;
}

export type ChatAccessDecision =
  | { kind: 'allowed' }
  | { kind: 'unauthorized' }
  | { kind: 'invalid_binding' }
  | { kind: 'unbound' };

export function resolveChatAccess(options: ResolveChatAccessOptions): ChatAccessDecision {
  const {
    text,
    senderOpenId,
    allowedOpenIds,
    binding,
    isDirectChat = false,
    bindingValid = true,
    hasActiveMenuSelection = false,
  } = options;

  if (!allowedOpenIds.includes(senderOpenId)) {
    return { kind: 'unauthorized' };
  }

  if (binding && !bindingValid) {
    if (canOperateWithoutBinding(text, hasActiveMenuSelection)) {
      return { kind: 'allowed' };
    }

    return { kind: 'invalid_binding' };
  }

  if (binding || isDirectChat || canOperateWithoutBinding(text, hasActiveMenuSelection)) {
    return { kind: 'allowed' };
  }

  return { kind: 'unbound' };
}

function canOperateWithoutBinding(text: string, hasActiveMenuSelection: boolean): boolean {
  return text.startsWith('/') || hasActiveMenuSelection;
}
