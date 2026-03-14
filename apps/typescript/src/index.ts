import logger from './utils/logger';
import config from './config';
import websocketManager from './bot/websocket';
import { chatManager } from './bot/chat-manager';
import { stopMessageHandling } from './handlers/message.handler';
import { SingleInstanceLock } from './app/single-instance-lock';

const SINGLE_INSTANCE_RETRY_MS = 5000;
const SINGLE_INSTANCE_RETRY_INTERVAL_MS = 300;

const processStartedAt = new Date().toISOString();
const singleInstanceLock = new SingleInstanceLock({
  host: '127.0.0.1',
  port: config.app.singleInstancePort,
  retryMs: SINGLE_INSTANCE_RETRY_MS,
  retryIntervalMs: SINGLE_INSTANCE_RETRY_INTERVAL_MS,
  metadataProvider: () => ({
    pid: process.pid,
    startedAt: processStartedAt,
    appId: config.feishu.appId,
    provider: config.agent.provider,
    websocketState: websocketManager.getStatus().state,
  }),
});

let isShuttingDown = false;

async function bootstrap() {
  try {
    logger.info('Starting Feishu bot application', {
      env: config.app.env,
      appId: config.feishu.appId,
      provider: config.agent.provider,
      singleInstancePort: config.app.singleInstancePort,
      singleInstanceRetryMs: SINGLE_INSTANCE_RETRY_MS,
      singleInstanceRetryIntervalMs: SINGLE_INSTANCE_RETRY_INTERVAL_MS,
    });

    await singleInstanceLock.acquire();
    await chatManager.start();
    await websocketManager.start();

    logger.info('Feishu bot is running');
  } catch (error) {
    logger.error('Failed to start application', { error });
    await singleInstanceLock.release().catch((releaseError) => {
      logger.error('Failed to release single-instance lock after startup error', { error: releaseError });
    });
    process.exit(1);
  }
}

async function shutdown(signal: string) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress', { signal });
    return;
  }

  isShuttingDown = true;
  let exitCode = 0;

  logger.info('Shutting down gracefully', { signal });

  try {
    await websocketManager.stop();
    await stopMessageHandling();
    await chatManager.stop();
  } catch (error) {
    exitCode = 1;
    logger.error('Error during shutdown', { error, signal });
  } finally {
    await singleInstanceLock.release().catch((releaseError) => {
      exitCode = 1;
      logger.error('Failed to release single-instance lock during shutdown', { error: releaseError, signal });
    });
    process.exit(exitCode);
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

void bootstrap();
