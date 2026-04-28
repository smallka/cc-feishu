import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import config from '../config';

export interface ChatBinding {
  cwd: string;
  updatedAt: string;
}

interface ChatBindingsDocument {
  version: 1;
  bindings: Record<string, ChatBinding>;
}

const EMPTY_DOCUMENT: ChatBindingsDocument = {
  version: 1,
  bindings: {},
};

export class ChatBindingStore {
  private readonly filePath: string;

  constructor(filePath = config.storage.chatBindingsFile) {
    this.filePath = filePath;
  }

  get(chatId: string): ChatBinding | null {
    const document = this.readDocument();
    return document.bindings[chatId] ?? null;
  }

  set(chatId: string, cwd: string): ChatBinding {
    const document = this.readDocument();
    const binding: ChatBinding = {
      cwd,
      updatedAt: new Date().toISOString(),
    };
    document.bindings[chatId] = binding;
    this.writeDocument(document);
    return binding;
  }

  private readDocument(): ChatBindingsDocument {
    if (!existsSync(this.filePath)) {
      return {
        version: EMPTY_DOCUMENT.version,
        bindings: {},
      };
    }

    const raw = readFileSync(this.filePath, 'utf8').trim();
    if (!raw) {
      return {
        version: EMPTY_DOCUMENT.version,
        bindings: {},
      };
    }

    const parsed = JSON.parse(raw) as Partial<ChatBindingsDocument>;
    return {
      version: 1,
      bindings: parsed.bindings ?? {},
    };
  }

  private writeDocument(document: ChatBindingsDocument): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  }
}

export const chatBindingStore = new ChatBindingStore();
