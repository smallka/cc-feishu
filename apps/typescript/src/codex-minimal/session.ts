import { ThreadLike, loadCodexSdk } from './loader';
import logger from '../utils/logger';

export interface CodexMinimalSessionOptions {
  workingDirectory: string;
  codexPathOverride?: string;
  codexArgsPrefix?: string[];
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

export class CodexMinimalSession {
  private readonly workingDirectory: string;
  private readonly codexPathOverride?: string;
  private readonly codexArgsPrefix?: string[];
  private thread: ThreadLike | null = null;
  private inFlightPromise: Promise<SendMessageResult> | null = null;
  private abortController: AbortController | null = null;

  constructor(options: CodexMinimalSessionOptions) {
    this.workingDirectory = options.workingDirectory;
    this.codexPathOverride = options.codexPathOverride;
    this.codexArgsPrefix = options.codexArgsPrefix;
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

    logger.info('[CodexMinimalSession] Starting thread.run', {
      workingDirectory: this.workingDirectory,
      threadId: thread.id,
      messageLength: text.length,
      messageText: text,
    });

    try {
      const result = await thread.run(text, { signal: abortController.signal });
      logger.info('[CodexMinimalSession] Completed thread.run', {
        workingDirectory: this.workingDirectory,
        threadId: thread.id,
        textLength: result.finalResponse.length,
        responseText: result.finalResponse,
        usage: result.usage,
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
        });
        throw new TurnAbortedError();
      }
      logger.error('[CodexMinimalSession] thread.run failed', {
        workingDirectory: this.workingDirectory,
        threadId: thread.id,
        error,
      });
      throw error;
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

    this.thread = client.startThread({
      sandboxMode: 'workspace-write',
      workingDirectory: this.workingDirectory,
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
      networkAccessEnabled: true,
    });

    logger.info('[CodexMinimalSession] Started thread', {
      sandboxMode: 'workspace-write',
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
