import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  assertLarkCliReady,
  optionalIntEnv,
  requireEnv,
  requireLarkCliConfigDir,
  sendTextMessage,
  waitForMatchingMessage,
  type ListedMessage,
} from './feishu-e2e-utils';

const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 5_000;

function buildPrompt(marker: string): string {
  return [
    `E2E_MARKER: ${marker}`,
    '这是一条自动化 E2E 提示词探针。',
    '请不要执行命令、不要读取文件、不要创建文件。',
    '请只用一小段中文回答，并原样包含上面的 E2E_MARKER。',
    '请说明你当前通过什么交互环境与用户沟通，以及用户是否一定能看到本地终端。',
  ].join('\n');
}

function isPromptProbeReply(marker: string, message: ListedMessage): boolean {
  const content = message.content ?? '';
  if (!content.includes(marker)) {
    return false;
  }

  const mentionsFeishuBot = /飞书|Feishu|Lark|bot|Bot/.test(content);
  const mentionsTerminalVisibility = /终端|terminal|Terminal|电脑前|看不到|不可见/.test(content);
  return mentionsFeishuBot && mentionsTerminalVisibility;
}

async function waitForReset(chatId: string, senderOpenId: string | undefined, start: Date, timeoutMs: number): Promise<void> {
  await waitForMatchingMessage({
    chatId,
    senderOpenId,
    start,
    timeoutMs,
    pollIntervalMs: POLL_INTERVAL_MS,
    match: message => (message.content ?? '').includes('会话已重置'),
    describeTimeout: lastTotal => `等待 /new 重置回复超时，最近消息数: ${lastTotal}`,
  });
}

async function main(): Promise<void> {
  const chatId = requireEnv('FEISHU_E2E_CHAT_ID');
  const timeoutMs = optionalIntEnv('FEISHU_CODEX_PROMPT_E2E_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const configDir = requireLarkCliConfigDir();

  console.log(`[E2E] 使用 lark-cli 配置目录: ${configDir}`);
  const status = await assertLarkCliReady();
  console.log(`[E2E] 已登录用户: ${status.userName ?? '(unknown)'} (${status.userOpenId ?? 'unknown open_id'})`);

  const resetRunId = `cc-prompt-reset-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const resetStart = new Date(Date.now() - 5_000);
  const resetSent = await sendTextMessage(chatId, '/new', resetRunId);
  assert.equal(resetSent.chat_id, chatId, '发送 /new 返回的 chat_id 与 FEISHU_E2E_CHAT_ID 不一致');
  console.log(`[E2E] 已发送 /new: ${resetSent.message_id ?? '(unknown message_id)'}`);
  await waitForReset(chatId, status.userOpenId, resetStart, 60_000);
  console.log('[E2E] 已收到 /new 重置回复');

  const marker = `cc-feishu-prompt-e2e-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const prompt = buildPrompt(marker);
  const promptRunId = `cc-prompt-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const promptStart = new Date(Date.now() - 5_000);
  const sent = await sendTextMessage(chatId, prompt, promptRunId);
  assert.equal(sent.chat_id, chatId, '发送 prompt 返回的 chat_id 与 FEISHU_E2E_CHAT_ID 不一致');
  console.log(`[E2E] 已发送 Codex prompt 探针: ${sent.message_id ?? '(unknown message_id)'}`);

  const reply = await waitForMatchingMessage({
    chatId,
    senderOpenId: status.userOpenId,
    start: promptStart,
    timeoutMs,
    pollIntervalMs: POLL_INTERVAL_MS,
    match: message => isPromptProbeReply(marker, message),
    describeTimeout: lastTotal => `等待 Codex prompt 探针回复超时，最近消息数: ${lastTotal}`,
  });

  console.log(`[E2E] 已收到 Codex prompt 探针回复: ${reply.message_id ?? '(unknown message_id)'}`);
  console.log('[E2E] 回复摘要:');
  console.log((reply.content ?? '').slice(0, 800));
}

void main().catch((error) => {
  console.error('[E2E] 失败:', error.message);
  process.exitCode = 1;
});

