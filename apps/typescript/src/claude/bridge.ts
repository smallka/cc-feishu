import { randomUUID } from 'crypto';
import { ChildProcess } from 'child_process';
import * as readline from 'readline';
import logger from '../utils/logger';
import type { CLIMessage, CLIAssistantMessage, CLIControlRequestMessage, CLIControlResponseMessage } from './types';

export type OnResponseCallback = (text: string) => void;
export type OnPartialTextCallback = (accumulatedText: string) => void;

export class CLIBridge {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private initRequestId: string | null = null;
  private collectedText: string[] = [];
  private onResponse: OnResponseCallback | null = null;
  private onPartialText: OnPartialTextCallback | null = null;
  private onComplete: (() => Promise<void>) | null = null;
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

  attachProcess(process: ChildProcess) {
    this.process = process;

    // 使用 readline 逐行解析 stdout
    if (process.stdout) {
      this.rl = readline.createInterface({
        input: process.stdout,
        crlfDelay: Infinity,
      });

      this.rl.on('line', (line: string) => {
        this.handleCLIData(line);
      });
    }

    // 延迟 1 秒后发送初始化请求
    setTimeout(() => {
      this.sendInitialize();
    }, 1000);
  }

  detachProcess() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.process = null;
  }

  private sendInitialize() {
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

  sendUserMessage(text: string, onComplete?: () => Promise<void>) {
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
    this.sendRaw(ndjson);
  }

  handleCLIData(raw: string) {
    // readline 已经按行分割，直接解析单行
    const line = raw.trim();
    if (!line) return;

    let msg: CLIMessage;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    this.routeMessage(msg);
  }

  private routeMessage(msg: CLIMessage) {
    logger.debug('[CLIBridge] Received message', {
      agentId: this.agentId,
      messageType: msg.type,
    });

    switch (msg.type) {
      case 'control_response':
        // 处理初始化响应
        const controlMsg = msg as CLIControlResponseMessage;
        if (controlMsg.response?.request_id === this.initRequestId) {
          this.initialized = true;
          const waiters = this.initWaiters;
          this.initWaiters = [];
          for (const w of waiters) {
            clearTimeout(w.timer);
            w.resolve();
          }
          logger.info('[CLIBridge] Initialized', { agentId: this.agentId });
        }
        break;

      case 'system':
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
    logger.info('[CLIBridge] Completed assistant turn', {
      agentId: this.agentId,
      sessionId: this.sessionId,
      textLength: text.length,
      responseText: text,
    });
    if (text && this.onResponse) {
      this.onResponse(text);
    }
    if (this.onComplete) {
      this.onComplete().catch(err => {
        logger.error('[CLIBridge] onComplete callback failed', { error: err });
      });
      this.onComplete = null;
    }
  }

  private handleControlRequest(msg: CLIControlRequestMessage) {
    logger.info('[CLIBridge] Received control_request', {
      agentId: this.agentId,
      subtype: msg.request?.subtype,
      toolName: msg.request?.tool_name,
      requestId: msg.request_id,
    });

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
    logger.info('[CLIBridge] Auto-approving tool', {
      agentId: this.agentId,
      tool: msg.request.tool_name,
    });
    this.sendRaw(ndjson);
  }

  /**
   * 检查是否可以发送打断请求（进程是否存活）
   */
  canInterrupt(): boolean {
    return this.process !== null && !this.process.killed;
  }

  /**
   * 发送打断请求，中止当前 agent 回合
   * @returns 是否成功发送
   */
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

    this.sendRaw(JSON.stringify(interruptRequest));
    logger.info('[CLIBridge] Sent interrupt request', {
      agentId: this.agentId,
    });
    return true;
  }

  private sendRaw(ndjson: string) {
    if (!this.process || this.process.killed) {
      logger.warn('[CLIBridge] Process not available, cannot send', {
        agentId: this.agentId,
      });
      return;
    }

    if (!this.process.stdin) {
      logger.error('[CLIBridge] Process stdin not available', {
        agentId: this.agentId,
      });
      return;
    }

    this.process.stdin.write(ndjson + '\n');
  }
}
