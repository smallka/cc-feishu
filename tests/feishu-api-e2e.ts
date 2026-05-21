import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import {
  assertLarkCliReady,
  requireEnv,
  optionalIntEnv,
  requireLarkCliConfigDir,
  sendTextMessage,
  waitForMatchingMessage,
  type ListedMessage,
} from './feishu-e2e-utils';

const DEFAULT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 3_000;

function findStatReply(message: ListedMessage): boolean {
  return (message.content ?? '').includes('Provider:');
}

async function main(): Promise<void> {
  const chatId = requireEnv('FEISHU_E2E_CHAT_ID');
  const timeoutMs = optionalIntEnv('FEISHU_E2E_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const configDir = requireLarkCliConfigDir();

  console.log(`[E2E] 使用 lark-cli 配置目录: ${configDir}`);
  const status = await assertLarkCliReady();
  console.log(`[E2E] 已登录用户: ${status.userName ?? '(unknown)'} (${status.userOpenId ?? 'unknown open_id'})`);

  const runId = `cc-e2e-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const start = new Date(Date.now() - 5_000);
  const sent = await sendTextMessage(chatId, '/stat', runId);
  assert.equal(sent.chat_id, chatId, '发送返回的 chat_id 与 FEISHU_E2E_CHAT_ID 不一致');
  console.log(`[E2E] 已发送 /stat: ${sent.message_id ?? '(unknown message_id)'}`);

  const reply = await waitForMatchingMessage({
    chatId,
    senderOpenId: status.userOpenId,
    start,
    timeoutMs,
    pollIntervalMs: POLL_INTERVAL_MS,
    match: findStatReply,
    describeTimeout: lastTotal => `等待 /stat 回复超时，最近消息数: ${lastTotal}`,
  });
  console.log(`[E2E] 已收到 bot 回复: ${reply.message_id ?? '(unknown message_id)'}`);
  console.log('[E2E] 回复摘要:');
  console.log((reply.content ?? '').slice(0, 500));
}

void main().catch((error) => {
  console.error('[E2E] 失败:', error.message);
  process.exitCode = 1;
});

