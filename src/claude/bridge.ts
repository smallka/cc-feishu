import { WebSocket } from 'ws';
import logger from '../utils/logger';
import type { CLIMessage, CLIAssistantMessage, CLIControlRequestMessage } from './types';

export type OnResponseCallback = (text: string) => void;
export type OnPartialTextCallback = (accumulatedText: string) => void;

export class CLIBridge {
  private ws: WebSocket | null = null;
  private pendingMessages: string[] = [];
  private collectedText: string[] = [];
  private onResponse: OnResponseCallback | null = null;
  private onPartialText: OnPartialTextCallback | null = null;
  private initialized = false;
  private initWaiters: Array<{ resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private lastResponseTime: number = Date.now();
  readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getLastResponseTime(): number {
    return this.lastResponseTime;
  }

  isHealthy(inactiveTimeout: number): boolean {
    const now = Date.now();
    const timeSinceLastResponse = now - this.lastResponseTime;
    return timeSinceLastResponse < inactiveTimeout;
  }

  /**
   * 等待 CLI 初始化完成，超时则 reject
   */
  waitForInit(timeoutMs = 15000): Promise<void> {
    if (this.initialized) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.initWaiters = this.initWaiters.filter(w => w.resolve !== resolve);
        reject(new Error('CLI init timeout'));
      }, timeoutMs);
      this.initWaiters.push({ resolve, reject, timer });
    });
  }

  /**
   * 拒绝所有等待中的 init Promise（CLI 提前退出时调用）
   */
  rejectInit(reason: string): void {
    const waiters = this.initWaiters;
    this.initWaiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.reject(new Error(reason));
    }
  }

  setOnResponse(cb: OnResponseCallback) {
    this.onResponse = cb;
  }

  setOnPartialText(cb: OnPartialTextCallback) {
    this.onPartialText = cb;
  }

  attachSocket(ws: WebSocket) {
    this.ws = ws;
    // 发送缓存的消息
    for (const msg of this.pendingMessages) {
      this.sendRaw(msg);
    }
    this.pendingMessages = [];
  }

  detachSocket() {
    this.ws = null;
  }

  sendUserMessage(text: string) {
    const ndjson = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: this.sessionId,
    });
    this.collectedText = [];
    this.sendRaw(ndjson);
  }

  handleCLIData(raw: string) {
    const lines = raw.split('\n').filter(l => l.trim());
    for (const line of lines) {
      let msg: CLIMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this.routeMessage(msg);
    }
  }

  private routeMessage(msg: CLIMessage) {
    // 更新最后响应时间
    this.lastResponseTime = Date.now();

    switch (msg.type) {
      case 'system':
        if ('subtype' in msg && msg.subtype === 'init') {
          this.initialized = true;
          const waiters = this.initWaiters;
          this.initWaiters = [];
          for (const w of waiters) {
            clearTimeout(w.timer);
            w.resolve();
          }
          logger.info('CLI session initialized', {
            sessionId: this.sessionId,
            model: msg.model,
          });
        }
        break;

      case 'assistant':
        this.handleAssistant(msg as CLIAssistantMessage);
        break;

      case 'result':
        this.handleResult();
        break;

      case 'control_request':
        this.handleControlRequest(msg as CLIControlRequestMessage);
        break;

      case 'keep_alive':
        break;
    }
  }

  private handleAssistant(msg: CLIAssistantMessage) {
    // 只收集顶层（非子 agent）的文本
    if (msg.parent_tool_use_id) return;
    const prevLen = this.collectedText.length;
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text) {
        this.collectedText.push(block.text);
      }
    }
    // 有新文本时才触发部分文本回调（用于流式更新）
    if (this.onPartialText && this.collectedText.length > prevLen) {
      this.onPartialText(this.collectedText.join('\n'));
    }
  }

  private handleResult() {
    const text = this.collectedText.join('\n').trim();
    this.collectedText = [];
    if (text && this.onResponse) {
      this.onResponse(text);
    }
  }

  private handleControlRequest(msg: CLIControlRequestMessage) {
    // MVP: 自动批准所有工具请求
    const ndjson = JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: msg.request_id,
        response: {
          behavior: 'allow',
          updatedInput: msg.request.input,
        },
      },
    });
    logger.debug('Auto-approving tool', {
      tool: msg.request.tool_name,
      sessionId: this.sessionId,
    });
    this.sendRaw(ndjson);
  }

  private sendRaw(ndjson: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingMessages.push(ndjson);
      return;
    }
    this.ws.send(ndjson + '\n');
  }
}
