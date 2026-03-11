import { readdirSync, openSync, readSync, closeSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import logger from '../utils/logger';

export interface SessionSummary {
  sessionId: string;
  timestamp: string;
  firstMessage: string;
}

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');

/**
 * 将 cwd 路径转换为 Claude Code projects 目录名
 * e.g. C:\work\cc-feishu → c--work-cc-feishu
 */
function cwdToProjectDir(cwd: string): string {
  return cwd
    .replace(/:/g, '-')
    .replace(/[\\/]/g, '-')
    .toLowerCase();
}

/**
 * 在 projects 目录中查找匹配的项目目录（大小写不敏感）
 */
function findProjectDir(cwd: string): string | null {
  const target = cwdToProjectDir(cwd);
  try {
    const dirs = readdirSync(PROJECTS_DIR);
    const match = dirs.find(d => d.toLowerCase() === target);
    return match ? join(PROJECTS_DIR, match) : null;
  } catch {
    return null;
  }
}

/**
 * 从 .jsonl 文件中提取 session 摘要信息
 */
function parseSessionFile(filePath: string): SessionSummary | null {
  try {
    const fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const bytesRead = readSync(fd, buf, 0, 8192, 0);
    closeSync(fd);
    const content = buf.toString('utf-8', 0, bytesRead);
    const lines = content.split('\n');

    let sessionId: string | undefined;
    let timestamp: string | undefined;
    let firstMessage: string | undefined;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'user' && entry.message?.role === 'user') {
          sessionId = entry.sessionId;
          timestamp = entry.timestamp;
          const rawContent = entry.message.content;
          let msg = '';
          if (typeof rawContent === 'string') {
            msg = rawContent;
          } else if (Array.isArray(rawContent)) {
            // content 是 [{type: "text", text: "..."}] 数组格式
            // 跳过 ide_opened_file 等系统标签，取第一条纯用户文本
            for (const block of rawContent) {
              if (block.type === 'text' && block.text && !block.text.startsWith('<')) {
                msg = block.text;
                break;
              }
            }
          }
          firstMessage = msg.length > 50 ? msg.slice(0, 50) + '...' : msg;
          break;
        }
      } catch { /* skip malformed lines */ }
    }

    if (!sessionId || !timestamp) return null;
    return { sessionId, timestamp, firstMessage: firstMessage || '(空)' };
  } catch {
    return null;
  }
}

/**
 * 扫描指定 cwd 下的所有 Claude Code sessions，返回最近的 N 个
 */
export function scanSessions(cwd: string, limit = 5): SessionSummary[] {
  const projectDir = findProjectDir(cwd);
  if (!projectDir) {
    logger.debug('[SessionScanner] No project dir found for cwd', { cwd });
    return [];
  }

  try {
    const files = readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: join(projectDir, f),
        mtime: statSync(join(projectDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    const sessions: SessionSummary[] = [];
    for (const file of files) {
      const summary = parseSessionFile(file.path);
      if (summary) sessions.push(summary);
    }
    return sessions;
  } catch (err: any) {
    logger.error('[SessionScanner] Failed to scan sessions', { cwd, error: err.message });
    return [];
  }
}
