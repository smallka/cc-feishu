import feishuClient from '../bot/client';
import logger from '../utils/logger';

class ChatService {
  async getChatName(chatId: string): Promise<string | null> {
    try {
      const client = feishuClient.getClient();
      const response = await client.im.chat.get({
        path: {
          chat_id: chatId,
        },
      });

      const name = response?.data?.name?.trim();
      if (!name) {
        logger.warn('Chat name missing in chat.get response', {
          chatId,
          code: response?.code,
          msg: response?.msg,
        });
        return null;
      }

      return name;
    } catch (error) {
      logger.error('Failed to fetch chat name', { chatId, error });
      return null;
    }
  }
}

export default new ChatService();
