import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import feishuClient from '../bot/client';
import logger from '../utils/logger';

const FEISHU_MEDIA_DIR = path.resolve(process.cwd(), 'tmp', 'feishu-media');

class MessageService {
  async addReaction(messageId: string, emojiType: string): Promise<string | null> {
    try {
      const client = feishuClient.getClient();
      const res = await (client.im.messageReaction as any).create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      });
      return res?.data?.reaction_id ?? null;
    } catch (error) {
      logger.warn('Failed to add reaction', { messageId, emojiType, error });
      return null;
    }
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    try {
      const client = feishuClient.getClient();
      await (client.im.messageReaction as any).delete({
        path: { message_id: messageId, reaction_id: reactionId },
      });
    } catch (error) {
      logger.warn('Failed to remove reaction', { messageId, reactionId, error });
    }
  }

  async sendTextMessage(chatId: string, text: string): Promise<void> {
    try {
      const client = feishuClient.getClient();

      await client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        },
      });

      logger.info('Text message sent', { chatId, text });
    } catch (error) {
      logger.error('Failed to send text message', { error, chatId });
      throw error;
    }
  }

  async sendCardMessage(chatId: string, markdown: string): Promise<void> {
    try {
      const client = feishuClient.getClient();

      await client.im.message.create({
        params: {
          receive_id_type: 'chat_id',
        },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify({
            config: {
              wide_screen_mode: true,
            },
            elements: [
              {
                tag: 'markdown',
                content: markdown,
              },
            ],
          }),
        },
      });

      logger.info('Card message sent', {
        chatId,
        contentLength: markdown.length,
        markdown,
      });
    } catch (error) {
      logger.error('Failed to send card message', { error, chatId });
      throw error;
    }
  }

  async downloadMessageImage(messageId: string, imageKey: string): Promise<string> {
    const resource = await this.downloadMessageResource(messageId, imageKey, 'image');
    const extension = resolveImageExtension(resource?.headers);
    const filePath = path.join(FEISHU_MEDIA_DIR, `${messageId}-${Date.now()}${extension}`);
    await resource.writeFile(filePath);

    logger.info('Downloaded image message resource', {
      messageId,
      imageKey,
      filePath,
    });

    return filePath;
  }

  async downloadMessageFile(messageId: string, fileKey: string, fileName?: string): Promise<string> {
    const resource = await this.downloadMessageResource(messageId, fileKey, 'file');
    const fallbackExtension = resolveFileExtension(resource?.headers);
    const safeFileName = buildStoredFileName(messageId, fileName, fallbackExtension);
    const filePath = path.join(FEISHU_MEDIA_DIR, safeFileName);
    await resource.writeFile(filePath);

    logger.info('Downloaded file message resource', {
      messageId,
      fileKey,
      fileName,
      filePath,
    });

    return filePath;
  }

  private async downloadMessageResource(messageId: string, fileKey: string, type: 'image' | 'file'): Promise<any> {
    const client = feishuClient.getClient();
    await mkdir(FEISHU_MEDIA_DIR, { recursive: true });

    return (client.im.messageResource as any).get({
      path: {
        message_id: messageId,
        file_key: fileKey,
      },
      params: {
        type,
      },
    });
  }
}

function resolveImageExtension(headers: unknown): string {
  const contentType = readHeader(headers, 'content-type');
  switch (contentType) {
    case 'image/jpeg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    case 'image/bmp':
      return '.bmp';
    case 'image/tiff':
      return '.tiff';
    case 'image/x-icon':
      return '.ico';
    default:
      return '.img';
  }
}

function readHeader(headers: unknown, targetName: string): string {
  if (!headers || typeof headers !== 'object') {
    return '';
  }

  const normalizedTargetName = targetName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalizedTargetName) {
      continue;
    }

    if (Array.isArray(value)) {
      return `${value[0] ?? ''}`.toLowerCase();
    }

    return `${value ?? ''}`.toLowerCase();
  }

  return '';
}

function resolveFileExtension(headers: unknown): string {
  const contentDisposition = readHeader(headers, 'content-disposition');
  const match = contentDisposition.match(/filename\*?=(?:UTF-8''|\"?)([^\";]+)/i);
  if (match?.[1]) {
    const candidate = decodeURIComponent(match[1].replace(/^\"|\"$/g, ''));
    return path.extname(candidate) || '.bin';
  }

  return '.bin';
}

function buildStoredFileName(messageId: string, fileName: string | undefined, fallbackExtension: string): string {
  const timestamp = Date.now();
  const sanitizedBaseName = sanitizeBaseName(fileName);
  const extension = path.extname(fileName ?? '') || fallbackExtension;
  return `${messageId}-${timestamp}-${sanitizedBaseName}${extension}`;
}

function sanitizeBaseName(fileName?: string): string {
  const baseName = path.basename(fileName ?? '', path.extname(fileName ?? '')).trim();
  const sanitized = baseName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').replace(/\s+/g, '_');
  return sanitized || 'file';
}

export default new MessageService();
