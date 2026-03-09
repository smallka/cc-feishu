import feishuClient from '../bot/client';
import logger from '../utils/logger';

interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, any>;
}

class MessageService {
  // 给消息添加 emoji 反应，返回 reactionId
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

  // 移除消息的 emoji 反应
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

  // 发送文本消息
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

  // 发送 Markdown 卡片消息
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

      logger.info('Card message sent', { chatId, contentLength: markdown.length });
    } catch (error) {
      logger.error('Failed to send card message', { error, chatId });
      throw error;
    }
  }

  // 发送权限请求消息
  async sendPermissionRequest(chatId: string, request: PermissionRequest): Promise<void> {
    const inputStr = JSON.stringify(request.input, null, 2);
    const shortId = request.requestId.slice(0, 8);

    const card = {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '🔐 权限请求' },
        template: 'orange',
      },
      elements: [
        {
          tag: 'div',
          text: { tag: 'lark_md', content: `**工具：** ${request.toolName}` },
        },
        {
          tag: 'markdown',
          content: `\`\`\`json\n${inputStr}\n\`\`\``,
        },
        { tag: 'hr' },
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: `回复：\n\`/approve ${shortId}\` - 批准\n\`/deny ${shortId}\` - 拒绝`,
          },
        },
      ],
    };

    try {
      const client = feishuClient.getClient();
      await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
      logger.info('Permission request sent', { chatId, requestId: request.requestId, shortId, toolName: request.toolName });
    } catch (error) {
      logger.error('Failed to send permission request', { chatId, error });
      throw error;
    }
  }
}

export default new MessageService();
