import logger from '../utils/logger';

export interface MessageEvent {
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
    chat_type?: string;
  };
}

interface TextMessageContent {
  text?: string;
}

interface ImageMessageContent {
  image_key?: string;
}

interface FileMessageContent {
  file_key?: string;
  file_name?: string;
}

export interface ParsedMessageTask {
  data: MessageEvent;
  text: string;
  messageType: string;
  imageKey?: string;
  fileKey?: string;
  fileName?: string;
}

export function parseMessageTask(data: MessageEvent): ParsedMessageTask | null {
  const { message } = data;

  if (message.message_type === 'text') {
    return parseTextTask(data);
  }

  if (message.message_type === 'image') {
    return parseImageTask(data);
  }

  if (message.message_type === 'file') {
    return parseFileTask(data);
  }

  logger.debug('Skipping unsupported message type', {
    messageId: message.message_id,
    chatId: message.chat_id,
    messageType: message.message_type,
  });
  return null;
}

function parseTextTask(data: MessageEvent): ParsedMessageTask | null {
  const { message } = data;

  let content: TextMessageContent;
  try {
    content = JSON.parse(message.content) as TextMessageContent;
  } catch (error) {
    logger.error('Failed to parse text message content', {
      messageId: message.message_id,
      chatId: message.chat_id,
      error,
    });
    return null;
  }

  const text = (content.text || '').trim();
  if (!text) {
    logger.debug('Skipping empty text message', {
      messageId: message.message_id,
      chatId: message.chat_id,
    });
    return null;
  }

  return {
    data,
    text,
    messageType: 'text',
  };
}

function parseImageTask(data: MessageEvent): ParsedMessageTask | null {
  const { message } = data;
  const chatId = message.chat_id;

  let content: ImageMessageContent;
  try {
    content = JSON.parse(message.content) as ImageMessageContent;
  } catch (error) {
    logger.error('Failed to parse image message content', {
      messageId: message.message_id,
      chatId,
      error,
    });
    return null;
  }

  const imageKey = content.image_key?.trim();
  if (!imageKey) {
    logger.warn('Skipping image message without image key', {
      messageId: message.message_id,
      chatId,
    });
    return null;
  }

  return {
    data,
    text: '用户发送了一张图片，请结合图片内容继续处理当前请求。',
    messageType: 'image',
    imageKey,
  };
}

function parseFileTask(data: MessageEvent): ParsedMessageTask | null {
  const { message } = data;
  const chatId = message.chat_id;

  let content: FileMessageContent;
  try {
    content = JSON.parse(message.content) as FileMessageContent;
  } catch (error) {
    logger.error('Failed to parse file message content', {
      messageId: message.message_id,
      chatId,
      error,
    });
    return null;
  }

  const fileKey = content.file_key?.trim();
  if (!fileKey) {
    logger.warn('Skipping file message without file key', {
      messageId: message.message_id,
      chatId,
    });
    return null;
  }

  return {
    data,
    text: '用户发送了一个文件。',
    messageType: 'file',
    fileKey,
    fileName: content.file_name,
  };
}
