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

const DEFAULT_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 10_000;

function buildPrompt(marker: string): string {
  return [
    `E2E_MARKER: ${marker}`,
    '这是一条自动化 E2E 请求。',
    '请创建一个单页 PPTX 文件，主题是“飞书 Bot 交付验证”。',
    'PPT 只需要 1 页，包含标题、3 个要点和一个简洁视觉元素即可。',
    '请把 E2E_MARKER 放进 PPT 标题或页脚中，方便验证。',
    '请按当前交互环境的默认文件交付方式完成，不要先询问我。',
    '最终回复请原样包含上面的 E2E_MARKER，并说明交付结果。',
  ].join('\n');
}

function isPptFileDeliveryReply(marker: string, message: ListedMessage): boolean {
  const content = message.content ?? '';
  if (!content.includes(marker)) {
    return false;
  }

  const mentionsPpt = /\.pptx\b|PPTX|PPT|幻灯片/.test(content);
  const mentionsFeishuConversation = /飞书会话|飞书群|当前会话|群聊|E2E 飞书会话|FEISHU_E2E_CHAT_ID|chat_id|message_id|消息 ID/.test(content);
  const mentionsDelivery = /上传|已传|发送|已发送|交付|file_key|message_id|消息 ID/.test(content);
  const mentionsLocalCopy = /本地|local|路径|保留|文件：`?[A-Za-z]:\\/.test(content);
  return mentionsPpt && mentionsFeishuConversation && mentionsDelivery && mentionsLocalCopy;
}

function isMarkerReply(marker: string, message: ListedMessage): boolean {
  return (message.content ?? '').includes(marker);
}

async function waitForReset(chatId: string, senderOpenId: string | undefined, start: Date): Promise<void> {
  await waitForMatchingMessage({
    chatId,
    senderOpenId,
    start,
    timeoutMs: 60_000,
    pollIntervalMs: POLL_INTERVAL_MS,
    match: message => (message.content ?? '').includes('会话已重置'),
    describeTimeout: lastTotal => `等待 /new 重置回复超时，最近消息数: ${lastTotal}`,
  });
}

async function main(): Promise<void> {
  const chatId = requireEnv('FEISHU_E2E_CHAT_ID');
  const timeoutMs = optionalIntEnv('FEISHU_CODEX_PPT_UPLOAD_E2E_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const configDir = requireLarkCliConfigDir();

  console.log(`[E2E] 使用 lark-cli 配置目录: ${configDir}`);
  const status = await assertLarkCliReady();
  console.log(`[E2E] 已登录用户: ${status.userName ?? '(unknown)'} (${status.userOpenId ?? 'unknown open_id'})`);

  const resetRunId = `cc-ppt-reset-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const resetStart = new Date(Date.now() - 5_000);
  const resetSent = await sendTextMessage(chatId, '/new', resetRunId);
  assert.equal(resetSent.chat_id, chatId, '发送 /new 返回的 chat_id 与 FEISHU_E2E_CHAT_ID 不一致');
  console.log(`[E2E] 已发送 /new: ${resetSent.message_id ?? '(unknown message_id)'}`);
  await waitForReset(chatId, status.userOpenId, resetStart);
  console.log('[E2E] 已收到 /new 重置回复');

  const marker = `cc-feishu-ppt-upload-e2e-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const prompt = buildPrompt(marker);
  const promptRunId = `cc-ppt-upload-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const promptStart = new Date(Date.now() - 5_000);
  const sent = await sendTextMessage(chatId, prompt, promptRunId);
  assert.equal(sent.chat_id, chatId, '发送 PPT 请求返回的 chat_id 与 FEISHU_E2E_CHAT_ID 不一致');
  console.log(`[E2E] 已发送 PPT 交付请求: ${sent.message_id ?? '(unknown message_id)'}`);

  const reply = await waitForMatchingMessage({
    chatId,
    senderOpenId: status.userOpenId,
    start: promptStart,
    timeoutMs,
    pollIntervalMs: POLL_INTERVAL_MS,
    match: message => isMarkerReply(marker, message),
    describeTimeout: lastTotal => `等待 Codex PPT 交付回复超时，最近消息数: ${lastTotal}`,
  });

  console.log(`[E2E] 已收到 PPT 交付回复: ${reply.message_id ?? '(unknown message_id)'}`);
  console.log('[E2E] 回复摘要:');
  console.log((reply.content ?? '').slice(0, 1200));
  assert.ok(
    isPptFileDeliveryReply(marker, reply),
    'Codex 已回复 PPT 交付结果，但回复未体现“发送到当前飞书会话 + 本地路径保留”，不满足默认文件交付预期',
  );
}

void main().catch((error) => {
  console.error('[E2E] 失败:', error.message);
  process.exitCode = 1;
});
