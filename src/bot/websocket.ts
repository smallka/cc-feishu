import * as lark from '@larksuiteoapi/node-sdk';
import config from '../config';
import logger from '../utils/logger';
import { handleMessage } from '../handlers/message.handler';

class WebSocketManager {
  private wsClient: lark.WSClient | null = null;
  private lastMessageTime: number = Date.now();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

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
          this.lastMessageTime = Date.now(); // 更新心跳时间
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
      this.reconnectAttempts = 0; // 重置重连计数

      // 启动健康检查
      this.startHealthCheck();
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

  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    const interval = config.feishu.healthCheckInterval;
    this.healthCheckTimer = setInterval(() => {
      this.checkHealth();
    }, interval);

    logger.debug('WebSocket health check started', { interval });
  }

  private checkHealth(): void {
    const now = Date.now();
    const timeSinceLastMessage = now - this.lastMessageTime;
    const timeout = config.feishu.heartbeatTimeout;

    if (timeSinceLastMessage > timeout) {
      logger.warn('WebSocket heartbeat timeout', {
        timeSinceLastMessage,
        timeout,
        lastMessageTime: new Date(this.lastMessageTime).toISOString(),
      });

      // 尝试重连
      if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.reconnectAttempts++;
        logger.info('Attempting to reconnect WebSocket', {
          attempt: this.reconnectAttempts,
          maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
        });

        this.reconnect().catch(err => {
          logger.error('Reconnection attempt failed', { error: err });
        });
      } else {
        logger.error('WebSocket reconnection attempts exhausted', {
          attempts: this.reconnectAttempts,
          timeSinceLastMessage,
        });
      }
    }
  }

  private async reconnect(): Promise<void> {
    try {
      await this.stop();
      await this.start();
      logger.info('WebSocket reconnected successfully');
    } catch (error) {
      logger.error('Failed to reconnect WebSocket', { error });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.wsClient) {
      logger.info('Stopping WebSocket connection');
      this.wsClient = null;
    }
  }
}

export default new WebSocketManager();
