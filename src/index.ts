import logger from './utils/logger';
import config from './config';
import websocketManager from './bot/websocket';
import { SessionManager } from './claude/session-manager';
import { setSessionManager } from './handlers/message.handler';

let sessionManager: SessionManager | null = null;

async function bootstrap() {
  try {
    logger.info('Starting Feishu bot application', {
      env: config.app.env,
      appId: config.feishu.appId,
    });

    // 启动 Claude Code Session Manager
    sessionManager = new SessionManager();
    await sessionManager.start();
    setSessionManager(sessionManager);

    // 启动飞书 WebSocket 连接
    await websocketManager.start();

    logger.info('Feishu bot is running');
  } catch (error) {
    logger.error('Failed to start application', { error });
    process.exit(1);
  }
}

// 优雅关闭
async function shutdown() {
  logger.info('Shutting down gracefully');
  await sessionManager?.stop();
  await websocketManager.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 启动应用
bootstrap();
