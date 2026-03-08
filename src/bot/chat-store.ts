interface ChatData {
  lastCwd: string;
  lastSessionId: string;
}

interface StoreData {
  [chatId: string]: ChatData;
}

const store: StoreData = {};

export function getLastCwd(chatId: string): string | undefined {
  return store[chatId]?.lastCwd;
}

export function getLastSessionId(chatId: string): string | undefined {
  return store[chatId]?.lastSessionId;
}

export function setLastSession(chatId: string, cwd: string, sessionId: string): void {
  store[chatId] = { lastCwd: cwd, lastSessionId: sessionId };
}

export function clearLastSession(chatId: string): void {
  delete store[chatId];
}
