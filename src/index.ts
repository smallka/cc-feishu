import logger from './utils/logger';
import config from './config';
import websocketManager from './bot/websocket';

async function bootstrap() {
  try {
    logger.info('Starting Feishu bot application', {
      env: config.app.env,
      appId: config.feishu.appId,
    });

    // 启动 WebSocket 连接
    await websocketManager.start();

    logger.info('Feishu bot is running');
  } catch (error) {
    logger.error('Failed to start application', { error });
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');
  await websocketManager.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  await websocketManager.stop();
  process.exit(0);
});

// 启动应用
bootstrap();
