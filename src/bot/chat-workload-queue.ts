import type { ActivityEvent, ActivityPhase } from '../agent/types';
import type { AgentProvider } from '../config';
import logger from '../utils/logger';
import { formatDuration } from './message-command-router';

export interface ChatWorkloadDescription {
  chatId: string;
  messageId: string;
  senderId: string;
  provider: AgentProvider;
  messageType: string;
  textLength: number;
  imageCount: number;
  enqueuedAt: number;
}

export interface ChatWorkloadProcessorContext {
  startTime: number;
  onActivity: (event?: ActivityEvent) => void;
}

export interface ChatWorkloadQueueOptions<TTask> {
  describeTask: (task: TTask) => ChatWorkloadDescription;
  processTask: (task: TTask, context: ChatWorkloadProcessorContext) => Promise<void>;
  stalledTaskHeartbeatNotifier?: (chatId: string, text: string) => Promise<void>;
  stalledTaskHeartbeatThresholdsMs?: readonly number[];
  stalledTaskHeartbeatIntervalMs?: number;
}

interface StalledTaskHeartbeatController {
  onActivity: () => void;
  cancel: () => void;
}

interface ActiveTaskProgress {
  chatId: string;
  messageId: string;
  messageType: string;
  provider: AgentProvider;
  startedAt: number;
  queueDelay: number;
  remainingQueueDepthAtStart: number;
  phase: ActivityPhase;
  reason: string;
  method?: string;
  threadId?: string | null;
  turnId?: string | null;
  lastActivityAt: number;
  activityCount: number;
}

export class ChatWorkloadQueue<TTask> {
  private readonly queuedTasks = new Map<string, TTask[]>();
  private readonly activeProcessors = new Map<string, Promise<void>>();
  private readonly describeTask: (task: TTask) => ChatWorkloadDescription;
  private readonly processTask: (task: TTask, context: ChatWorkloadProcessorContext) => Promise<void>;
  private readonly stalledTaskHeartbeatNotifier?: (chatId: string, text: string) => Promise<void>;
  private readonly stalledTaskHeartbeatThresholdsMs: readonly number[];
  private readonly stalledTaskHeartbeatIntervalMs: number;
  private readonly activeTaskProgress = new Map<string, ActiveTaskProgress>();

  constructor(options: ChatWorkloadQueueOptions<TTask>) {
    this.describeTask = options.describeTask;
    this.processTask = options.processTask;
    this.stalledTaskHeartbeatNotifier = options.stalledTaskHeartbeatNotifier;
    this.stalledTaskHeartbeatThresholdsMs = options.stalledTaskHeartbeatThresholdsMs
      ?? [2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000];
    this.stalledTaskHeartbeatIntervalMs = options.stalledTaskHeartbeatIntervalMs ?? 10 * 60 * 1000;
  }

  enqueue(task: TTask): number {
    const description = this.describeTask(task);
    const queue = this.queuedTasks.get(description.chatId) ?? [];
    queue.push(task);
    this.queuedTasks.set(description.chatId, queue);
    this.scheduleChatProcessor(description.chatId);

    const queueDepth = this.getChatQueueLength(description.chatId);
    logger.info('Queued incoming message', {
      messageId: description.messageId,
      chatId: description.chatId,
      senderId: description.senderId,
      provider: description.provider,
      messageType: description.messageType,
      textLength: description.textLength,
      imageCount: description.imageCount,
      queueDepth,
    });
    return queueDepth;
  }

  clear(chatId: string): number {
    const queue = this.queuedTasks.get(chatId);
    if (!queue?.length) {
      this.queuedTasks.delete(chatId);
      return 0;
    }

    const droppedCount = queue.length;
    this.queuedTasks.delete(chatId);
    return droppedCount;
  }

  getChatQueueLength(chatId: string): number {
    return this.queuedTasks.get(chatId)?.length ?? 0;
  }

  getTotalQueuedMessages(): number {
    let total = 0;
    for (const queue of this.queuedTasks.values()) {
      total += queue.length;
    }
    return total;
  }

  getActiveTaskStatus(chatId: string): string | null {
    const progress = this.activeTaskProgress.get(chatId);
    if (!progress) {
      return null;
    }

    const now = Date.now();
    const runningDuration = formatDuration((now - progress.startedAt) / 1000);
    const idleDuration = formatDuration((now - progress.lastActivityAt) / 1000);
    const lines = [
      '',
      '当前任务:',
      `- 状态: 运行中`,
      `- 消息类型: ${progress.messageType}`,
      `- 已运行: ${runningDuration}`,
      `- 最近无新进展: ${idleDuration}`,
      `- 当前阶段: ${formatActivityPhase(progress.phase)}`,
      `- 最近进展: ${progress.reason}`,
      `- 进展次数: ${progress.activityCount}`,
      `- 当前排队: ${this.getChatQueueLength(chatId)} 条`,
    ];

    if (progress.method) {
      lines.push(`- 最近事件: ${progress.method}`);
    }
    if (progress.turnId) {
      lines.push(`- Turn: ${progress.turnId.slice(0, 8)}...`);
    }

    return lines.join('\n');
  }

  async stop(): Promise<void> {
    await Promise.all(Array.from(this.activeProcessors.values()));
  }

  private scheduleChatProcessor(chatId: string): void {
    if (this.activeProcessors.has(chatId)) {
      return;
    }

    const processor = this.processChatQueue(chatId).finally(() => {
      this.activeProcessors.delete(chatId);
      if (this.hasQueuedMessages(chatId)) {
        this.scheduleChatProcessor(chatId);
      }
    });

    this.activeProcessors.set(chatId, processor);
  }

  private async processChatQueue(chatId: string): Promise<void> {
    while (true) {
      const task = this.dequeueTask(chatId);
      if (!task) {
        return;
      }

      await this.processQueuedTask(task);
    }
  }

  private dequeueTask(chatId: string): TTask | undefined {
    const queue = this.queuedTasks.get(chatId);
    if (!queue || queue.length === 0) {
      this.queuedTasks.delete(chatId);
      return undefined;
    }

    const task = queue.shift();
    if (!queue.length) {
      this.queuedTasks.delete(chatId);
    }
    return task;
  }

  private hasQueuedMessages(chatId: string): boolean {
    return this.getChatQueueLength(chatId) > 0;
  }

  private async processQueuedTask(task: TTask): Promise<void> {
    const description = this.describeTask(task);
    const startTime = Date.now();
    const queueDelay = startTime - description.enqueuedAt;
    const remainingQueueDepthAtStart = this.getChatQueueLength(description.chatId);
    const progress: ActiveTaskProgress = {
      chatId: description.chatId,
      messageId: description.messageId,
      messageType: description.messageType,
      provider: description.provider,
      startedAt: startTime,
      queueDelay,
      remainingQueueDepthAtStart,
      phase: 'received',
      reason: 'message dequeued',
      lastActivityAt: startTime,
      activityCount: 0,
    };

    logger.info('Processing queued message', {
      messageId: description.messageId,
      chatId: description.chatId,
      senderId: description.senderId,
      provider: description.provider,
      messageType: description.messageType,
      queueDelay,
      imageCount: description.imageCount,
      remainingQueueDepth: remainingQueueDepthAtStart,
    });

    let stalledTaskHeartbeat: StalledTaskHeartbeatController | null = null;
    const markActivity = (event?: ActivityEvent) => {
      progress.lastActivityAt = Date.now();
      progress.activityCount += 1;
      if (event) {
        progress.phase = event.phase;
        progress.reason = event.reason;
        progress.method = event.method;
        progress.threadId = event.threadId;
        progress.turnId = event.turnId;
      }
      stalledTaskHeartbeat?.onActivity();
    };

    this.activeTaskProgress.set(description.chatId, progress);
    stalledTaskHeartbeat = this.startStalledTaskHeartbeat(progress);
    try {
      await this.processTask(task, { startTime, onActivity: markActivity });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Error handling queued message event', {
        messageId: description.messageId,
        chatId: description.chatId,
        duration,
        error,
      });
    } finally {
      stalledTaskHeartbeat?.cancel();
      if (this.activeTaskProgress.get(description.chatId) === progress) {
        this.activeTaskProgress.delete(description.chatId);
      }
    }
  }

  private startStalledTaskHeartbeat(progress: ActiveTaskProgress): StalledTaskHeartbeatController | null {
    if (
      !this.stalledTaskHeartbeatNotifier ||
      this.stalledTaskHeartbeatThresholdsMs.length === 0 ||
      this.stalledTaskHeartbeatThresholdsMs.some((value, index, values) => (
        !Number.isFinite(value) ||
        value <= 0 ||
        (index > 0 && value <= values[index - 1])
      )) ||
      this.stalledTaskHeartbeatIntervalMs <= 0
    ) {
      return null;
    }

    let heartbeatIndex = 0;
    let generation = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const getThresholdMs = (): number => {
      if (heartbeatIndex < this.stalledTaskHeartbeatThresholdsMs.length) {
        return this.stalledTaskHeartbeatThresholdsMs[heartbeatIndex];
      }

      const finalThreshold = this.stalledTaskHeartbeatThresholdsMs.at(-1) ?? 0;
      const repeatCount = heartbeatIndex - this.stalledTaskHeartbeatThresholdsMs.length + 1;
      return finalThreshold + repeatCount * this.stalledTaskHeartbeatIntervalMs;
    };

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clearTimer();
      const scheduledGeneration = generation;
      const delayMs = Math.max(0, getThresholdMs() - (Date.now() - progress.lastActivityAt));
      timer = setTimeout(async () => {
        timer = null;
        if (
          cancelled ||
          scheduledGeneration !== generation ||
          this.activeTaskProgress.get(progress.chatId) !== progress
        ) {
          return;
        }

        const thresholdMs = getThresholdMs();
        const idleMs = Date.now() - progress.lastActivityAt;
        if (idleMs < thresholdMs) {
          schedule();
          return;
        }

        if (isResponseDeliveryPhase(progress.phase)) {
          return;
        }

        try {
          await this.stalledTaskHeartbeatNotifier?.(
            progress.chatId,
            this.formatStalledTaskHeartbeat(progress, heartbeatIndex),
          );
        } catch (error) {
          logger.warn('Failed to send stalled task heartbeat', {
            chatId: progress.chatId,
            messageId: progress.messageId,
            error,
          });
        }

        if (
          !cancelled &&
          scheduledGeneration === generation &&
          this.activeTaskProgress.get(progress.chatId) === progress
        ) {
          heartbeatIndex += 1;
          schedule();
        }
      }, delayMs);

      if (typeof (timer as { unref?: () => unknown }).unref === 'function') {
        (timer as { unref: () => unknown }).unref();
      }
    };

    schedule();

    return {
      onActivity: () => {
        if (cancelled) {
          return;
        }
        generation += 1;
        heartbeatIndex = 0;
        schedule();
      },
      cancel: () => {
        cancelled = true;
        generation += 1;
        clearTimer();
      },
    };
  }

  private formatStalledTaskHeartbeat(progress: ActiveTaskProgress, heartbeatIndex: number): string {
    const now = Date.now();
    const runningDuration = formatDuration((now - progress.startedAt) / 1000);
    const idleDuration = formatDuration((now - progress.lastActivityAt) / 1000);
    const lines = heartbeatIndex === 0
      ? [`任务仍在处理，但过去 ${idleDuration}内没有收到新的执行进展。`]
      : [`任务仍在处理，但仍未恢复进展，已连续 ${idleDuration}没有新的执行事件。`];

    lines.push(
      '当前可能正在等待模型、外部服务或长时间命令返回。',
      `- 已运行: ${runningDuration}`,
      `- 当前阶段: ${formatActivityPhase(progress.phase)}`,
      `- 当前排队: ${this.getChatQueueLength(progress.chatId)} 条`,
      '如需终止，可发送 /stop。',
    );

    return lines.join('\n');
  }
}

function isResponseDeliveryPhase(phase: ActivityPhase): boolean {
  return phase === 'turn_finishing' || phase === 'sending_response' || phase === 'cleanup';
}

function formatActivityPhase(phase: ActivityPhase): string {
  switch (phase) {
    case 'received':
      return '消息已出队';
    case 'starting':
      return '启动 app-server';
    case 'ready':
      return '会话已就绪';
    case 'turn_starting':
      return '正在启动 turn';
    case 'turn_running':
      return 'turn 运行中';
    case 'turn_finishing':
      return 'turn 收尾中';
    case 'sending_response':
      return '发送回复';
    case 'cleanup':
      return '清理状态';
    default:
      return phase;
  }
}
