import * as lark from '@larksuiteoapi/node-sdk';
import config from '../config';
import logger from '../utils/logger';
import { handleMessage } from '../handlers/message.handler';

class WebSocketManager {
  private wsClient: lark.WSClient | null = null;

  async start(): Promise<void> {
    try {
      // 创建 WebSocket 客户端
      this.wsClient = new lark.WSClient({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        domain: lark.Domain.Feishu,
        loggerLevel: lark.LoggerLevel.info,
      });

      // 创建事件分发器并注册消息接收事件处理器
      const eventDispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data) => {
          try {
            await handleMessage(data as any);
          } catch (error) {
            logger.error('Error handling message event', { error });
          }
        },
      });

      // 启动 WebSocket 连接
      await this.wsClient.start({ eventDispatcher });

      logger.info('WebSocket connection established successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('Failed to start WebSocket connection', {
        message: errorMessage,
        stack: errorStack,
        error
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.wsClient) {
      logger.info('Stopping WebSocket connection');
      this.wsClient = null;
    }
  }
}

export default new WebSocketManager();
