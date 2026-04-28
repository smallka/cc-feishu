import * as lark from '@larksuiteoapi/node-sdk';
import config from '../config';
import logger from '../utils/logger';
import { handleMessage } from '../handlers/message.handler';

type WebSocketState = 'stopped' | 'starting' | 'connected' | 'stopping';

interface WebSocketStatus {
  state: WebSocketState;
  startedAt?: number;
  connectedAt?: number;
  reconnectInfo?: {
    lastConnectTime: number;
    nextConnectTime: number;
  };
}

const ignoreEvent = () => undefined;

export function createEventDispatcher(): lark.EventDispatcher {
  return new lark.EventDispatcher({}).register({
    'im.message.receive_v1': (data) => {
      void handleMessage(data as any).catch((error) => {
        logger.error('Error queueing message event', { error });
      });
    },
    'im.message.reaction.created_v1': ignoreEvent,
    'im.message.reaction.deleted_v1': ignoreEvent,
  });
}

class WebSocketManager {
  private wsClient: lark.WSClient | null = null;
  private state: WebSocketState = 'stopped';
  private startPromise: Promise<void> | null = null;
  private startedAt?: number;
  private connectedAt?: number;

  async start(): Promise<void> {
    if (this.state === 'connected') {
      logger.info('WebSocket connection already established');
      return;
    }

    if (this.startPromise) {
      logger.info('WebSocket connection start already in progress');
      return this.startPromise;
    }

    this.state = 'starting';
    this.startedAt = Date.now();

    this.startPromise = this.createAndStartClient().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (this.state === 'stopped' && !this.wsClient && !this.startPromise) {
      return;
    }

    this.state = 'stopping';

    if (this.startPromise) {
      await this.startPromise.catch(() => {});
    }

    const wsClient = this.wsClient;
    this.wsClient = null;

    if (wsClient) {
      logger.info('Stopping WebSocket connection');
      try {
        wsClient.close();
      } catch (error) {
        logger.error('Failed to close WebSocket connection cleanly', { error });
      }
    }

    this.state = 'stopped';
    logger.info('WebSocket connection stopped');
  }

  getStatus(): WebSocketStatus {
    return {
      state: this.state,
      startedAt: this.startedAt,
      connectedAt: this.connectedAt,
      reconnectInfo: this.wsClient?.getReconnectInfo(),
    };
  }

  private async createAndStartClient(): Promise<void> {
    try {
      const wsClient = new lark.WSClient({
        appId: config.feishu.appId,
        appSecret: config.feishu.appSecret,
        domain: lark.Domain.Feishu,
        loggerLevel: lark.LoggerLevel.info,
        autoReconnect: true,
      });

      const eventDispatcher = createEventDispatcher();

      await wsClient.start({ eventDispatcher });

      this.wsClient = wsClient;
      this.state = 'connected';
      this.connectedAt = Date.now();
      logger.info('WebSocket connection established successfully', {
        reconnectInfo: wsClient.getReconnectInfo(),
      });
    } catch (error) {
      this.state = 'stopped';
      this.wsClient = null;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error('Failed to start WebSocket connection', {
        message: errorMessage,
        stack: errorStack,
        error,
      });
      throw error;
    }
  }
}

export default new WebSocketManager();
