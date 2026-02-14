import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { createServer, Server } from 'http';
import logger from '../utils/logger';

type OnCLIConnect = (sessionId: string, ws: WebSocket) => void;
type OnCLIMessage = (sessionId: string, data: string) => void;
type OnCLIClose = (sessionId: string) => void;

export class ClaudeWsServer {
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private port: number;
  private onConnect: OnCLIConnect | null = null;
  private onMessage: OnCLIMessage | null = null;
  private onClose: OnCLIClose | null = null;

  constructor(port: number) {
    this.port = port;
  }

  onCLIConnect(cb: OnCLIConnect) { this.onConnect = cb; }
  onCLIMessage(cb: OnCLIMessage) { this.onMessage = cb; }
  onCLIClose(cb: OnCLIClose) { this.onClose = cb; }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = createServer();
      this.wss = new WebSocketServer({ server: this.httpServer });

      this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        const url = req.url || '';
        // 期望路径: /ws/cli/{sessionId}
        const match = url.match(/^\/ws\/cli\/(.+)$/);
        if (!match) {
          logger.warn('Invalid WS path', { url });
          ws.close();
          return;
        }
        const sessionId = match[1];
        logger.info('CLI connected via WebSocket', { sessionId });

        this.onConnect?.(sessionId, ws);

        ws.on('message', (raw: Buffer | string) => {
          const data = typeof raw === 'string' ? raw : raw.toString('utf-8');
          this.onMessage?.(sessionId, data);
        });

        ws.on('close', () => {
          logger.info('CLI WebSocket closed', { sessionId });
          this.onClose?.(sessionId);
        });

        ws.on('error', (err) => {
          logger.error('CLI WebSocket error', { sessionId, error: err.message });
        });
      });

      this.httpServer.listen(this.port, () => {
        logger.info(`Claude WS server listening on port ${this.port}`);
        resolve();
      });

      this.httpServer.on('error', reject);
    });
  }

  stop(): void {
    this.wss?.close();
    this.httpServer?.close();
  }
}
