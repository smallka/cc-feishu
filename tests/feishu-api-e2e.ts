import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

const LARK_CLI = resolveLarkCliCommand();
const REQUIRED_SCOPES = [
  'im:message',
  'im:message.send_as_user',
  'im:message.group_msg:get_as_user',
  'contact:user.base:readonly',
];
const DEFAULT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

interface AuthStatus {
  appId?: string;
  identity?: string;
  userOpenId?: string;
  userName?: string;
  tokenStatus?: string;
}

interface SentMessage {
  message_id?: string;
  chat_id?: string;
  create_time?: string;
}

interface ListedMessage {
  message_id?: string;
  msg_type?: string;
  content?: string;
  create_time?: string;
  sender?: {
    id?: string;
    sender_type?: string;
    name?: string;
  };
}

interface MessageList {
  messages?: ListedMessage[];
  total?: number;
}

interface DataEnvelope<T> {
  data?: T;
}

function resolveLarkCliCommand(): { command: string; prefixArgs: string[] } {
  if (process.env.LARK_CLI_BIN) {
    return { command: process.env.LARK_CLI_BIN, prefixArgs: [] };
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      const scriptPath = path.join(appData, 'npm', 'node_modules', '@larksuite', 'cli', 'scripts', 'run.js');
      if (existsSync(scriptPath)) {
        return { command: process.execPath, prefixArgs: [scriptPath] };
      }
    }
  }

  return { command: 'lark-cli', prefixArgs: [] };
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

function optionalIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} 必须是正整数毫秒值`);
  }
  return Math.floor(parsed);
}

function runLarkCli(args: string[], options: { timeoutMs?: number } = {}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const child = spawn(LARK_CLI.command, [...LARK_CLI.prefixArgs, ...args], {
      env: process.env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      child.kill();
      if (!settled) {
        settled = true;
        resolve({
          exitCode: null,
          stdout,
          stderr: `${stderr}\ncommand timed out after ${timeoutMs}ms`.trim(),
        });
      }
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk;
    });

    child.on('error', error => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: null, stdout, stderr, error });
    });

    child.on('close', exitCode => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function parseJson<T>(result: CommandResult, commandLabel: string): T {
  if (result.exitCode !== 0 || result.error) {
    throw new Error([
      `${commandLabel} 执行失败`,
      `exitCode: ${result.exitCode ?? 'null'}`,
      result.error ? `error: ${result.error.message}` : '',
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : '',
      result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : '',
    ].filter(Boolean).join('\n'));
  }

  try {
    return JSON.parse(result.stdout) as T;
  } catch (error: any) {
    throw new Error(`${commandLabel} 未返回合法 JSON: ${error.message}\nstdout:\n${result.stdout}`);
  }
}

function unwrapData<T>(value: T | DataEnvelope<T>): T {
  const maybeEnvelope = value as DataEnvelope<T>;
  return maybeEnvelope.data ?? value as T;
}

async function assertLarkCliReady(): Promise<AuthStatus> {
  const status = parseJson<AuthStatus>(
    await runLarkCli(['auth', 'status', '--verify']),
    'lark-cli auth status --verify',
  );

  assert.equal(status.identity, 'user', 'lark-cli 需要以 user 身份登录 testbot 应用');
  assert.notEqual(status.tokenStatus, 'expired', 'lark-cli 用户 token 已过期，请重新 auth login');

  const check = await runLarkCli(['auth', 'check', '--scope', REQUIRED_SCOPES.join(' ')]);
  if (check.exitCode !== 0) {
    throw new Error([
      'lark-cli 用户授权 scope 不足',
      `请在 testbot 专用配置目录下执行: lark-cli auth login --scope "${REQUIRED_SCOPES.join(' ')}"`,
      check.stderr.trim() ? `stderr:\n${check.stderr.trim()}` : '',
      check.stdout.trim() ? `stdout:\n${check.stdout.trim()}` : '',
    ].filter(Boolean).join('\n'));
  }

  return status;
}

function isoWithLocalOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, '0');
  const minutes = String(abs % 60).padStart(2, '0');
  const local = new Date(date.getTime() + offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 19)
    .replace('Z', '');
  return `${local}${sign}${hours}:${minutes}`;
}

async function sendStat(chatId: string, runId: string): Promise<SentMessage> {
  return unwrapData(parseJson<SentMessage | DataEnvelope<SentMessage>>(
    await runLarkCli([
      'im',
      '+messages-send',
      '--as',
      'user',
      '--chat-id',
      chatId,
      '--text',
      '/stat',
      '--idempotency-key',
      runId,
    ]),
    'lark-cli im +messages-send',
  ));
}

async function listRecentMessages(chatId: string, start: Date): Promise<MessageList> {
  const end = new Date(Date.now() + 30_000);
  return unwrapData(parseJson<MessageList | DataEnvelope<MessageList>>(
    await runLarkCli([
      'im',
      '+chat-messages-list',
      '--as',
      'user',
      '--chat-id',
      chatId,
      '--start',
      isoWithLocalOffset(start),
      '--end',
      isoWithLocalOffset(end),
      '--sort',
      'desc',
      '--page-size',
      '50',
      '--format',
      'json',
    ]),
    'lark-cli im +chat-messages-list',
  ));
}

function findStatReply(list: MessageList, senderOpenId: string | undefined): ListedMessage | null {
  const messages = list.messages ?? [];
  return messages.find((message) => {
    if (message.sender?.id && senderOpenId && message.sender.id === senderOpenId) {
      return false;
    }
    return (message.content ?? '').includes('Provider:');
  }) ?? null;
}

async function waitForStatReply(
  chatId: string,
  senderOpenId: string | undefined,
  start: Date,
  timeoutMs: number,
): Promise<ListedMessage> {
  const deadline = Date.now() + timeoutMs;
  let lastTotal = 0;

  while (Date.now() < deadline) {
    const list = await listRecentMessages(chatId, start);
    lastTotal = list.total ?? list.messages?.length ?? 0;
    const reply = findStatReply(list, senderOpenId);
    if (reply) {
      return reply;
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`等待 /stat 回复超时，最近消息数: ${lastTotal}`);
}

async function main(): Promise<void> {
  const chatId = requireEnv('FEISHU_E2E_CHAT_ID');
  const timeoutMs = optionalIntEnv('FEISHU_E2E_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const configDir = process.env.LARKSUITE_CLI_CONFIG_DIR?.trim();

  if (!configDir) {
    throw new Error('缺少 LARKSUITE_CLI_CONFIG_DIR；请使用 testbot 专用 lark-cli 配置目录运行 E2E');
  }

  console.log(`[E2E] 使用 lark-cli 配置目录: ${configDir}`);
  const status = await assertLarkCliReady();
  console.log(`[E2E] 已登录用户: ${status.userName ?? '(unknown)'} (${status.userOpenId ?? 'unknown open_id'})`);

  const runId = `cc-e2e-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const start = new Date(Date.now() - 5_000);
  const sent = await sendStat(chatId, runId);
  assert.equal(sent.chat_id, chatId, '发送返回的 chat_id 与 FEISHU_E2E_CHAT_ID 不一致');
  console.log(`[E2E] 已发送 /stat: ${sent.message_id ?? '(unknown message_id)'}`);

  const reply = await waitForStatReply(chatId, status.userOpenId, start, timeoutMs);
  console.log(`[E2E] 已收到 bot 回复: ${reply.message_id ?? '(unknown message_id)'}`);
  console.log('[E2E] 回复摘要:');
  console.log((reply.content ?? '').slice(0, 500));
}

void main().catch((error) => {
  console.error('[E2E] 失败:', error.message);
  process.exitCode = 1;
});
