import { Dirent, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

import type { DirectorySummary, SessionSummary, SessionTarget } from '../agent/session-history';
import logger from '../utils/logger';

const SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

interface ResolvedSessionMetadata {
  sessionId: string;
  cwd: string;
  firstMessage: string | null;
}

const SUMMARY_SKIP_PREFIXES = [
  '# AGENTS.md instructions',
  '<environment_context>',
  '<permissions instructions>',
  '<collaboration_mode>',
  '<system_prompt>',
  '--- project-doc ---',
];

const SUMMARY_SKIP_CONTAINS = [
  '\n<environment_context>',
  '\n<system_prompt>',
  '\n--- project-doc ---',
  '\n## Skills',
];

function truncateSummary(text: string): string {
  return text.length > 50 ? `${text.slice(0, 50)}...` : text;
}

function readSessionMetadata(filePath: string): ResolvedSessionMetadata | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    let sessionId: string | null = null;
    let cwd: string | null = null;
    let firstMessage: string | null = null;

    for (const line of content.split('\n')) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line);

        if (entry.type === 'session_meta') {
          const payload = entry.payload ?? {};
          if (!sessionId && typeof payload.id === 'string' && payload.id.trim()) {
            sessionId = payload.id;
          }
          if (!cwd && typeof payload.cwd === 'string' && payload.cwd.trim()) {
            cwd = payload.cwd;
          }
        }

        if (!firstMessage) {
          const text = extractUserMessage(entry);
          if (text && !shouldSkipSummaryCandidate(text)) {
            firstMessage = truncateSummary(text);
          }
        }

        if (sessionId && cwd && firstMessage) {
          break;
        }
      } catch {
        continue;
      }
    }

    if (!sessionId || !cwd) {
      return null;
    }

    return { sessionId, cwd, firstMessage };
  } catch (error: any) {
    logger.warn('[CodexSessionScanner] Failed to read session file', {
      filePath,
      error: error.message,
    });
    return null;
  }
}

function extractUserMessage(entry: any): string | null {
  if (entry?.type === 'response_item' && entry.payload?.type === 'message' && entry.payload?.role === 'user') {
    return extractTextFromContent(entry.payload.content);
  }

  if (entry?.type === 'event_msg' && entry.payload?.type === 'user_message') {
    if (typeof entry.payload.message === 'string' && entry.payload.message.trim()) {
      return entry.payload.message.trim();
    }
    return extractTextFromContent(entry.payload.content);
  }

  return null;
}

function extractTextFromContent(content: unknown): string | null {
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return null;
  }

  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }

    if (block.type === 'input_text' && typeof block.text === 'string' && block.text.trim()) {
      return block.text.trim();
    }

    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      return block.text.trim();
    }
  }

  return null;
}

function shouldSkipSummaryCandidate(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return true;
  }

  if (SUMMARY_SKIP_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
    return true;
  }

  if (SUMMARY_SKIP_CONTAINS.some(marker => normalized.includes(marker))) {
    return true;
  }

  return false;
}

function shouldSkipSessionCwd(cwd: string): boolean {
  return cwd.includes('Temp');
}

function collectSessionFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  const stack: string[] = [rootDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch (error: any) {
      logger.warn('[CodexSessionScanner] Failed to read session directory', {
        currentDir,
        error: error.message,
      });
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function scanAllSessions(): SessionSummary[] {
  const files = collectSessionFiles(SESSIONS_DIR)
    .map(filePath => ({
      filePath,
      mtimeMs: statSync(filePath).mtimeMs,
    }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const sessions: SessionSummary[] = [];

  for (const file of files) {
    const metadata = readSessionMetadata(file.filePath);
    if (!metadata) {
      continue;
    }

    if (shouldSkipSessionCwd(metadata.cwd)) {
      continue;
    }

    sessions.push({
      sessionId: metadata.sessionId,
      cwd: metadata.cwd,
      filePath: file.filePath,
      firstMessage: metadata.firstMessage ?? 'No summary',
      mtimeMs: file.mtimeMs,
    });
  }

  return sessions;
}

function getSessionsForResume(cwd: string, defaultCwd?: string): SessionSummary[] {
  const sessions = scanAllSessions();
  if (defaultCwd && cwd === defaultCwd) {
    return sessions;
  }

  return sessions.filter(session => session.cwd === cwd);
}

export function getValidSessions(cwd: string, defaultCwd?: string, limit = 5): SessionSummary[] {
  return getSessionsForResume(cwd, defaultCwd).slice(0, limit);
}

export function getSessionList(cwd: string, defaultCwd?: string): SessionTarget[] {
  return getSessionsForResume(cwd, defaultCwd).map(session => ({
    sessionId: session.sessionId,
    cwd: session.cwd,
  }));
}

export function getRecentDirectories(limit = 9): DirectorySummary[] {
  const directories = new Map<string, DirectorySummary>();

  for (const session of scanAllSessions()) {
    if (directories.has(session.cwd)) {
      continue;
    }

    directories.set(session.cwd, {
      cwd: session.cwd,
      mtimeMs: session.mtimeMs,
    });

    if (directories.size >= limit) {
      break;
    }
  }

  return Array.from(directories.values());
}

export function findSessionById(sessionId: string): SessionTarget | null {
  const normalizedId = sessionId.trim();
  if (!normalizedId) {
    return null;
  }

  const session = scanAllSessions().find(item => item.sessionId === normalizedId);
  if (!session) {
    return null;
  }

  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
  };
}
