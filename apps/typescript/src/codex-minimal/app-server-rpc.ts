import logger from '../utils/logger';
import {
  AppServerErrorNotificationParams,
  AppServerItemCompletedParams,
  AppServerServerRequestMethod,
  AppServerTurnCompletedParams,
  AppServerTurnStartedParams,
  JsonRpcErrorShape,
  JsonRpcNotificationShape,
  JsonRpcRequestShape,
  JsonRpcResponseShape,
} from './app-server-types';

type LoggerLike = Pick<typeof logger, 'warn' | 'info' | 'error'>;
type StdinWriter = {
  write: (chunk: string | Uint8Array) => unknown;
};

type PendingRequest = {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

export interface CodexAppServerRpcClientOptions {
  stdin: StdinWriter;
  logger?: LoggerLike;
}

export class CodexAppServerRpcClient {
  private readonly stdin: StdinWriter;
  private readonly rpcLogger: LoggerLike;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextRequestId = 0;
  private threadId: string | null = null;
  private turnId: string | null = null;
  private turnError: string | null = null;

  constructor(options: CodexAppServerRpcClientOptions) {
    this.stdin = options.stdin;
    this.rpcLogger = options.logger ?? logger;
  }

  request<TResult = unknown>(method: string, params: Record<string, unknown>): Promise<TResult> {
    this.nextRequestId += 1;
    const id = this.nextRequestId;

    const payload: JsonRpcRequestShape<Record<string, unknown>> = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<TResult>((resolve, reject) => {
      this.pendingRequests.set(id, {
        method,
        resolve: resolve as unknown as (result: unknown) => void,
        reject,
      });

      try {
        this.write(payload);
      } catch (error) {
        this.pendingRequests.delete(id);
        reject(asError(error, `Failed to write JSON-RPC request for ${method}`));
      }
    });
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const payload: JsonRpcNotificationShape<Record<string, unknown>> = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };
    this.write(payload);
  }

  handleLine(line: string): void {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      return;
    }

    let message: Record<string, unknown>;
    try {
      message = JSON.parse(trimmedLine) as Record<string, unknown>;
    } catch (error) {
      this.rpcLogger.warn('[CodexAppServerRpcClient] Ignoring invalid JSON-RPC line', {
        error,
        line: trimmedLine,
      });
      return;
    }

    if (isServerRequestMessage(message)) {
      this.handleServerRequest(message);
      return;
    }

    if (isResponseMessage(message)) {
      this.handleResponse(message);
      return;
    }

    if (isNotificationMessage(message)) {
      this.handleNotification(message);
    }
  }

  handleResponse(message: JsonRpcResponseShape<unknown>): void {
    const pendingRequest = this.pendingRequests.get(message.id);
    if (!pendingRequest) {
      return;
    }

    this.pendingRequests.delete(message.id);

    if (message.error) {
      pendingRequest.reject(buildRpcError(pendingRequest.method, message.error));
      return;
    }

    if (
      (pendingRequest.method === 'thread/start' || pendingRequest.method === 'thread/resume') &&
      message.result &&
      typeof message.result === 'object'
    ) {
      const nextThreadId = extractThreadId(message.result as Record<string, unknown>);
      if (nextThreadId) {
        this.threadId = nextThreadId;
      }
    }

    pendingRequest.resolve(message.result);
  }

  handleNotification(message: JsonRpcNotificationShape<Record<string, unknown>>): void {
    const params = message.params ?? {};
    if (shouldIgnoreNotification(this.threadId, params)) {
      return;
    }

    switch (message.method) {
      case 'turn/started':
        this.handleTurnStarted(params);
        return;
      case 'turn/completed':
        this.handleTurnCompleted(params);
        return;
      case 'item/completed':
        this.handleItemCompleted(params);
        return;
      case 'error':
        this.handleErrorNotification(params);
        return;
      default:
        return;
    }
  }

  handleServerRequest(message: JsonRpcRequestShape<Record<string, unknown>>): void {
    const method = message.method as AppServerServerRequestMethod;

    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'execCommandApproval':
      case 'item/fileChange/requestApproval':
      case 'applyPatchApproval':
        this.respond(message.id, { decision: 'accept' });
        return;
      default:
        this.rpcLogger.warn('[CodexAppServerRpcClient] Unhandled server request; replying with empty result', {
          method,
        });
        this.respond(message.id, {});
    }
  }

  closeAllPending(error: Error): void {
    for (const [id, pendingRequest] of this.pendingRequests.entries()) {
      pendingRequest.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  getThreadId(): string | null {
    return this.threadId;
  }

  getTurnId(): string | null {
    return this.turnId;
  }

  getTurnError(): string | null {
    return this.turnError;
  }

  private handleTurnStarted(params: Record<string, unknown>): void {
    const turnStarted = params as AppServerTurnStartedParams;
    this.turnError = null;
    this.turnId = normalizeString(turnStarted.turn?.id);
  }

  private handleTurnCompleted(params: Record<string, unknown>): void {
    const turnCompleted = params as AppServerTurnCompletedParams;
    const turnStatus = normalizeString(turnCompleted.turn?.status) ?? normalizeString(turnCompleted.status);

    if (turnStatus === 'failed') {
      const errorMessage =
        normalizeString(turnCompleted.turn?.error?.message) ??
        normalizeString(turnCompleted.error?.message) ??
        'codex turn failed';
      this.setTurnError(errorMessage, true);
    } else {
      this.turnError = null;
    }

    this.turnId = null;
  }

  private handleItemCompleted(params: Record<string, unknown>): void {
    const itemCompleted = params as AppServerItemCompletedParams;
    if (itemCompleted.item?.type !== 'error') {
      return;
    }

    const errorMessage = normalizeString(itemCompleted.item.text) ?? normalizeString(itemCompleted.item.message);
    if (errorMessage) {
      this.setTurnError(errorMessage, false);
    }
  }

  private handleErrorNotification(params: Record<string, unknown>): void {
    const errorNotification = params as AppServerErrorNotificationParams;
    if (errorNotification.willRetry) {
      return;
    }

    const errorMessage =
      normalizeString(errorNotification.error?.message) ??
      normalizeString(errorNotification.message);
    if (errorMessage) {
      this.setTurnError(errorMessage, false);
    }
  }

  private respond(id: number, result: Record<string, unknown>): void {
    const payload: JsonRpcResponseShape<Record<string, unknown>> = {
      jsonrpc: '2.0',
      id,
      result,
    };
    this.write(payload);
  }

  private setTurnError(message: string, replace: boolean): void {
    if (!message) {
      return;
    }

    if (replace || this.turnError === null) {
      this.turnError = message;
    }
  }

  private write(payload: JsonRpcRequestShape<unknown> | JsonRpcNotificationShape<unknown> | JsonRpcResponseShape<unknown>): void {
    this.stdin.write(`${JSON.stringify(payload)}\n`);
  }
}

function buildRpcError(method: string, error: JsonRpcErrorShape): Error {
  return new Error(`${method}: ${error.message ?? 'unknown error'} (code=${error.code ?? 'unknown'})`);
}

function shouldIgnoreNotification(currentThreadId: string | null, params: Record<string, unknown>): boolean {
  if (!currentThreadId) {
    return false;
  }

  const threadId = normalizeString(params.threadId);
  return threadId !== null && threadId !== currentThreadId;
}

function extractThreadId(result: Record<string, unknown>): string | null {
  const thread = result.thread;
  if (!thread || typeof thread !== 'object') {
    return null;
  }

  return normalizeString((thread as { id?: unknown }).id);
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asError(error: unknown, message: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(message);
}

function isServerRequestMessage(message: unknown): message is JsonRpcRequestShape<Record<string, unknown>> {
  return isObjectRecord(message) && typeof message.id === 'number' && typeof message.method === 'string';
}

function isResponseMessage(message: unknown): message is JsonRpcResponseShape<unknown> {
  return isObjectRecord(message) && typeof message.id === 'number' && ('result' in message || 'error' in message);
}

function isNotificationMessage(message: unknown): message is JsonRpcNotificationShape<Record<string, unknown>> {
  return isObjectRecord(message) && typeof message.method === 'string';
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}
