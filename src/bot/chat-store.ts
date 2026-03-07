import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import logger from '../utils/logger';

const STORE_PATH = join(process.cwd(), '.chat-store.json');

interface ChatData {
  lastCwd: string;
  lastSessionId: string;
}

interface StoreData {
  [chatId: string]: ChatData;
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
    cache = raw as StoreData;
    return cache;
  } catch {
    logger.warn('Failed to parse chat store, starting fresh');
    cache = {};
    return cache;
  }
}

function save(data: StoreData): void {
  cache = data;
  try {
    writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
  } catch (err: any) {
    logger.error('Failed to save chat store', { error: err.message });
  }
}

export function getLastCwd(chatId: string): string | undefined {
  return load()[chatId]?.lastCwd;
}

export function getLastSessionId(chatId: string): string | undefined {
  return load()[chatId]?.lastSessionId;
}

export function setLastSession(chatId: string, cwd: string, sessionId: string): void {
  const data = load();
  data[chatId] = { lastCwd: cwd, lastSessionId: sessionId };
  save(data);
}

export function clearLastSession(chatId: string): void {
  const data = load();
  delete data[chatId];
  save(data);
}
