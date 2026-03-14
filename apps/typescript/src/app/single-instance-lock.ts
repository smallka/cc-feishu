import net from 'net';

import logger from '../utils/logger';

export interface LockHolderInfo {
  pid: number;
  startedAt: string;
  appId?: string;
  provider?: string;
  websocketState?: string;
}

interface SingleInstanceLockOptions {
  host: string;
  port: number;
  retryMs: number;
  retryIntervalMs: number;
  metadataProvider: () => LockHolderInfo;
}

export class SingleInstanceLock {
  private readonly host: string;
  private readonly port: number;
  private readonly retryMs: number;
  private readonly retryIntervalMs: number;
  private readonly metadataProvider: () => LockHolderInfo;
  private server: net.Server | null = null;

  constructor(options: SingleInstanceLockOptions) {
    this.host = options.host;
    this.port = options.port;
    this.retryMs = options.retryMs;
    this.retryIntervalMs = options.retryIntervalMs;
    this.metadataProvider = options.metadataProvider;
  }

  async acquire(): Promise<void> {
    if (this.server) {
      return;
    }

    const deadline = Date.now() + this.retryMs;
    let attempt = 0;
    let lastHolder: LockHolderInfo | null = null;

    while (true) {
      attempt += 1;

      try {
        await this.listenOnce();
        logger.info('Acquired single-instance lock', {
          host: this.host,
          port: this.port,
          attempt,
        });
        return;
      } catch (error) {
        if (!isAddressInUse(error)) {
          throw error;
        }

        lastHolder = await this.inspectCurrentHolder();
        const remainingMs = deadline - Date.now();

        if (remainingMs <= 0) {
          logger.error('Failed to acquire single-instance lock before timeout', {
            host: this.host,
            port: this.port,
            retryMs: this.retryMs,
            holder: lastHolder,
          });
          throw new Error(`Another instance is already running on ${this.host}:${this.port}`);
        }

        const sleepMs = Math.min(this.retryIntervalMs, remainingMs);
        const logPayload = {
          host: this.host,
          port: this.port,
          attempt,
          retryInMs: sleepMs,
          holder: lastHolder,
        };

        if (attempt === 1) {
          logger.warn('Single-instance lock is busy, waiting for release', logPayload);
        } else {
          logger.debug('Single-instance lock still busy', logPayload);
        }

        await delay(sleepMs);
      }
    }
  }

  async release(): Promise<void> {
    const server = this.server;
    this.server = null;

    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    logger.info('Released single-instance lock', {
      host: this.host,
      port: this.port,
    });
  }

  private async listenOnce(): Promise<void> {
    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.on('error', (error) => {
        logger.debug('Single-instance lock client socket closed with error', {
          host: this.host,
          port: this.port,
          error: error.message,
        });
      });
      socket.end(`${JSON.stringify(this.metadataProvider())}\n`);
    });

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        server.off('error', onError);
        server.off('listening', onListening);
      };

      const onError = (error: Error) => {
        cleanup();
        server.close(() => reject(error));
      };

      const onListening = () => {
        cleanup();
        this.server = server;
        resolve();
      };

      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, this.host);
    });
  }

  private async inspectCurrentHolder(): Promise<LockHolderInfo | null> {
    return new Promise<LockHolderInfo | null>((resolve) => {
      const socket = net.createConnection({
        host: this.host,
        port: this.port,
      });

      socket.setEncoding('utf8');
      socket.setTimeout(1000);

      let raw = '';
      let settled = false;

      const finish = (holder: LockHolderInfo | null) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(holder);
      };

      socket.on('data', (chunk) => {
        raw += chunk;
      });

      socket.once('end', () => {
        finish(parseHolderInfo(raw));
      });

      socket.once('timeout', () => {
        finish(null);
      });

      socket.once('error', () => {
        finish(null);
      });
    });
  }
}

function parseHolderInfo(raw: string): LockHolderInfo | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as LockHolderInfo;
  } catch (error) {
    logger.warn('Failed to parse single-instance lock metadata', { error, raw: value });
    return null;
  }
}

function isAddressInUse(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
