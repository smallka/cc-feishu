import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import logger from '../utils/logger';

export interface SessionSummary {
  sessionId: string;
  cwd: string;
  filePath: string;
  firstMessage: string;
  mtimeMs: number;
}

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

function cwdToProjectDir(cwd: string): string {
  return cwd.replace(/:/g, '-').replace(/[\\/]/g, '-');
}

function projectDirToCwd(projectDirName: string): string {
  return projectDirName.replace('-', ':').replace(/-/g, '\\');
}

function readFirstUserMessage(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      if (!line.trim()) {
        continue;
      }

      try {
        const entry = JSON.parse(line);
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

          return text.length > 50 ? `${text.slice(0, 50)}...` : text;
        }
      } catch {
        continue;
      }
    }
  } catch (error: any) {
    logger.warn('[SessionScanner] Failed to read session file', {
      filePath,
      error: error.message,
    });
  }

  return null;
}

function collectSessionsForDir(projectDir: string, cwd: string, limit: number): SessionSummary[] {
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

      const firstMessage = readFirstUserMessage(file.filePath);
      if (firstMessage === null) {
        continue;
      }

      sessions.push({
        sessionId: file.sessionId,
        cwd,
        filePath: file.filePath,
        firstMessage,
        mtimeMs: file.mtimeMs,
      });
    }

    return sessions;
  } catch (error: any) {
    logger.error('[SessionScanner] Failed to scan sessions', {
      cwd,
      error: error.message,
    });
    return [];
  }
}

export function getValidSessions(cwd: string, defaultCwd: string, limitPerDir = 5): SessionSummary[] {
  const normalizedCurrentDir = cwdToProjectDir(cwd);
  const currentProjectDir = join(PROJECTS_DIR, normalizedCurrentDir);
  const sessions = collectSessionsForDir(currentProjectDir, cwd, limitPerDir);

  if (cwd !== defaultCwd || !existsSync(PROJECTS_DIR)) {
    return sessions;
  }

  try {
    const siblingDirs = readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .filter(entry => entry.name !== normalizedCurrentDir)
      .filter(entry => !entry.name.includes('Temp'))
      .map(entry => {
        const projectDir = join(PROJECTS_DIR, entry.name);
        const latestSession = collectSessionsForDir(projectDir, projectDirToCwd(entry.name), 1)[0];
        return latestSession ?? null;
      })
      .filter((session): session is SessionSummary => session !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, limitPerDir);

    return sessions.concat(siblingDirs);
  } catch (error: any) {
    logger.error('[SessionScanner] Failed to scan sibling sessions', {
      cwd,
      error: error.message,
    });
    return sessions;
  }
}

export function getSessionList(cwd: string, defaultCwd: string): Array<{ sessionId: string; cwd: string }> {
  return getValidSessions(cwd, defaultCwd).map(session => ({
    sessionId: session.sessionId,
    cwd: session.cwd,
  }));
}

export function sessionExists(cwd: string, sessionId: string): boolean {
  const projectDir = join(PROJECTS_DIR, cwdToProjectDir(cwd));
  const sessionFile = join(projectDir, `${sessionId}.jsonl`);
  return existsSync(sessionFile);
}
