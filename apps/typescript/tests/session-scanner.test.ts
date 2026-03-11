import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function cwdToProjectDir(cwd: string): string {
  return cwd.replace(/:/g, '-').replace(/[\\/]/g, '-');
}

function writeSession(
  projectsDir: string,
  cwd: string,
  sessionId: string,
  firstMessage: string,
  mtimeMs: number,
): void {
  const projectDir = join(projectsDir, cwdToProjectDir(cwd));
  mkdirSync(projectDir, { recursive: true });

  const filePath = join(projectDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      cwd,
      sessionId,
      type: 'user',
      message: {
        role: 'user',
        content: firstMessage,
      },
    }),
  ];

  writeFileSync(filePath, `${lines.join('\n')}\n`);
  const timestamp = new Date(mtimeMs);
  utimesSync(filePath, timestamp, timestamp);
}

const sandboxRoot = mkdtempSync(join(tmpdir(), 'cc-feishu-session-scanner-'));
const projectsDir = join(sandboxRoot, '.claude', 'projects');
const defaultCwd = 'C:\\work\\cc-feishu';
const siblingCwd = 'C:\\work\\my-project-alpha';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.CLAUDE_PROJECTS_DIR = projectsDir;
mkdirSync(projectsDir, { recursive: true });

const { getSessionList } = require('../src/claude/session-scanner') as typeof import('../src/claude/session-scanner');

try {
  writeSession(projectsDir, defaultCwd, 'root-session', 'root session', Date.now() - 10_000);
  writeSession(projectsDir, siblingCwd, 'alpha-session', 'alpha session', Date.now() - 5_000);

  const sessions = getSessionList(defaultCwd, defaultCwd);

  assert.equal(sessions.length, 2, 'expected current and sibling sessions');
  assert.deepEqual(sessions[0], {
    sessionId: 'root-session',
    cwd: defaultCwd,
  });
  assert.deepEqual(sessions[1], {
    sessionId: 'alpha-session',
    cwd: siblingCwd,
  });
  assert.equal(sessions[1].cwd, siblingCwd, 'sibling cwd should come from transcript metadata');

  console.log('session-scanner.test.ts passed');
} finally {
  delete process.env.CLAUDE_PROJECTS_DIR;
  rmSync(sandboxRoot, { recursive: true, force: true });
}
