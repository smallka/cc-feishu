import { CodexAppServerSpawnTarget } from '../codex/launch';
import logger from '../utils/logger';
import { CodexAppServerProcess, CodexAppServerProcessExit } from './app-server-process';
import { CodexAppServerRpcClient } from './app-server-rpc';

export interface CodexMinimalSessionOptions {
  workingDirectory: string;
  codexPathOverride?: string;
  codexArgsPrefix?: string[];
  resumeSessionId?: string;
}

export interface SendMessageResult {
  text: string;
  threadId: string | null;
}

export interface CodexMinimalSendMessageOptions {
  onActivity?: () => void;
  imagePaths?: string[];
}

export class ConcurrentTurnError extends Error {
  constructor(message = 'A Codex turn is already in progress for this session.') {
    super(message);
    this.name = 'ConcurrentTurnError';
  }
}

export class TurnAbortedError extends Error {
  constructor(message = 'The current Codex turn was aborted.') {
    super(message);
    this.name = 'TurnAbortedError';
  }
}

type SessionState = 'cold' | 'starting' | 'ready' | 'turn-active' | 'closing' | 'closed' | 'broken';

type TurnInputItem =
  | { type: 'text'; text: string }
  | { type: 'local_image'; path: string };

type ActiveTurn = {
  onActivity?: () => void;
  turnId: string | null;
  interruptRequested: boolean;
  finalAgentMessage: string | null;
  settled: boolean;
  resolve: (result: SendMessageResult) => void;
  reject: (error: Error) => void;
  promise: Promise<SendMessageResult>;
};

const MAX_START_RETRIES = 1;

export class CodexMinimalSession {
  private readonly workingDirectory: string;
  private readonly codexPathOverride?: string;
  private readonly codexArgsPrefix?: string[];
  private readonly resumeSessionId?: string;

  private appServerProcess: CodexAppServerProcess | null = null;
  private rpcClient: CodexAppServerRpcClient | null = null;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private state: SessionState = 'cold';
  private activeTurn: ActiveTurn | null = null;
  private inFlightPromise: Promise<SendMessageResult> | null = null;
  private startupPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;

  constructor(options: CodexMinimalSessionOptions) {
    this.workingDirectory = options.workingDirectory;
    this.codexPathOverride = options.codexPathOverride;
    this.codexArgsPrefix = options.codexArgsPrefix;
    this.resumeSessionId = options.resumeSessionId;
  }

  async sendMessage(text: string, options?: CodexMinimalSendMessageOptions): Promise<SendMessageResult> {
    if (this.inFlightPromise) {
      logger.warn('[CodexMinimalSession] Rejecting concurrent turn', {
        workingDirectory: this.workingDirectory,
        threadId: this.threadId,
      });
      throw new ConcurrentTurnError();
    }

    if (this.state === 'closing' || this.state === 'closed') {
      throw new Error('CodexMinimalSession has been closed.');
    }

    if (this.state === 'broken') {
      throw new Error('CodexMinimalSession is broken.');
    }

    logger.info('[CodexMinimalSession] Sending message via app-server', {
      workingDirectory: this.workingDirectory,
      threadId: this.threadId,
      messageLength: text.length,
      messageText: text,
      imageCount: options?.imagePaths?.length ?? 0,
      requestedResumeSessionId: this.resumeSessionId,
      resumeSupported: true,
    });

    const runPromise = this.runTurn(text, options);
    this.inFlightPromise = runPromise;

    try {
      return await runPromise;
    } finally {
      if (this.inFlightPromise === runPromise) {
        this.inFlightPromise = null;
      }
    }
  }

  interrupt(): boolean {
    if (!this.activeTurnId || !this.rpcClient || !this.threadId) {
      logger.warn('[CodexMinimalSession] No active turn to interrupt', {
        workingDirectory: this.workingDirectory,
        threadId: this.threadId,
        activeTurnId: this.activeTurnId,
      });
      return false;
    }

    logger.info('[CodexMinimalSession] Interrupting active turn', {
      workingDirectory: this.workingDirectory,
      threadId: this.threadId,
      turnId: this.activeTurnId,
    });

    if (this.activeTurn) {
      this.activeTurn.interruptRequested = true;
    }

    const threadId = this.threadId;
    const turnId = this.activeTurnId;
    void this.rpcClient.request('turn/interrupt', {
      threadId,
      turnId,
    }).catch((error) => {
      logger.warn('[CodexMinimalSession] turn/interrupt request failed', {
        workingDirectory: this.workingDirectory,
        threadId,
        turnId,
        error: asError(error, 'turn/interrupt failed'),
      });
    });
    return true;
  }

  isRunning(): boolean {
    return this.inFlightPromise !== null;
  }

  getThreadId(): string | null {
    return this.threadId;
  }

  async close(): Promise<void> {
    if (this.closePromise) {
      return await this.closePromise;
    }

    this.closePromise = this.closeInternal();
    return await this.closePromise;
  }

  async destroy(): Promise<void> {
    await this.close();
  }

  private async closeInternal(): Promise<void> {
    if (this.state === 'closed') {
      return;
    }

    this.state = 'closing';
    const process = this.appServerProcess;

    if (!process) {
      this.rpcClient?.closeAllPending(new Error('CodexMinimalSession closed.'));
      this.rpcClient = null;
      this.activeTurnId = null;
      this.activeTurn = null;
      this.state = 'closed';
      return;
    }

    try {
      await process.stop();
    } finally {
      this.rpcClient?.closeAllPending(new Error('CodexMinimalSession closed.'));
      this.rpcClient = null;
      this.appServerProcess = null;
      this.activeTurnId = null;
      if (this.activeTurn && !this.activeTurn.settled) {
        this.rejectTurn(this.activeTurn, new Error('CodexMinimalSession closed.'));
      }
      this.activeTurn = null;
      this.state = 'closed';
    }
  }

  private async runTurn(text: string, options?: CodexMinimalSendMessageOptions): Promise<SendMessageResult> {
    await this.ensureStarted();

    if (!this.rpcClient || !this.threadId) {
      throw new Error('Codex app-server session failed to initialize.');
    }

    const activeTurn = this.createActiveTurn(options?.onActivity);
    this.activeTurn = activeTurn;
    this.activeTurnId = null;
    this.state = 'turn-active';
    const input = buildThreadInput(text, options?.imagePaths);

    notifyActivity(options?.onActivity);

    logger.info('[CodexMinimalSession] Starting turn/start', {
      workingDirectory: this.workingDirectory,
      threadId: this.threadId,
      messageLength: text.length,
      messageText: text,
      imageCount: options?.imagePaths?.length ?? 0,
    });

    try {
      await this.rpcClient.request('turn/start', {
        threadId: this.threadId,
        approvalPolicy: 'never',
        input,
      });
    } catch (error) {
      const turnError = asError(error, 'turn/start failed');
      this.rejectTurn(activeTurn, turnError);
    }

    try {
      return await activeTurn.promise;
    } finally {
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
      if (canReturnToReadyState(this.state)) {
        this.state = 'ready';
      }
      this.activeTurnId = null;
    }
  }

  private async ensureStarted(): Promise<void> {
    if (this.state === 'ready' || this.state === 'turn-active') {
      return;
    }

    if (this.state === 'closing' || this.state === 'closed') {
      throw new Error('CodexMinimalSession has been closed.');
    }

    if (this.state === 'broken') {
      throw new Error('CodexMinimalSession is broken.');
    }

    if (this.startupPromise) {
      await this.startupPromise;
      return;
    }

    this.startupPromise = this.startWithRetry();
    try {
      await this.startupPromise;
    } finally {
      if (this.startupPromise) {
        this.startupPromise = null;
      }
    }
  }

  private async startWithRetry(): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_START_RETRIES; attempt += 1) {
      try {
        await this.startOnce(attempt + 1);
        return;
      } catch (error) {
        lastError = asError(error, 'Failed to start Codex app-server session.');
        logger.error('[CodexMinimalSession] Failed to initialize app-server session', {
          workingDirectory: this.workingDirectory,
          attempt: attempt + 1,
          maxAttempts: MAX_START_RETRIES + 1,
          error: lastError,
        });
        await this.resetTransportAfterStartupFailure();

        if (attempt >= MAX_START_RETRIES) {
          this.state = 'broken';
          throw lastError;
        }
      }
    }

    this.state = 'broken';
    throw lastError ?? new Error('Failed to start Codex app-server session.');
  }

  private async startOnce(attempt: number): Promise<void> {
    this.state = 'starting';
    const appServerProcess = new CodexAppServerProcess({
      cwd: this.workingDirectory,
      spawnTarget: resolveSpawnTarget(this.codexPathOverride, this.codexArgsPrefix),
    });
    appServerProcess.start();

    const rpcClient = new CodexAppServerRpcClient({
      stdin: appServerProcess.stdin,
    });

    appServerProcess.onLine((line) => {
      rpcClient.handleLine(line);
      this.handleAppServerLine(line);
    });
    appServerProcess.onExit((exit) => {
      this.handleProcessExit(appServerProcess, rpcClient, exit);
    });

    this.appServerProcess = appServerProcess;
    this.rpcClient = rpcClient;

    logger.info('[CodexMinimalSession] Initializing app-server session', {
      workingDirectory: this.workingDirectory,
      attempt,
      codexPathOverride: this.codexPathOverride,
      codexArgsPrefix: this.codexArgsPrefix,
    });

    await rpcClient.request('initialize', {
      clientInfo: {
        name: 'cc-feishu-typescript',
        version: '1.0.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    });

    rpcClient.notify('initialized');

    if (this.resumeSessionId) {
      await rpcClient.request('thread/resume', {
        threadId: this.resumeSessionId,
        cwd: this.workingDirectory,
        approvalPolicy: 'never',
        persistExtendedHistory: false,
        sandbox: 'danger-full-access',
      });
    } else {
      await rpcClient.request('thread/start', {
        cwd: this.workingDirectory,
        approvalPolicy: 'never',
        experimentalRawEvents: true,
        persistExtendedHistory: false,
        sandboxMode: 'danger-full-access',
        skipGitRepoCheck: true,
        networkAccessEnabled: true,
      });
    }

    const threadId = rpcClient.getThreadId();
    if (!threadId) {
      throw new Error('Codex thread initialization did not return a threadId.');
    }

    this.threadId = threadId;
    this.state = 'ready';

    logger.info('[CodexMinimalSession] App-server session ready', {
      workingDirectory: this.workingDirectory,
      threadId: this.threadId,
      attempt,
      resumed: !!this.resumeSessionId,
      requestedResumeSessionId: this.resumeSessionId,
    });
  }

  private async resetTransportAfterStartupFailure(): Promise<void> {
    const process = this.appServerProcess;
    const rpcClient = this.rpcClient;

    this.appServerProcess = null;
    this.rpcClient = null;
    this.activeTurnId = null;
    this.threadId = null;
    this.activeTurn = null;

    rpcClient?.closeAllPending(new Error('Codex app-server startup failed.'));

    if (process) {
      try {
        await process.stop();
      } catch (error) {
        logger.warn('[CodexMinimalSession] Failed to stop app-server after startup failure', {
          workingDirectory: this.workingDirectory,
          error,
        });
      }
    }

    if (this.state !== 'broken') {
      this.state = 'cold';
    }
  }

  private handleProcessExit(
    appServerProcess: CodexAppServerProcess,
    rpcClient: CodexAppServerRpcClient,
    exit: CodexAppServerProcessExit,
  ): void {
    const exitError = buildProcessExitError(exit, appServerProcess.getStderrTail());
    rpcClient.closeAllPending(exitError);

    if (this.appServerProcess !== appServerProcess) {
      return;
    }

    this.appServerProcess = null;
    this.rpcClient = null;
    this.activeTurnId = null;

    if (this.activeTurn && !this.activeTurn.settled) {
      this.rejectTurn(this.activeTurn, exitError);
      this.activeTurn = null;
    }

    if (this.state === 'closing' || this.state === 'closed') {
      this.state = 'closed';
      return;
    }

    this.state = 'broken';

    logger.error('[CodexMinimalSession] app-server exited and session is now broken', {
      workingDirectory: this.workingDirectory,
      threadId: this.threadId,
      exit,
      stderrTail: appServerProcess.getStderrTail(),
    });
  }

  private handleAppServerLine(line: string): void {
    const message = parseJsonLine(line);
    if (!message || typeof message.method !== 'string') {
      return;
    }

    const method = message.method;
    const params = isObjectRecord(message.params) ? message.params : {};

    if (this.activeTurn && isCurrentThreadActivity(method, params, this.threadId)) {
      notifyActivity(this.activeTurn.onActivity);
    }

    if (!this.threadId || !isCurrentThreadNotification(params, this.threadId)) {
      return;
    }

    if (method === 'turn/started') {
      const turnId = extractTurnId(params) ?? this.rpcClient?.getTurnId() ?? null;
      this.activeTurnId = turnId;
      if (this.activeTurn) {
        this.activeTurn.turnId = turnId;
      }
      return;
    }

    if (method === 'item/completed') {
      if (!this.activeTurn) {
        return;
      }

      const finalAgentMessage = extractFinalAgentMessage(params);
      if (finalAgentMessage) {
        this.activeTurn.finalAgentMessage = finalAgentMessage;
      }
      return;
    }

    if (method !== 'turn/completed' || !this.activeTurn) {
      return;
    }

    const turnStatus = extractTurnStatus(params);
    const turnError =
      extractTurnError(params) ??
      extractItemError(params) ??
      this.rpcClient?.getTurnError() ??
      null;

    if (this.activeTurn.interruptRequested && isAbortedTurnStatus(turnStatus)) {
      this.rejectTurn(this.activeTurn, new TurnAbortedError());
      return;
    }

    if (turnError) {
      this.rejectTurn(this.activeTurn, new Error(turnError));
      return;
    }

    if (turnStatus !== 'completed') {
      this.rejectTurn(this.activeTurn, new Error(`Codex turn ended with status ${turnStatus ?? 'unknown'}.`));
      return;
    }

    this.resolveTurn(this.activeTurn, {
      text: this.activeTurn.finalAgentMessage ?? '',
      threadId: this.threadId,
    });
  }

  private createActiveTurn(onActivity?: () => void): ActiveTurn {
    let resolveTurnPromise: ((result: SendMessageResult) => void) | null = null;
    let rejectTurnPromise: ((error: Error) => void) | null = null;

    const promise = new Promise<SendMessageResult>((resolve, reject) => {
      resolveTurnPromise = resolve;
      rejectTurnPromise = reject;
    });

    if (!resolveTurnPromise || !rejectTurnPromise) {
      throw new Error('Failed to create active Codex turn promise.');
    }

    return {
      onActivity,
      turnId: null,
      interruptRequested: false,
      finalAgentMessage: null,
      settled: false,
      resolve: resolveTurnPromise,
      reject: rejectTurnPromise,
      promise,
    };
  }

  private resolveTurn(turn: ActiveTurn, result: SendMessageResult): void {
    if (turn.settled) {
      return;
    }

    turn.settled = true;
    turn.resolve(result);
  }

  private rejectTurn(turn: ActiveTurn, error: Error): void {
    if (turn.settled) {
      return;
    }

    turn.settled = true;
    turn.reject(error);
  }
}

function notifyActivity(onActivity?: () => void): void {
  if (!onActivity) {
    return;
  }

  try {
    onActivity();
  } catch (error) {
    logger.warn('[CodexMinimalSession] Activity callback failed', { error });
  }
}

function buildThreadInput(text: string, imagePaths?: string[]): TurnInputItem[] {
  const sanitizedImagePaths = (imagePaths ?? []).filter(Boolean);
  const items: TurnInputItem[] = [
    { type: 'text', text },
  ];

  for (const imagePath of sanitizedImagePaths) {
    items.push({ type: 'local_image', path: imagePath });
  }

  return items;
}

function resolveSpawnTarget(
  codexPathOverride?: string,
  codexArgsPrefix?: string[],
): CodexAppServerSpawnTarget | undefined {
  if (!codexPathOverride && (!codexArgsPrefix || codexArgsPrefix.length === 0)) {
    return undefined;
  }

  if (codexArgsPrefix && codexArgsPrefix.length > 0) {
    throw new Error('codexArgsPrefix is not supported for codex app-server sessions.');
  }

  if (!codexPathOverride) {
    return undefined;
  }

  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', codexPathOverride, 'app-server'],
      launchDescription: `cmd.exe trampoline (${codexPathOverride} app-server)`,
    };
  }

  return {
    command: codexPathOverride,
    args: ['app-server'],
    launchDescription: `direct spawn (${codexPathOverride} app-server)`,
  };
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  const trimmedLine = line.trim();
  if (!trimmedLine) {
    return null;
  }

  try {
    const value = JSON.parse(trimmedLine) as unknown;
    return isObjectRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isCurrentThreadActivity(
  method: string,
  params: Record<string, unknown>,
  threadId: string | null,
): boolean {
  if (!threadId) {
    return false;
  }

  if (!method.startsWith('turn/') && !method.startsWith('item/')) {
    return false;
  }

  return normalizeString(params.threadId) === threadId;
}

function isCurrentThreadNotification(params: Record<string, unknown>, threadId: string): boolean {
  const paramsThreadId = normalizeString(params.threadId);
  return paramsThreadId === null || paramsThreadId === threadId;
}

function extractTurnId(params: Record<string, unknown>): string | null {
  const turn = params.turn;
  if (!isObjectRecord(turn)) {
    return null;
  }

  return normalizeString(turn.id);
}

function extractTurnStatus(params: Record<string, unknown>): string | null {
  const directStatus = normalizeString(params.status);
  if (directStatus) {
    return directStatus;
  }

  const turn = params.turn;
  if (!isObjectRecord(turn)) {
    return null;
  }

  return normalizeString(turn.status);
}

function extractTurnError(params: Record<string, unknown>): string | null {
  const directError = extractErrorMessage(params.error);
  if (directError) {
    return directError;
  }

  const turn = params.turn;
  if (!isObjectRecord(turn)) {
    return null;
  }

  return extractErrorMessage(turn.error);
}

function extractItemError(params: Record<string, unknown>): string | null {
  const item = params.item;
  if (!isObjectRecord(item) || item.type !== 'error') {
    return null;
  }

  return normalizeString(item.text) ?? normalizeString(item.message);
}

function extractFinalAgentMessage(params: Record<string, unknown>): string | null {
  const item = params.item;
  if (!isObjectRecord(item) || item.type !== 'agentMessage') {
    return null;
  }

  if (item.phase !== 'final_answer') {
    return null;
  }

  const text = collectText(item).join(' ').trim();
  return text || null;
}

function collectText(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(entry => collectText(entry));
  }

  const objectValue = value as Record<string, unknown>;
  const collected: string[] = [];

  for (const [key, entry] of Object.entries(objectValue)) {
    if (key === 'text' && typeof entry === 'string') {
      collected.push(entry);
      continue;
    }

    if (key === 'content' || key === 'message' || key === 'parts') {
      collected.push(...collectText(entry));
    }
  }

  return collected;
}

function extractErrorMessage(value: unknown): string | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  return normalizeString(value.message);
}

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function canReturnToReadyState(state: SessionState): boolean {
  return state !== 'broken' && state !== 'closing' && state !== 'closed';
}

function isAbortedTurnStatus(status: string | null): boolean {
  return status === 'cancelled' || status === 'canceled' || status === 'aborted' || status === 'interrupted';
}

function buildProcessExitError(exit: CodexAppServerProcessExit, stderrTail: string): Error {
  const messageParts = [
    `Codex app-server exited with code=${exit.code ?? 'null'} signal=${exit.signal ?? 'null'}.`,
  ];

  if (stderrTail) {
    messageParts.push(`stderr tail: ${stderrTail}`);
  }

  return new Error(messageParts.join(' '));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function asError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(fallbackMessage);
}
