import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import logger from '../utils/logger';

const STORE_PATH = join(process.cwd(), '.sessions.json');

interface StoreData {
  [chatId: string]: string; // chatId -> sessionId
}

let cache: StoreData | null = null;

function load(): StoreData {
  if (cache) return cache;
  if (!existsSync(STORE_PATH)) {
    cache = {};
    return cache;
  }
  try {
    const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
    cache = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      ? parsed as StoreData
      : {};
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

export function getSessionId(chatId: string): string | undefined {
  return load()[chatId];
}

export function setSessionId(chatId: string, sessionId: string): void {
  const data = load();
  data[chatId] = sessionId;
  save(data);
}

export function removeSessionId(chatId: string): void {
  const data = load();
  delete data[chatId];
  save(data);
}
