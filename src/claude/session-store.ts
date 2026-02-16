import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import logger from '../utils/logger';

const STORE_PATH = join(process.cwd(), '.sessions.json');

interface ChatStore {
  currentCwd: string;
  sessions: { [cwd: string]: string }; // cwd -> sessionId
}

interface StoreData {
  [chatId: string]: ChatStore;
}

let cache: StoreData | null = null;

function load(): StoreData {
  if (cache) return cache;
  if (!existsSync(STORE_PATH)) {
    cache = {};
    return cache;
  }
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      cache = {};
      return cache;
    }
    // 兼容旧格式: { chatId: "sessionId" } → 新格式
    const migrated: StoreData = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') {
        // 旧格式，迁移
        migrated[key] = {
          currentCwd: process.cwd(),
          sessions: { [process.cwd()]: value },
        };
      } else if (value && typeof value === 'object' && 'sessions' in value) {
        migrated[key] = value as ChatStore;
      }
    }
    cache = migrated;
    return cache;
  } catch {
    logger.warn('Failed to parse session store, starting fresh');
    cache = {};
    return cache;
  }
}

function save(data: StoreData): void {
  cache = data;
  try {
    writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
  } catch (err: any) {
    logger.error('Failed to save session store', { error: err.message });
  }
}

function ensureChat(data: StoreData, chatId: string, defaultCwd: string): ChatStore {
  if (!data[chatId]) {
    data[chatId] = { currentCwd: defaultCwd, sessions: {} };
  }
  return data[chatId];
}

export function getCurrentCwd(chatId: string): string | undefined {
  return load()[chatId]?.currentCwd;
}

export function setCurrentCwd(chatId: string, cwd: string, defaultCwd: string): void {
  const data = load();
  ensureChat(data, chatId, defaultCwd).currentCwd = cwd;
  save(data);
}

export function getSessionId(chatId: string, cwd: string): string | undefined {
  return load()[chatId]?.sessions[cwd];
}

export function setSessionId(chatId: string, cwd: string, sessionId: string, defaultCwd: string): void {
  const data = load();
  ensureChat(data, chatId, defaultCwd).sessions[cwd] = sessionId;
  save(data);
}

export function removeSessionId(chatId: string, cwd: string): void {
  const data = load();
  const chat = data[chatId];
  if (chat) {
    delete chat.sessions[cwd];
    save(data);
  }
}

export function getAllCwds(chatId: string): string[] {
  const chat = load()[chatId];
  return chat ? Object.keys(chat.sessions) : [];
}
