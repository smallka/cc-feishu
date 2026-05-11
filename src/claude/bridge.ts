import { randomUUID } from 'crypto';
import { ChildProcess } from 'child_process';
import * as readline from 'readline';
import logger from '../utils/logger';
import type { CLIMessage, CLIAssistantMessage, CLIControlRequestMessage, CLIControlResponseMessage } from './types';

export type OnResponseCallback = (text: string) => void;
export type OnPartialTextCallback = (accumulatedText: string) => void;

interface PendingTurn {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class CLIBridge {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private initRequestId: string | null = null;
  private collectedText: string[] = [];
  private onResponse: OnResponseCallback | null = null;
  private onPartialText: OnPartialTextCallback | null = null;
  private onComplete: (() => Promise<void>) | null = null;
  private pendingTurn: PendingTurn | null = null;
  private initialized = false;
  private initWaiters: Array<{ resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }> = [];
  private sessionId?: string;
  private readonly agentId: string;

  constructor(agentId: string, sessionId?: string) {
    this.agentId = agentId;
    this.sessionId = sessionId;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  waitForInit(timeoutMs = 15000): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.initWaiters = this.initWaiters.filter(w => w.resolve !== resolve);
        reject(new Error('CLI init timeout'));
      }, timeoutMs);
      this.initWaiters.push({ resolve, reject, timer });
    });
  }

  rejectInit(reason: string): void {
    const waiters = this.initWaiters;
    this.initWaiters = [];
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.rejectPendingTurn(reason);
  }

  setOnResponse(cb: OnResponseCallback): void {
    this.onResponse = cb;
  }

  setOnPartialText(cb: OnPartialTextCallback): void {
    this.onPartialText = cb;
  }

  attachProcess(process: ChildProcess): void {
    this.process = process;

    if (process.stdout) {
      this.rl = readline.createInterface({
        input: process.stdout,
        crlfDelay: Infinity,
      });

      this.rl.on('line', (line: string) => {
        this.handleCLIData(line);
      });
    }

    setTimeout(() => {
      this.sendInitialize();
    }, 1000);
  }

  detachProcess(): void {
    this.rejectPendingTurn('CLI process detached');
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.process = null;
  }

  private sendInitialize(): void {
    this.initRequestId = randomUUID();
    const initRequest = {
      type: 'control_request',
      request_id: this.initRequestId,
      request: {
        subtype: 'initialize',
        hooks: null,
      },
    };
    this.sendRaw(JSON.stringify(initRequest));
    logger.info('[CLIBridge] Sent initialize request', {
      agentId: this.agentId,
      requestId: this.initRequestId,
    });
  }

  sendUserMessage(text: string, onComplete?: () => Promise<void>): Promise<void> {
    if (this.pendingTurn) {
      return Promise.reject(new Error('Agent is already processing a message'));
    }

    const ndjson = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: this.sessionId || null,
    });

    this.collectedText = [];
    this.onComplete = onComplete || null;

    logger.info('[CLIBridge] Sending user message', {
      agentId: this.agentId,
      sessionId: this.sessionId,
      messageLength: text.length,
      messageText: text,
    });

    return new Promise<void>((resolve, reject) => {
      this.pendingTurn = { resolve, reject };
      const sent = this.sendRaw(ndjson);
      if (!sent) {
        this.rejectPendingTurn('Failed to send user message');
      }
    });
  }

  handleCLIData(raw: string): void {
    const line = raw.trim();
    if (!line) {
      return;
    }

    let msg: CLIMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    this.routeMessage(msg);
  }

  private routeMessage(msg: CLIMessage): void {
    logger.debug('[CLIBridge] Received message', {
      agentId: this.agentId,
      messageType: msg.type,
    });

    switch (msg.type) {
      case 'control_response': {
        const controlMsg = msg as CLIControlResponseMessage;
        if (controlMsg.response?.request_id === this.initRequestId) {
          this.initialized = true;
          const waiters = this.initWaiters;
          this.initWaiters = [];
          for (const waiter of waiters) {
            clearTimeout(waiter.timer);
            waiter.resolve();
          }
          logger.info('[CLIBridge] Initialized', { agentId: this.agentId });
        }
        break;
      }

      case 'system': {
        if ('subtype' in msg && msg.subtype === 'init') {
          const initMsg = msg as any;
          const actualSessionId = initMsg.session_id;
          const sessionChanged = actualSessionId !== this.sessionId;

          if (sessionChanged) {
            logger.info('[CLIBridge] Session ID updated', {
              agentId: this.agentId,
              oldSessionId: this.sessionId,
              newSessionId: actualSessionId,
            });
            this.sessionId = actualSessionId;
          }

          logger.info('[CLIBridge] CLI session initialized', {
            agentId: this.agentId,
            sessionId: this.sessionId,
            sessionChanged,
            model: initMsg.model,
          });
        }
        break;
      }

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

  private handleAssistant(msg: CLIAssistantMessage): void {
    if (msg.parent_tool_use_id) {
      return;
    }

    const prevLen = this.collectedText.length;
    for (const block of msg.message.content) {
      if (block.type === 'text' && block.text) {
        this.collectedText.push(block.text);
      }
    }

    if (this.onPartialText && this.collectedText.length > prevLen) {
      this.onPartialText(this.collectedText.join('\n'));
    }
  }

  private handleResult(): void {
    const text = this.collectedText.join('\n').trim();
    this.collectedText = [];

    logger.info('[CLIBridge] Completed assistant turn', {
      agentId: this.agentId,
      sessionId: this.sessionId,
      textLength: text.length,
      responseText: text,
    });

    if (text && this.onResponse) {
      this.onResponse(text);
    }

    const onComplete = this.onComplete;
    this.onComplete = null;

    if (onComplete) {
      onComplete().catch(error => {
        logger.error('[CLIBridge] onComplete callback failed', { error });
      }).finally(() => {
        this.resolvePendingTurn();
      });
      return;
    }

    this.resolvePendingTurn();
  }

  private handleControlRequest(msg: CLIControlRequestMessage): void {
    logger.info('[CLIBridge] Received control_request', {
      agentId: this.agentId,
      subtype: msg.request?.subtype,
      toolName: msg.request?.tool_name,
      requestId: msg.request_id,
    });

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
    logger.info('[CLIBridge] Auto-approving tool', {
      agentId: this.agentId,
      tool: msg.request.tool_name,
    });
    this.sendRaw(ndjson);
  }

  canInterrupt(): boolean {
    return this.process !== null && !this.process.killed;
  }

  sendInterrupt(): boolean {
    if (!this.canInterrupt()) {
      logger.warn('[CLIBridge] Process not running, cannot interrupt', {
        agentId: this.agentId,
      });
      return false;
    }

    const interruptRequest = {
      type: 'control_request',
      request_id: randomUUID(),
      request: { subtype: 'interrupt' },
    };

    logger.info('[CLIBridge] Sent interrupt request', {
      agentId: this.agentId,
    });
    return this.sendRaw(JSON.stringify(interruptRequest));
  }

  private resolvePendingTurn(): void {
    const pendingTurn = this.pendingTurn;
    this.pendingTurn = null;
    pendingTurn?.resolve();
  }

  private rejectPendingTurn(reason: string): void {
    const pendingTurn = this.pendingTurn;
    this.pendingTurn = null;
    this.onComplete = null;
    pendingTurn?.reject(new Error(reason));
  }

  private sendRaw(ndjson: string): boolean {
    if (!this.process || this.process.killed) {
      logger.warn('[CLIBridge] Process not available, cannot send', {
        agentId: this.agentId,
      });
      return false;
    }

    if (!this.process.stdin) {
      logger.error('[CLIBridge] Process stdin not available', {
        agentId: this.agentId,
      });
      return false;
    }

    this.process.stdin.write(ndjson + '\n');
    return true;
  }
}
