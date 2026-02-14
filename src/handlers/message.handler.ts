import logger from '../utils/logger';
import messageService from '../services/message.service';

interface MessageEvent {
  sender: {
    sender_id: {
      open_id: string;
      user_id?: string;
    };
    sender_type: string;
  };
  message: {
    message_id: string;
    message_type: string;
    content: string;
    chat_id: string;
  };
}

export async function handleMessage(data: MessageEvent): Promise<void> {
  const { sender, message } = data;

  logger.info('Processing message', {
    messageId: message.message_id,
    chatId: message.chat_id,
    senderId: sender.sender_id.open_id,
  });

  // 解析消息内容
  let content: any;
  try {
    content = JSON.parse(message.content);
  } catch (error) {
    logger.error('Failed to parse message content', { error });
    return;
  }

  // 处理文本消息
  if (message.message_type === 'text') {
    const text = content.text;
    logger.info('Received text message', { text });

    // 简单的回复逻辑
    const reply = `你说: ${text}`;
    await messageService.sendTextMessage(message.chat_id, reply);
  }
}
