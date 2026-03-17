import type { AgentProvider } from '../config';

const MENU_TTL_MS = 60_000;

export type MenuAction =
  | { type: 'resume_session'; sessionId: string; cwd: string }
  | { type: 'switch_cwd'; cwd: string }
  | { type: 'switch_provider'; provider: AgentProvider };

export interface MenuItem {
  index: number;
  label: string;
  action: MenuAction;
}

export interface MenuContext {
  kind: 'resume' | 'agent' | 'cwd';
  title: string;
  description?: string;
  items: MenuItem[];
  expiresAt: number;
}

export type MenuSelectionResult =
  | { kind: 'selected'; action: MenuAction }
  | { kind: 'cancelled' }
  | { kind: 'expired' }
  | { kind: 'invalid'; validChoices: number[] };

class MenuContextStore {
  private readonly contexts = new Map<string, MenuContext>();

  set(chatId: string, context: Omit<MenuContext, 'expiresAt'>): MenuContext {
    const menu: MenuContext = {
      ...context,
      expiresAt: Date.now() + MENU_TTL_MS,
    };
    this.contexts.set(chatId, menu);
    return menu;
  }

  get(chatId: string): MenuContext | null {
    const context = this.contexts.get(chatId);
    if (!context) {
      return null;
    }

    if (context.expiresAt <= Date.now()) {
      this.contexts.delete(chatId);
      return null;
    }

    return context;
  }

  clear(chatId: string): void {
    this.contexts.delete(chatId);
  }

  resolve(chatId: string, input: string): MenuSelectionResult | null {
    const rawContext = this.contexts.get(chatId);
    if (!rawContext) {
      return null;
    }

    if (rawContext.expiresAt <= Date.now()) {
      this.contexts.delete(chatId);
      return { kind: 'expired' };
    }

    if (!/^\d$/.test(input)) {
      return null;
    }

    if (input === '0') {
      this.contexts.delete(chatId);
      return { kind: 'cancelled' };
    }

    const index = Number.parseInt(input, 10);
    const item = rawContext.items.find(entry => entry.index === index);
    if (!item) {
      return {
        kind: 'invalid',
        validChoices: rawContext.items.map(entry => entry.index),
      };
    }

    this.contexts.delete(chatId);
    return {
      kind: 'selected',
      action: item.action,
    };
  }
}

export function renderMenu(context: MenuContext): string {
  const lines = [`**${context.title}**`];

  if (context.description) {
    lines.push(context.description);
    lines.push('');
  }

  for (const item of context.items) {
    lines.push(`**${item.index}.** ${item.label}`);
  }

  lines.push('');
  lines.push('**0.** 取消');
  lines.push('');
  lines.push('回复数字选择，60 秒后失效。');

  return lines.join('\n');
}

export default new MenuContextStore();
