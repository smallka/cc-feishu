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
const os = require('os') as typeof import('os') & { homedir: () => string };
const originalHomedir = os.homedir;

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
mkdirSync(projectsDir, { recursive: true });
os.homedir = () => sandboxRoot;

const scanner = require('../src/claude/session-scanner') as typeof import('../src/claude/session-scanner');

try {
  const now = Date.now();

  for (let index = 0; index < 10; index += 1) {
    const cwd = index % 2 === 0 ? defaultCwd : siblingCwd;
    writeSession(projectsDir, cwd, `session-${index}`, `session ${index}`, now - index * 1_000);
  }

  const sessions = scanner.getValidSessions(defaultCwd, defaultCwd, 9);

  assert.equal(sessions.length, 9, 'expected the most recent 9 sessions across directories');
  assert.deepEqual(sessions[0], {
    sessionId: 'session-0',
    cwd: defaultCwd,
    filePath: join(projectsDir, cwdToProjectDir(defaultCwd), 'session-0.jsonl'),
    firstMessage: 'session 0',
    mtimeMs: sessions[0].mtimeMs,
  });
  assert.deepEqual(sessions[1], {
    sessionId: 'session-1',
    cwd: siblingCwd,
    filePath: join(projectsDir, cwdToProjectDir(siblingCwd), 'session-1.jsonl'),
    firstMessage: 'session 1',
    mtimeMs: sessions[1].mtimeMs,
  });

  const sessionList = scanner.getSessionList(defaultCwd, defaultCwd);
  assert.equal(sessionList.length, 10, 'expected session list to include all resumable sessions');
  assert.deepEqual(sessionList[0], {
    sessionId: 'session-0',
    cwd: defaultCwd,
  });
  assert.deepEqual(scanner.getRecentDirectories(2), [
    { cwd: defaultCwd, mtimeMs: sessions[0].mtimeMs },
    { cwd: siblingCwd, mtimeMs: sessions[1].mtimeMs },
  ]);
  assert.deepEqual(scanner.findSessionById('session-3'), {
    sessionId: 'session-3',
    cwd: siblingCwd,
  });

  console.log('session-scanner.test.ts passed');
} finally {
  os.homedir = originalHomedir;
  rmSync(sandboxRoot, { recursive: true, force: true });
}
