import logger from './utils/logger';
import config from './config';
import websocketManager from './bot/websocket';
import { chatManager } from './bot/chat-manager';
import { stopMessageHandling } from './handlers/message.handler';

async function bootstrap() {
  try {
    logger.info('Starting Feishu bot application', {
      env: config.app.env,
      appId: config.feishu.appId,
      provider: config.agent.provider,
    });

    await chatManager.start();
    await websocketManager.start();

    logger.info('Feishu bot is running');
  } catch (error) {
    logger.error('Failed to start application', { error });
    process.exit(1);
  }
}

async function shutdown() {
  logger.info('Shutting down gracefully');
  await websocketManager.stop();
  await stopMessageHandling();
  await chatManager.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

bootstrap();
