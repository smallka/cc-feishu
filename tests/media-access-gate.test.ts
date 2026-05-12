import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin,ou_ops';

const { handleMessage } = require('../src/handlers/message.handler') as typeof import('../src/handlers/message.handler');
const { chatBindingStore } = require('../src/bot/chat-binding-store') as typeof import('../src/bot/chat-binding-store');
const chatService = (require('../src/services/chat.service') as typeof import('../src/services/chat.service')).default;
const messageService = (require('../src/services/message.service') as typeof import('../src/services/message.service')).default;

interface MessageEvent {
  sender: {
    sender_id: {
      open_id: string;
    };
    sender_type: string;
  };
  message: {
    message_id: string;
    message_type: string;
    content: string;
    chat_id: string;
    chat_type: string;
  };
}

function createImageEvent(messageId: string, chatId: string, openId: string): MessageEvent {
  return {
    sender: {
      sender_id: {
        open_id: openId,
      },
      sender_type: 'user',
    },
    message: {
      message_id: messageId,
      message_type: 'image',
      content: JSON.stringify({ image_key: 'img_test_key' }),
      chat_id: chatId,
      chat_type: 'group_chat',
    },
  };
}

function createFileEvent(messageId: string, chatId: string, openId: string): MessageEvent {
  return {
    sender: {
      sender_id: {
        open_id: openId,
      },
      sender_type: 'user',
    },
    message: {
      message_id: messageId,
      message_type: 'file',
      content: JSON.stringify({ file_key: 'file_test_key', file_name: 'report.txt' }),
      chat_id: chatId,
      chat_type: 'group_chat',
    },
  };
}

async function main(): Promise<void> {
  const originalBindingGet = chatBindingStore.get.bind(chatBindingStore);
  const originalGetChatName = chatService.getChatName.bind(chatService);
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);
  const originalDownloadImage = messageService.downloadMessageImage.bind(messageService);
  const originalDownloadFile = messageService.downloadMessageFile.bind(messageService);

  try {
    let imageDownloadCount = 0;
    let fileDownloadCount = 0;
    const sentTexts: string[] = [];

    messageService.downloadMessageImage = (async () => {
      imageDownloadCount += 1;
      return 'C:\\work\\cc-feishu\\tmp\\image.png';
    }) as typeof messageService.downloadMessageImage;
    messageService.downloadMessageFile = (async () => {
      fileDownloadCount += 1;
      return 'C:\\work\\cc-feishu\\tmp\\report.txt';
    }) as typeof messageService.downloadMessageFile;
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      sentTexts.push(text);
    }) as typeof messageService.sendTextMessage;
    chatService.getChatName = (async () => null) as typeof chatService.getChatName;
    chatBindingStore.get = ((chatId: string) => {
      if (chatId === 'oc_media_invalid_binding') {
        return {
          cwd: 'C:\\work\\definitely-missing-media-access-gate',
          updatedAt: '2026-05-12T00:00:00.000Z',
        };
      }
      return originalBindingGet(chatId);
    }) as typeof chatBindingStore.get;

    await handleMessage(createImageEvent('om_media_unauthorized', 'oc_media_unauthorized', 'ou_guest') as never);
    assert.equal(imageDownloadCount, 0, 'unauthorized image should not be downloaded');
    assert.match(sentTexts.at(-1) ?? '', /ou_guest/);

    await handleMessage(createFileEvent('om_media_unbound', 'oc_media_unbound', 'ou_admin') as never);
    assert.equal(fileDownloadCount, 0, 'unbound file should not be downloaded before binding succeeds');
    assert.match(sentTexts.at(-1) ?? '', /尚未绑定工作目录/);

    await handleMessage(createImageEvent('om_media_invalid_binding', 'oc_media_invalid_binding', 'ou_admin') as never);
    assert.equal(imageDownloadCount, 0, 'image with invalid binding should not be downloaded');
    assert.match(sentTexts.at(-1) ?? '', /绑定目录不存在/);

    console.log('media-access-gate.test.ts passed');
  } finally {
    chatBindingStore.get = originalBindingGet as typeof chatBindingStore.get;
    chatService.getChatName = originalGetChatName as typeof chatService.getChatName;
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
    messageService.downloadMessageImage = originalDownloadImage as typeof messageService.downloadMessageImage;
    messageService.downloadMessageFile = originalDownloadFile as typeof messageService.downloadMessageFile;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
