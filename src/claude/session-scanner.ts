import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import logger from '../utils/logger';
import type { DirectorySummary, SessionSummary, SessionTarget } from '../agent/session-history';

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function cwdToProjectDir(cwd: string): string {
  return cwd.replace(/:/g, '-').replace(/[\\/]/g, '-');
}

function getProjectsDir(): string {
  return PROJECTS_DIR;
}

interface SessionMetadata {
  cwd?: string;
  firstMessage: string | null;
}

function readSessionMetadata(filePath: string): SessionMetadata | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    let cwd: string | undefined;
    let firstMessage: string | null = null;

    for (const line of content.split('\n')) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line);
        if (!cwd && typeof entry.cwd === 'string' && entry.cwd.trim()) {
          cwd = entry.cwd;
        }

        if (entry.type === 'user' && entry.message) {
          const rawContent = entry.message.content ?? '';
          let text = '';

          if (typeof rawContent === 'string') {
            text = rawContent;
          } else if (Array.isArray(rawContent)) {
            for (const block of rawContent) {
              if (block?.type === 'text' && typeof block.text === 'string' && !block.text.startsWith('<')) {
                text = block.text;
                break;
              }
            }
          }

          if (!text) {
            continue;
          }

          firstMessage = text.length > 50 ? `${text.slice(0, 50)}...` : text;
        }

        if (cwd && firstMessage !== null) {
          break;
        }
      } catch {
        continue;
      }
    }

    return { cwd, firstMessage };
  } catch (error: any) {
    logger.warn('[SessionScanner] Failed to read session file', {
      filePath,
      error: error.message,
    });
  }

  return null;
}

function collectSessionsForDir(projectDir: string, fallbackCwd: string | undefined, limit = Number.POSITIVE_INFINITY): SessionSummary[] {
  if (!existsSync(projectDir)) {
    return [];
  }

  try {
    const sessionFiles = readdirSync(projectDir)
      .filter(file => file.endsWith('.jsonl'))
      .map(file => {
        const filePath = join(projectDir, file);
        return {
          sessionId: file.replace(/\.jsonl$/, ''),
          filePath,
          mtimeMs: statSync(filePath).mtimeMs,
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const sessions: SessionSummary[] = [];
    for (const file of sessionFiles) {
      if (sessions.length >= limit) {
        break;
      }

      const metadata = readSessionMetadata(file.filePath);
      if (!metadata || metadata.firstMessage === null) {
        continue;
      }

      const cwd = metadata.cwd ?? fallbackCwd;
      if (!cwd) {
        logger.warn('[SessionScanner] Skipping session without cwd metadata', {
          filePath: file.filePath,
        });
        continue;
      }

      sessions.push({
        sessionId: file.sessionId,
        cwd,
        filePath: file.filePath,
        firstMessage: metadata.firstMessage,
        mtimeMs: file.mtimeMs,
      });
    }

    return sessions;
  } catch (error: any) {
    logger.error('[SessionScanner] Failed to scan sessions', {
      cwd: fallbackCwd,
      error: error.message,
    });
    return [];
  }
}

function scanAllSessions(limit = Number.POSITIVE_INFINITY): SessionSummary[] {
  const projectsDir = getProjectsDir();
  if (!existsSync(projectsDir)) {
    return [];
  }

  try {
    return readdirSync(projectsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => !entry.name.includes('Temp'))
      .flatMap(entry => collectSessionsForDir(join(projectsDir, entry.name), undefined))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limit);
  } catch (error: any) {
    logger.error('[SessionScanner] Failed to scan all sessions', {
      error: error.message,
    });
    return [];
  }
}

export function getValidSessions(cwd: string, defaultCwd: string, limitPerDir = 5): SessionSummary[] {
  if (cwd === defaultCwd) {
    return scanAllSessions(limitPerDir);
  }

  const currentProjectDir = join(getProjectsDir(), cwdToProjectDir(cwd));
  return collectSessionsForDir(currentProjectDir, cwd, limitPerDir);
}

export function getSessionList(cwd: string, defaultCwd: string): SessionTarget[] {
  const sessions = cwd === defaultCwd
    ? scanAllSessions()
    : collectSessionsForDir(join(getProjectsDir(), cwdToProjectDir(cwd)), cwd);

  return sessions.map(session => ({
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

export function sessionExists(cwd: string, sessionId: string): boolean {
  const projectDir = join(getProjectsDir(), cwdToProjectDir(cwd));
  const sessionFile = join(projectDir, `${sessionId}.jsonl`);
  return existsSync(sessionFile);
}
