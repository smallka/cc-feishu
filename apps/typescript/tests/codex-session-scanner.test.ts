import assert from 'assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

function writeSession(
  sessionsDir: string,
  datePath: string,
  cwd: string,
  sessionId: string,
  firstMessage: string,
  mtimeMs: number,
  options?: {
    bootstrapMessage?: string;
  },
): void {
  const targetDir = join(sessionsDir, datePath);
  mkdirSync(targetDir, { recursive: true });

  const filePath = join(targetDir, `rollout-${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      timestamp: new Date(mtimeMs).toISOString(),
      type: 'session_meta',
      payload: {
        id: sessionId,
        cwd,
      },
    }),
    JSON.stringify({
      timestamp: new Date(mtimeMs + 1).toISOString(),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: options?.bootstrapMessage ?? firstMessage,
          },
        ],
      },
    }),
  ];

  if (options?.bootstrapMessage) {
    lines.push(JSON.stringify({
      timestamp: new Date(mtimeMs + 2).toISOString(),
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: firstMessage,
          },
        ],
      },
    }));
  }

  writeFileSync(filePath, `${lines.join('\n')}\n`);
  const timestamp = new Date(mtimeMs);
  utimesSync(filePath, timestamp, timestamp);
}

const sandboxRoot = mkdtempSync(join(tmpdir(), 'cc-feishu-codex-session-scanner-'));
const sessionsDir = join(sandboxRoot, '.codex', 'sessions');
const currentCwd = 'C:\\work\\cc-feishu\\apps\\typescript';
const siblingCwd = 'C:\\work\\another-project';
const tempCwd = 'C:\\Users\\clawd\\AppData\\Local\\Temp\\scratch-project';
const os = require('os') as typeof import('os') & { homedir: () => string };
const originalHomedir = os.homedir;

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
mkdirSync(sessionsDir, { recursive: true });
os.homedir = () => sandboxRoot;

const scanner = require('../src/codex/session-scanner') as typeof import('../src/codex/session-scanner');

try {
  writeSession(
    sessionsDir,
    join('2026', '03', '16'),
    currentCwd,
    'session-old',
    'old current session',
    Date.now() - 20_000,
    {
      bootstrapMessage: '# AGENTS.md instructions for C:\\work\n\n<INSTRUCTIONS>\n...',
    },
  );
  writeSession(sessionsDir, join('2026', '03', '17'), tempCwd, 'session-temp', 'temp project session', Date.now() - 2_000);
  writeSession(sessionsDir, join('2026', '03', '17'), siblingCwd, 'session-other', 'other project session', Date.now() - 10_000);
  writeSession(sessionsDir, join('2026', '03', '17'), currentCwd, 'session-new', 'new current session', Date.now() - 5_000);

  const sessions = scanner.getValidSessions(currentCwd, undefined, 5);
  assert.equal(sessions.length, 2, 'expected only current cwd sessions outside the default directory');
  assert.equal(sessions[0].sessionId, 'session-new');
  assert.equal(sessions[0].cwd, currentCwd);
  assert.equal(sessions[1].sessionId, 'session-old');
  assert.equal(sessions[1].firstMessage, 'old current session');

  const recentGlobalSessions = scanner.getValidSessions(currentCwd, currentCwd, 9);
  assert.deepEqual(recentGlobalSessions.map(session => session.sessionId), [
    'session-new',
    'session-other',
    'session-old',
  ]);

  const sessionList = scanner.getSessionList(currentCwd, currentCwd);
  assert.deepEqual(sessionList, [
    { sessionId: 'session-new', cwd: currentCwd },
    { sessionId: 'session-other', cwd: siblingCwd },
    { sessionId: 'session-old', cwd: currentCwd },
  ]);
  assert.deepEqual(scanner.getRecentDirectories(2), [
    { cwd: currentCwd, mtimeMs: recentGlobalSessions[0].mtimeMs },
    { cwd: siblingCwd, mtimeMs: recentGlobalSessions[1].mtimeMs },
  ]);

  const found = scanner.findSessionById('session-other');
  assert.deepEqual(found, {
    sessionId: 'session-other',
    cwd: siblingCwd,
  });

  assert.equal(scanner.findSessionById('session-temp'), null);
  assert.equal(scanner.findSessionById('missing-session'), null);

  console.log('codex-session-scanner.test.ts passed');
} finally {
  os.homedir = originalHomedir;
  rmSync(sandboxRoot, { recursive: true, force: true });
}
