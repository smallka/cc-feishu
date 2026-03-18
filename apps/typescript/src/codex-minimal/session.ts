import { ThreadLike, loadCodexSdk } from './loader';
import logger from '../utils/logger';

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

const MAX_TRANSIENT_RUN_RETRIES = 2;
const TRANSIENT_RUN_RETRY_BASE_DELAY_MS = 1000;
const TRANSIENT_RUN_ERROR_PATTERNS = [
  /reconnecting\.\.\.\s*\d+\/\d+/i,
  /stream disconnected before completion/i,
  /transport error/i,
  /network error/i,
  /error decoding response body/i,
];

export class CodexMinimalSession {
  private readonly workingDirectory: string;
  private readonly codexPathOverride?: string;
  private readonly codexArgsPrefix?: string[];
  private readonly resumeSessionId?: string;
  private thread: ThreadLike | null = null;
  private inFlightPromise: Promise<SendMessageResult> | null = null;
  private abortController: AbortController | null = null;

  constructor(options: CodexMinimalSessionOptions) {
    this.workingDirectory = options.workingDirectory;
    this.codexPathOverride = options.codexPathOverride;
    this.codexArgsPrefix = options.codexArgsPrefix;
    this.resumeSessionId = options.resumeSessionId;
  }

  async sendMessage(text: string): Promise<SendMessageResult> {
    if (this.inFlightPromise) {
      logger.warn('[CodexMinimalSession] Rejecting concurrent turn', {
        workingDirectory: this.workingDirectory,
        threadId: this.getThreadId(),
      });
      throw new ConcurrentTurnError();
    }

    logger.info('[CodexMinimalSession] Sending message', {
      workingDirectory: this.workingDirectory,
      threadId: this.getThreadId(),
      messageLength: text.length,
      messageText: text,
    });

    const runPromise = this.runTurn(text);
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
    if (!this.abortController) {
      logger.warn('[CodexMinimalSession] No running turn to interrupt', {
        workingDirectory: this.workingDirectory,
        threadId: this.getThreadId(),
      });
      return false;
    }

    logger.info('[CodexMinimalSession] Aborting current turn', {
      workingDirectory: this.workingDirectory,
      threadId: this.getThreadId(),
    });
    this.abortController.abort('Interrupted by caller.');
    return true;
  }

  isRunning(): boolean {
    return this.inFlightPromise !== null;
  }

  getThreadId(): string | null {
    return this.thread?.id ?? null;
  }

  private async runTurn(text: string): Promise<SendMessageResult> {
    const thread = await this.ensureThread();
    const abortController = new AbortController();
    this.abortController = abortController;
    let attempt = 0;

    try {
      while (true) {
        const attemptNumber = attempt + 1;
        logger.info('[CodexMinimalSession] Starting thread.run', {
          workingDirectory: this.workingDirectory,
          threadId: thread.id,
          messageLength: text.length,
          messageText: text,
          attempt: attemptNumber,
          maxAttempts: MAX_TRANSIENT_RUN_RETRIES + 1,
        });

        try {
          const result = await thread.run(text, { signal: abortController.signal });
          logger.info('[CodexMinimalSession] Completed thread.run', {
            workingDirectory: this.workingDirectory,
            threadId: thread.id,
            textLength: result.finalResponse.length,
            responseText: result.finalResponse,
            usage: result.usage,
            attempt: attemptNumber,
          });
          return {
            text: result.finalResponse,
            threadId: thread.id,
          };
        } catch (error) {
          if (abortController.signal.aborted || isAbortError(error)) {
            logger.info('[CodexMinimalSession] thread.run aborted', {
              workingDirectory: this.workingDirectory,
              threadId: thread.id,
              attempt: attemptNumber,
            });
            throw new TurnAbortedError();
          }

          const retryable = isTransientRunError(error);
          const retriesRemaining = MAX_TRANSIENT_RUN_RETRIES - attempt;
          logger.error('[CodexMinimalSession] thread.run failed', {
            workingDirectory: this.workingDirectory,
            threadId: thread.id,
            attempt: attemptNumber,
            retryable,
            retriesRemaining: Math.max(0, retriesRemaining),
            error,
          });

          if (!retryable || attempt >= MAX_TRANSIENT_RUN_RETRIES) {
            throw error;
          }

          const retryDelayMs = getRetryDelayMs(attempt);
          logger.warn('[CodexMinimalSession] Retrying thread.run after transient failure', {
            workingDirectory: this.workingDirectory,
            threadId: thread.id,
            attempt: attemptNumber,
            nextAttempt: attemptNumber + 1,
            retryDelayMs,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
          await waitForRetryDelay(retryDelayMs, abortController.signal);
          attempt += 1;
        }
      }
    } finally {
      if (this.abortController === abortController) {
        this.abortController = null;
      }
    }
  }

  private async ensureThread(): Promise<ThreadLike> {
    if (this.thread) {
      logger.info('[CodexMinimalSession] Reusing existing thread', {
        workingDirectory: this.workingDirectory,
        threadId: this.thread.id,
      });
      return this.thread;
    }

    const sdk = await loadCodexSdk();
    const client = new sdk.Codex({
      codexPathOverride: this.codexPathOverride,
      codexArgsPrefix: this.codexArgsPrefix,
    });
    const threadOptions = {
      sandboxMode: 'danger-full-access',
      workingDirectory: this.workingDirectory,
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
      networkAccessEnabled: true,
    };
    this.thread = this.resumeSessionId
      ? client.resumeThread(this.resumeSessionId, threadOptions)
      : client.startThread(threadOptions);

    logger.info('[CodexMinimalSession] Created thread handle', {
      mode: this.resumeSessionId ? 'resume' : 'start',
      requestedResumeSessionId: this.resumeSessionId,
      sandboxMode: 'danger-full-access',
      workingDirectory: this.workingDirectory,
      threadId: this.thread.id,
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
      networkAccessEnabled: true,
      codexPathOverride: this.codexPathOverride,
      codexArgsPrefix: this.codexArgsPrefix,
    });

    return this.thread;
  }
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'AbortError' || /abort/i.test(error.message);
}

function isTransientRunError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return TRANSIENT_RUN_ERROR_PATTERNS.some(pattern => pattern.test(error.message));
}

function getRetryDelayMs(attempt: number): number {
  return TRANSIENT_RUN_RETRY_BASE_DELAY_MS * (attempt + 1);
}

function waitForRetryDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new TurnAbortedError());
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(new TurnAbortedError());
    };

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}
