import assert from 'assert/strict';

process.env.FEISHU_APP_ID = process.env.FEISHU_APP_ID || 'test-app-id';
process.env.FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'test-app-secret';
process.env.FEISHU_ALLOWED_OPEN_IDS = 'ou_admin,ou_ops';

const { handleMessage } = require('../src/handlers/message.handler') as typeof import('../src/handlers/message.handler');
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

function createTextEvent(messageId: string, openId: string, text: string): MessageEvent {
  return {
    sender: {
      sender_id: {
        open_id: openId,
      },
      sender_type: 'user',
    },
    message: {
      message_id: messageId,
      message_type: 'text',
      content: JSON.stringify({ text }),
      chat_id: 'oc_unauthorized',
      chat_type: 'group_chat',
    },
  };
}

async function main(): Promise<void> {
  const originalSendTextMessage = messageService.sendTextMessage.bind(messageService);

  try {
    let unauthorizedText = '';
    messageService.sendTextMessage = (async (_chatId: string, text: string) => {
      unauthorizedText = text;
    }) as typeof messageService.sendTextMessage;

    await handleMessage(createTextEvent('om_unauthorized', 'ou_guest', '继续实现') as never);

    assert.match(unauthorizedText, /ou_guest/, 'unauthorized text should include sender open_id');
    assert.match(
      unauthorizedText,
      /FEISHU_ALLOWED_OPEN_IDS/,
      'unauthorized text should tell the user which config entry needs updating',
    );

    console.log('unauthorized-handler.test.ts passed');
  } finally {
    messageService.sendTextMessage = originalSendTextMessage as typeof messageService.sendTextMessage;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
