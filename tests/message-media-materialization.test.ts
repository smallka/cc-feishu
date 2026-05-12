import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin';

const {
  parseMessageTask,
} = require('../src/handlers/message-intake') as typeof import('../src/handlers/message-intake');
const {
  materializeQueuedTask,
} = require('../src/handlers/message-media-materialization') as typeof import('../src/handlers/message-media-materialization');
const { chatManager } = require('../src/bot/chat-manager') as typeof import('../src/bot/chat-manager');
const messageService = (require('../src/services/message.service') as typeof import('../src/services/message.service')).default;
import type { MessageEvent } from '../src/handlers/message-intake';

function createEvent(
  messageId: string,
  chatId: string,
  messageType: 'text' | 'image' | 'file',
  content: string,
): MessageEvent {
  return {
    sender: {
      sender_id: {
        open_id: 'ou_admin',
      },
      sender_type: 'user',
    },
    message: {
      message_id: messageId,
      message_type: messageType,
      content,
      chat_id: chatId,
      chat_type: 'group_chat',
    },
  };
}

async function main(): Promise<void> {
  const originalGetProvider = chatManager.getProvider.bind(chatManager);
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);
  const originalDownloadImage = messageService.downloadMessageImage.bind(messageService);
  const originalDownloadFile = messageService.downloadMessageFile.bind(messageService);

  try {
    const sentTexts: string[] = [];
    let imageDownloadCount = 0;
    let fileDownloadCount = 0;

    chatManager.getProvider = ((chatId?: string) => {
      if (chatId === 'oc_media_claude') {
        return 'claude';
      }
      return 'codex';
    }) as typeof chatManager.getProvider;
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      sentTexts.push(text);
    }) as typeof messageService.sendTextMessage;
    messageService.downloadMessageImage = (async (_messageId: string, imageKey: string) => {
      imageDownloadCount += 1;
      if (imageKey === 'img_fail') {
        throw new Error('image download failed');
      }
      return 'C:\\work\\cc-feishu\\tmp\\image.png';
    }) as typeof messageService.downloadMessageImage;
    messageService.downloadMessageFile = (async (_messageId: string, fileKey: string, _fileName?: string) => {
      fileDownloadCount += 1;
      if (fileKey === 'file_fail') {
        throw new Error('file download failed');
      }
      return 'C:\\work\\cc-feishu\\tmp\\report.txt';
    }) as typeof messageService.downloadMessageFile;

    const textTask = parseMessageTask(createEvent('om_media_text', 'oc_media_codex', 'text', JSON.stringify({ text: 'hello' })));
    assert.ok(textTask);
    const materializedTextTask = await materializeQueuedTask(textTask);
    assert.equal(materializedTextTask?.text, 'hello');
    assert.equal(materializedTextTask?.messageType, 'text');
    assert.equal(typeof materializedTextTask?.enqueuedAt, 'number');
    assert.equal(materializedTextTask?.imagePaths, undefined);

    const unsupportedImageTask = parseMessageTask(
      createEvent('om_media_img_unsupported', 'oc_media_claude', 'image', JSON.stringify({ image_key: 'img_ok' })),
    );
    assert.ok(unsupportedImageTask);
    assert.equal(await materializeQueuedTask(unsupportedImageTask), null);
    assert.equal(imageDownloadCount, 0);
    assert.equal(sentTexts.at(-1), '当前仅 Codex 支持图片消息，请先使用 /agent 切换到 Codex。');

    const unsupportedFileTask = parseMessageTask(
      createEvent('om_media_file_unsupported', 'oc_media_claude', 'file', JSON.stringify({ file_key: 'file_ok' })),
    );
    assert.ok(unsupportedFileTask);
    assert.equal(await materializeQueuedTask(unsupportedFileTask), null);
    assert.equal(fileDownloadCount, 0);
    assert.equal(sentTexts.at(-1), '当前仅 Codex 支持文件消息，请先使用 /agent 切换到 Codex。');

    const imageFailureTask = parseMessageTask(
      createEvent('om_media_img_fail', 'oc_media_codex', 'image', JSON.stringify({ image_key: 'img_fail' })),
    );
    assert.ok(imageFailureTask);
    assert.equal(await materializeQueuedTask(imageFailureTask), null);
    assert.equal(imageDownloadCount, 1);
    assert.equal(sentTexts.at(-1), '图片下载失败，请稍后重试。');

    const fileFailureTask = parseMessageTask(
      createEvent(
        'om_media_file_fail',
        'oc_media_codex',
        'file',
        JSON.stringify({ file_key: 'file_fail', file_name: 'broken.txt' }),
      ),
    );
    assert.ok(fileFailureTask);
    assert.equal(await materializeQueuedTask(fileFailureTask), null);
    assert.equal(fileDownloadCount, 1);
    assert.equal(sentTexts.at(-1), '文件下载失败，请稍后重试。');

    const fileSuccessTask = parseMessageTask(
      createEvent(
        'om_media_file_ok',
        'oc_media_codex',
        'file',
        JSON.stringify({ file_key: 'file_ok', file_name: 'report.txt' }),
      ),
    );
    assert.ok(fileSuccessTask);
    const materializedFileTask = await materializeQueuedTask(fileSuccessTask);
    assert.equal(fileDownloadCount, 2);
    assert.equal(materializedFileTask?.messageType, 'file');
    assert.equal(
      materializedFileTask?.text,
      [
        '用户发送了一个文件：report.txt。',
        '文件已保存到本地路径：C:\\work\\cc-feishu\\tmp\\report.txt',
        '请先读取该文件，再继续处理当前请求。',
      ].join('\n'),
    );

    const imageSuccessTask = parseMessageTask(
      createEvent('om_media_img_ok', 'oc_media_codex', 'image', JSON.stringify({ image_key: 'img_ok' })),
    );
    assert.ok(imageSuccessTask);
    const materializedImageTask = await materializeQueuedTask(imageSuccessTask);
    assert.equal(imageDownloadCount, 2);
    assert.deepEqual(materializedImageTask?.imagePaths, ['C:\\work\\cc-feishu\\tmp\\image.png']);
    assert.equal(materializedImageTask?.text, '用户发送了一张图片，请结合图片内容继续处理当前请求。');

    console.log('message-media-materialization.test.ts passed');
  } finally {
    chatManager.getProvider = originalGetProvider as typeof chatManager.getProvider;
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
    messageService.downloadMessageImage = originalDownloadImage as typeof messageService.downloadMessageImage;
    messageService.downloadMessageFile = originalDownloadFile as typeof messageService.downloadMessageFile;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
