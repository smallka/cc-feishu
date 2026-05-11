import { existsSync } from 'fs';
import { mkdirSync } from 'fs';

import logger from '../utils/logger';
import { chatManager } from '../bot/chat-manager';
import { resolveChatAccess } from '../bot/chat-access';
import { chatBindingStore } from '../bot/chat-binding-store';
import { deriveChatDirectoryName } from '../bot/directory-name';
import menuContext from '../bot/menu-context';
import {
  formatDuration,
  getInvalidBindingText,
  getInvalidStoredBinding,
  handleMessageCommand,
  logLongProcessing,
} from '../bot/message-command-router';
import { isDirectoryAvailable, resolveWorkPathCandidate } from '../bot/work-directory';
import type { ActivityEvent, ActivityPhase } from '../agent/types';
import chatService from '../services/chat.service';
import messageService from '../services/message.service';
import config, { type AgentProvider } from '../config';

const processedMessages = new Set<string>();
const MAX_CACHE_SIZE = 500;
const queuedMessages = new Map<string, QueuedMessageTask[]>();
const activeProcessors = new Map<string, Promise<void>>();
const activeTaskProgress = new Map<string, ActiveTaskProgress>();
let acceptingMessages = true;
const MESSAGE_IDLE_TIMEOUT_MS = 300000;
const MESSAGE_STARTUP_IDLE_TIMEOUT_MS = 60000;
const MESSAGE_TURN_START_IDLE_TIMEOUT_MS = 120000;
const MESSAGE_TURN_RUNNING_IDLE_TIMEOUT_MS = 600000;
const MESSAGE_RESPONSE_IDLE_TIMEOUT_MS = 60000;
const MESSAGE_HEARTBEAT_FIRST_MS = 120000;
const MESSAGE_HEARTBEAT_INTERVAL_MS = 300000;
const MESSAGE_TIMEOUT_ACTION: 'notify' | 'kill' = 'notify';

interface MessageEvent {
  sender: {
    sender_id: {
      open_id: string;
      user_id?: string;
    };
    sender_type: string;
  };
  message: {
    message_id: string;
    message_type: string;
    content: string;
    chat_id: string;
    chat_type?: string;
  };
}

interface TextMessageContent {
  text?: string;
}

interface ImageMessageContent {
  image_key?: string;
}

interface FileMessageContent {
  file_key?: string;
  file_name?: string;
}

interface QueuedMessageTask {
  data: MessageEvent;
  text: string;
  messageType: string;
  imagePaths?: string[];
  enqueuedAt: number;
}

interface MessageProcessingOptions {
  onActivity?: (event?: ActivityEvent) => void;
}

interface ProgressState {
  phase: ActivityPhase;
  reason: string;
  method?: string;
  threadId?: string | null;
  turnId?: string | null;
  lastActivityAt: number;
  activityCount: number;
}

interface ActiveTaskProgress extends ProgressState {
  chatId: string;
  messageId: string;
  messageType: string;
  provider: AgentProvider;
  startedAt: number;
  queueDelay: number;
  remainingQueueDepthAtStart: number;
}

function getUnauthorizedText(openId: string): string {
  return `当前账号无权限使用这个机器人。\n你的 open_id: ${openId}\n如需授权，请将它加入 FEISHU_ALLOWED_OPEN_IDS。`;
}

function getUnboundText(): string {
  return '当前群尚未绑定工作目录，请先使用 /cd <路径> 绑定。';
}

function getResetInvalidBindingText(cwd: string, droppedCount: number): string {
  const droppedSuffix = droppedCount > 0 ? `，已清空 ${droppedCount} 条排队消息` : '';
  return `会话已重置${droppedSuffix}。\n${getInvalidBindingText(cwd)}`;
}

function isDirectChat(chatType: string | undefined): boolean {
  return chatType === 'p2p' || chatType === 'p2p_chat';
}

function buildAutoBindMessage(
  chatName: string,
  target: string,
  directoryName: string,
  options: { created: boolean; sanitized: boolean; existed: boolean },
): string {
  const lines = [
    options.created
      ? '已根据群名自动创建并绑定工作目录。'
      : '已根据群名自动绑定到现有工作目录。',
    `群名: ${chatName}`,
    `工作目录: ${target}`,
  ];

  if (options.existed) {
    lines.push(`检测到同名目录已存在，已直接绑定: ${directoryName}`);
  } else {
    lines.push(`已创建目录: ${directoryName}`);
  }

  if (options.sanitized) {
    lines.push(`群名已按 Windows 目录规则规范化为: ${directoryName}`);
  }

  return lines.join('\n');
}

async function autoBindGroupDirectory(chatId: string): Promise<{ bound: boolean; notified: boolean }> {
  const chatName = await chatService.getChatName(chatId);
  if (!chatName) {
    await messageService.sendTextMessage(
      chatId,
      '当前群尚未绑定工作目录，且读取群名失败，请使用 /cd <路径> 绑定。',
    );
    return { bound: false, notified: true };
  }

  const derived = deriveChatDirectoryName(chatName);
  if (!derived.autoBindable || !derived.directoryName) {
    await messageService.sendTextMessage(
      chatId,
      [
        '当前群尚未绑定工作目录。',
        `群名: ${chatName}`,
        '该群名在按 Windows 目录规则规范化后仍不可用，请使用 /cd <路径> 手动绑定。',
      ].join('\n'),
    );
    return { bound: false, notified: true };
  }

  const target = resolveWorkPathCandidate(derived.directoryName);
  const targetExists = existsSync(target);

  if (targetExists && !isDirectoryAvailable(target)) {
    await messageService.sendTextMessage(
      chatId,
      `群名对应路径已存在但不是目录: ${target}\n请使用 /cd <路径> 手动绑定。`,
    );
    return { bound: false, notified: true };
  }

  if (!targetExists) {
    try {
      mkdirSync(target, { recursive: true });
    } catch (error: any) {
      await messageService.sendTextMessage(chatId, `自动创建目录失败: ${target}\n${error.message}`);
      return { bound: false, notified: true };
    }

    if (!isDirectoryAvailable(target)) {
      await messageService.sendTextMessage(chatId, `自动创建目录失败: ${target}`);
      return { bound: false, notified: true };
    }
  }

  await chatManager.switchCwd(chatId, target);
  await messageService.sendTextMessage(
    chatId,
    buildAutoBindMessage(chatName, target, derived.directoryName, {
      created: !targetExists,
      sanitized: derived.sanitized,
      existed: targetExists,
    }),
  );
  return { bound: true, notified: true };
}

export function handleMessage(data: MessageEvent): Promise<void> {
  return prepareMessageTask(data);
}

async function prepareMessageTask(data: MessageEvent): Promise<void> {
  const { message, sender } = data;
  const chatId = message.chat_id;

  if (!acceptingMessages) {
    logger.warn('Dropping incoming message because handler is stopping', {
      messageId: message.message_id,
      chatId,
    });
    return;
  }

  if (processedMessages.has(message.message_id)) {
    logger.debug('Skipping duplicate message', { messageId: message.message_id });
    return;
  }

  const task = await createQueuedTask(data);
  if (!task) {
    return;
  }

  rememberProcessedMessage(message.message_id);

  let binding = chatBindingStore.get(chatId);
  let bindingValid = !binding || isDirectoryAvailable(binding.cwd);
  const hasActiveMenuSelection = /^\d$/.test(task.text) && menuContext.get(chatId) !== null;

  let access = resolveChatAccess({
    text: task.text,
    senderOpenId: sender.sender_id.open_id,
    allowedOpenIds: config.feishu.allowedOpenIds,
    binding,
    isDirectChat: isDirectChat(message.chat_type),
    bindingValid,
    hasActiveMenuSelection,
  });

  if (access.kind === 'unauthorized') {
    logger.warn('Rejected message from unauthorized sender', {
      messageId: message.message_id,
      chatId,
      senderOpenId: sender.sender_id.open_id,
      allowedOpenIds: config.feishu.allowedOpenIds,
      chatType: message.chat_type,
      messageType: task.messageType,
      text: task.text,
    });
    await messageService.sendTextMessage(chatId, getUnauthorizedText(sender.sender_id.open_id));
    return;
  }

  if (access.kind === 'unbound') {
    const autoBindResult = await autoBindGroupDirectory(chatId);
    if (!autoBindResult.bound) {
      if (!autoBindResult.notified) {
        await messageService.sendTextMessage(chatId, getUnboundText());
      }
      return;
    }

    binding = chatBindingStore.get(chatId);
    bindingValid = !binding || isDirectoryAvailable(binding.cwd);
    access = resolveChatAccess({
      text: task.text,
      senderOpenId: sender.sender_id.open_id,
      allowedOpenIds: config.feishu.allowedOpenIds,
      binding,
      isDirectChat: isDirectChat(message.chat_type),
      bindingValid,
      hasActiveMenuSelection,
    });
  }

  if (access.kind === 'invalid_binding') {
    await messageService.sendTextMessage(chatId, getInvalidBindingText(binding?.cwd ?? ''));
    return;
  }

  if (task.messageType === 'text' && task.text === '/stop') {
    await handleImmediateStop(chatId);
    return;
  }

  if (task.messageType === 'text' && task.text === '/new') {
    await handleImmediateReset(chatId);
    return;
  }

  enqueueTask(task);

  logger.info('Queued incoming message', {
    messageId: message.message_id,
    chatId,
    senderId: sender.sender_id.open_id,
    provider: chatManager.getProvider(chatId),
    messageType: task.messageType,
    textLength: task.text.length,
    imageCount: task.imagePaths?.length ?? 0,
    queueDepth: getChatQueueLength(chatId),
  });
}

export async function stopMessageHandling(): Promise<void> {
  acceptingMessages = false;
  logger.info('Stopping message handler', {
    activeChats: activeProcessors.size,
    queuedMessages: getTotalQueuedMessages(),
  });
  await Promise.all(Array.from(activeProcessors.values()));
  logger.info('Message handler stopped');
}

async function handleImmediateStop(chatId: string): Promise<void> {
  menuContext.clear(chatId);
  const result = await chatManager.interrupt(chatId);

  if (result === 'success') {
    await messageService.sendTextMessage(chatId, '已发送中断信号，AI 将停止当前任务。');
  } else if (result === 'timeout') {
    await messageService.sendTextMessage(chatId, '中断信号发送超时，请使用 /new 强制重置会话。');
  } else if (result === 'no_session') {
    await messageService.sendTextMessage(chatId, '当前没有活跃会话。');
  } else {
    await messageService.sendTextMessage(chatId, '中断失败，请使用 /new 强制重置会话。');
  }
}

async function handleImmediateReset(chatId: string): Promise<void> {
  menuContext.clear(chatId);
  const droppedCount = clearQueuedMessages(chatId);
  await chatManager.interrupt(chatId).catch(() => 'error');
  const invalidBinding = getInvalidStoredBinding(chatId);
  const cwd = await chatManager.reset(chatId);
  if (invalidBinding) {
    await messageService.sendTextMessage(chatId, getResetInvalidBindingText(invalidBinding.cwd, droppedCount));
    return;
  }

  const droppedSuffix = droppedCount > 0 ? `，已清空 ${droppedCount} 条排队消息` : '';
  await messageService.sendTextMessage(chatId, `会话已重置${droppedSuffix}，可以开始新的对话。\n工作目录: ${cwd}`);
}

function rememberProcessedMessage(messageId: string): void {
  processedMessages.add(messageId);
  if (processedMessages.size > MAX_CACHE_SIZE) {
    const first = processedMessages.values().next().value;
    if (first) {
      processedMessages.delete(first);
    }
  }
}

function enqueueTask(task: QueuedMessageTask): void {
  const chatId = task.data.message.chat_id;
  const queue = queuedMessages.get(chatId) ?? [];
  queue.push(task);
  queuedMessages.set(chatId, queue);
  scheduleChatProcessor(chatId);
}

function scheduleChatProcessor(chatId: string): void {
  if (activeProcessors.has(chatId)) {
    return;
  }

  const processor = processChatQueue(chatId).finally(() => {
    activeProcessors.delete(chatId);
    if (hasQueuedMessages(chatId)) {
      scheduleChatProcessor(chatId);
    }
  });

  activeProcessors.set(chatId, processor);
}

async function processChatQueue(chatId: string): Promise<void> {
  while (true) {
    const task = dequeueTask(chatId);
    if (!task) {
      return;
    }

    await processQueuedMessage(task);
  }
}

function dequeueTask(chatId: string): QueuedMessageTask | undefined {
  const queue = queuedMessages.get(chatId);
  if (!queue || queue.length === 0) {
    queuedMessages.delete(chatId);
    return undefined;
  }

  const task = queue.shift();
  if (!queue.length) {
    queuedMessages.delete(chatId);
  }
  return task;
}

function hasQueuedMessages(chatId: string): boolean {
  return (queuedMessages.get(chatId)?.length ?? 0) > 0;
}

function clearQueuedMessages(chatId: string): number {
  const queue = queuedMessages.get(chatId);
  if (!queue?.length) {
    queuedMessages.delete(chatId);
    return 0;
  }

  const droppedCount = queue.length;
  queuedMessages.delete(chatId);
  return droppedCount;
}

function getChatQueueLength(chatId: string): number {
  return queuedMessages.get(chatId)?.length ?? 0;
}

function getTotalQueuedMessages(): number {
  let total = 0;
  for (const queue of queuedMessages.values()) {
    total += queue.length;
  }
  return total;
}

function getActiveTaskStatus(chatId: string): string | null {
  const progress = activeTaskProgress.get(chatId);
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
    `- 当前排队: ${getChatQueueLength(chatId)} 条`,
  ];

  if (progress.method) {
    lines.push(`- 最近事件: ${progress.method}`);
  }
  if (progress.turnId) {
    lines.push(`- Turn: ${progress.turnId.slice(0, 8)}...`);
  }

  return lines.join('\n');
}

function getIdleTimeoutForPhase(phase: ActivityPhase): number {
  switch (phase) {
    case 'starting':
    case 'ready':
      return MESSAGE_STARTUP_IDLE_TIMEOUT_MS;
    case 'turn_starting':
      return MESSAGE_TURN_START_IDLE_TIMEOUT_MS;
    case 'turn_running':
      return MESSAGE_TURN_RUNNING_IDLE_TIMEOUT_MS;
    case 'turn_finishing':
    case 'sending_response':
    case 'cleanup':
      return MESSAGE_RESPONSE_IDLE_TIMEOUT_MS;
    case 'received':
    default:
      return MESSAGE_IDLE_TIMEOUT_MS;
  }
}

function formatIdleNotice(progress: ProgressState, timeout: number): string {
  const seconds = Math.round(timeout / 1000);
  const phaseText = formatActivityPhase(progress.phase);
  const detailParts = [`最后进展: ${phaseText}`, progress.reason];
  if (progress.method) {
    detailParts.push(`事件: ${progress.method}`);
  }
  if (progress.turnId) {
    detailParts.push(`Turn: ${progress.turnId.slice(0, 8)}...`);
  }

  return `任务运行较久（${seconds}秒内没有新进展）。${detailParts.join('，')}。`;
}

function formatHeartbeatNotice(progress: ActiveTaskProgress): string {
  const now = Date.now();
  return [
    `任务仍在运行，已运行 ${formatDuration((now - progress.startedAt) / 1000)}。`,
    `当前阶段: ${formatActivityPhase(progress.phase)}`,
    `最近进展: ${progress.reason}`,
    `最近无新进展: ${formatDuration((now - progress.lastActivityAt) / 1000)}`,
    `当前排队: ${getChatQueueLength(progress.chatId)} 条`,
  ].join('\n');
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

async function processQueuedMessage(task: QueuedMessageTask): Promise<void> {
  const { data } = task;
  const { sender, message } = data;
  const startTime = Date.now();
  const queueDelay = startTime - task.enqueuedAt;
  const remainingQueueDepthAtStart = getChatQueueLength(message.chat_id);
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdogSettled = false;
  let resolveTimeout: ((result: 'timeout') => void) | null = null;
  const progress: ActiveTaskProgress = {
    chatId: message.chat_id,
    messageId: message.message_id,
    messageType: task.messageType,
    provider: chatManager.getProvider(message.chat_id),
    startedAt: startTime,
    queueDelay,
    remainingQueueDepthAtStart,
    phase: 'received',
    reason: 'message dequeued',
    lastActivityAt: startTime,
    activityCount: 0,
  };

  logger.info('Processing queued message', {
    messageId: message.message_id,
    chatId: message.chat_id,
    senderId: sender.sender_id.open_id,
    provider: chatManager.getProvider(message.chat_id),
    messageType: task.messageType,
    queueDelay,
    imageCount: task.imagePaths?.length ?? 0,
    remainingQueueDepth: remainingQueueDepthAtStart,
  });

  const clearWatchdog = () => {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = undefined;
    }
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = undefined;
    }
  };

  const scheduleTimeout = () => {
    if (watchdogSettled) {
      return;
    }

    clearWatchdog();
    timeoutTimer = setTimeout(() => {
      watchdogSettled = true;
      resolveTimeout?.('timeout');
    }, getIdleTimeoutForPhase(progress.phase));
  };

  const markActivity = (event?: ActivityEvent) => {
    if (watchdogSettled) {
      return;
    }

    progress.lastActivityAt = Date.now();
    progress.activityCount += 1;
    if (event) {
      progress.phase = event.phase;
      progress.reason = event.reason;
      progress.method = event.method;
      progress.threadId = event.threadId;
      progress.turnId = event.turnId;
    }
    scheduleTimeout();
  };

  const scheduleHeartbeat = (delay: number) => {
    if (watchdogSettled) {
      return;
    }

    heartbeatTimer = setTimeout(() => {
      if (watchdogSettled || activeTaskProgress.get(message.chat_id) !== progress) {
        return;
      }

      messageService.sendTextMessage(message.chat_id, formatHeartbeatNotice(progress)).catch(error => {
        logger.error('Failed to send heartbeat notification', {
          messageId: message.message_id,
          chatId: message.chat_id,
          error,
        });
      });
      scheduleHeartbeat(MESSAGE_HEARTBEAT_INTERVAL_MS);
    }, delay);
  };

  activeTaskProgress.set(message.chat_id, progress);
  scheduleHeartbeat(MESSAGE_HEARTBEAT_FIRST_MS);
  const processingPromise = handleMessageInternal(task, startTime, { onActivity: markActivity }).finally(() => {
    watchdogSettled = true;
    clearWatchdog();
    clearHeartbeat();
    if (activeTaskProgress.get(message.chat_id) === progress) {
      activeTaskProgress.delete(message.chat_id);
    }
  });
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    resolveTimeout = resolve;
    scheduleTimeout();
  });

  try {
    const result = await Promise.race<'completed' | 'timeout'>([
      processingPromise.then(() => 'completed' as const),
      timeoutPromise,
    ]);

    if (result === 'completed') {
      return;
    }

    const duration = Date.now() - startTime;
    const idleDuration = Date.now() - progress.lastActivityAt;
    const timeout = getIdleTimeoutForPhase(progress.phase);
    logger.error('Message processing idle timeout', {
      messageId: message.message_id,
      chatId: message.chat_id,
      duration,
      idleDuration,
      timeout,
      activityCount: progress.activityCount,
      phase: progress.phase,
      reason: progress.reason,
      method: progress.method,
      threadId: progress.threadId,
      turnId: progress.turnId,
    });

    if (MESSAGE_TIMEOUT_ACTION === 'kill') {
      await messageService.sendTextMessage(
        message.chat_id,
        `${formatIdleNotice(progress, timeout)}\n已终止当前任务。请重试或使用 /new 重置会话。`,
      ).catch(error => {
        logger.error('Failed to send timeout notification', { error });
      });

      logger.info('Terminating session due to idle timeout', { chatId: message.chat_id });
      await chatManager.interrupt(message.chat_id).catch(() => 'error');
      await chatManager.reset(message.chat_id);
    } else {
      await messageService.sendTextMessage(
        message.chat_id,
        `${formatIdleNotice(progress, timeout)}\n当前任务仍在收尾，后续消息会继续排队。可使用 /stop 中断，或使用 /new 重置会话。`,
      ).catch(error => {
        logger.error('Failed to send timeout notification', { error });
      });
    }

    await processingPromise.catch(error => {
      logger.warn('Queued message finished after idle timeout', {
        messageId: message.message_id,
        chatId: message.chat_id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Error handling queued message event', {
      messageId: message.message_id,
      chatId: message.chat_id,
      duration,
      error,
    });
  } finally {
    clearWatchdog();
    clearHeartbeat();
    if (activeTaskProgress.get(message.chat_id) === progress) {
      activeTaskProgress.delete(message.chat_id);
    }
  }
}

async function handleMessageInternal(
  task: QueuedMessageTask,
  startTime: number,
  options?: MessageProcessingOptions,
): Promise<void> {
  const { data, text } = task;
  const { message } = data;
  const chatId = message.chat_id;

  logger.info('Received chat text', {
    messageId: message.message_id,
    chatId,
    provider: chatManager.getProvider(chatId),
    messageType: task.messageType,
    text,
    textLength: text.length,
    imageCount: task.imagePaths?.length ?? 0,
  });

  const result = await handleMessageCommand({ ...task, message }, {
    getActiveTaskStatus,
    onActivity: options?.onActivity,
  });

  if (result.kind === 'agent_message' && logLongProcessing(startTime)) {
    const duration = Date.now() - startTime;
    logger.warn('Message processing took long time', {
      messageId: message.message_id,
      chatId,
      duration,
      threshold: MESSAGE_IDLE_TIMEOUT_MS * 0.5,
    });
  }
}

async function createQueuedTask(data: MessageEvent): Promise<QueuedMessageTask | null> {
  const { message } = data;

  if (message.message_type === 'text') {
    return createTextTask(data);
  }

  if (message.message_type === 'image') {
    return createImageTask(data);
  }

  if (message.message_type === 'file') {
    return createFileTask(data);
  }

  logger.debug('Skipping unsupported message type', {
    messageId: message.message_id,
    chatId: message.chat_id,
    messageType: message.message_type,
  });
  return null;
}

function createTextTask(data: MessageEvent): QueuedMessageTask | null {
  const { message } = data;

  let content: TextMessageContent;
  try {
    content = JSON.parse(message.content) as TextMessageContent;
  } catch (error) {
    logger.error('Failed to parse text message content', {
      messageId: message.message_id,
      chatId: message.chat_id,
      error,
    });
    return null;
  }

  const text = (content.text || '').trim();
  if (!text) {
    logger.debug('Skipping empty text message', {
      messageId: message.message_id,
      chatId: message.chat_id,
    });
    return null;
  }

  return {
    data,
    text,
    messageType: 'text',
    enqueuedAt: Date.now(),
  };
}

async function createImageTask(data: MessageEvent): Promise<QueuedMessageTask | null> {
  const { message } = data;
  const chatId = message.chat_id;

  if (chatManager.getProvider(chatId) !== 'codex') {
    await messageService.sendTextMessage(chatId, '当前仅 Codex 支持图片消息，请先使用 /agent 切换到 Codex。');
    return null;
  }

  let content: ImageMessageContent;
  try {
    content = JSON.parse(message.content) as ImageMessageContent;
  } catch (error) {
    logger.error('Failed to parse image message content', {
      messageId: message.message_id,
      chatId,
      error,
    });
    return null;
  }

  const imageKey = content.image_key?.trim();
  if (!imageKey) {
    logger.warn('Skipping image message without image key', {
      messageId: message.message_id,
      chatId,
    });
    return null;
  }

  try {
    const imagePath = await messageService.downloadMessageImage(message.message_id, imageKey);
    return {
      data,
      text: '用户发送了一张图片，请结合图片内容继续处理当前请求。',
      messageType: 'image',
      imagePaths: [imagePath],
      enqueuedAt: Date.now(),
    };
  } catch (error) {
    logger.error('Failed to download image message resource', {
      messageId: message.message_id,
      chatId,
      imageKey,
      error,
    });
    await messageService.sendTextMessage(chatId, '图片下载失败，请稍后重试。');
    return null;
  }
}

async function createFileTask(data: MessageEvent): Promise<QueuedMessageTask | null> {
  const { message } = data;
  const chatId = message.chat_id;

  if (chatManager.getProvider(chatId) !== 'codex') {
    await messageService.sendTextMessage(chatId, '当前仅 Codex 支持文件消息，请先使用 /agent 切换到 Codex。');
    return null;
  }

  let content: FileMessageContent;
  try {
    content = JSON.parse(message.content) as FileMessageContent;
  } catch (error) {
    logger.error('Failed to parse file message content', {
      messageId: message.message_id,
      chatId,
      error,
    });
    return null;
  }

  const fileKey = content.file_key?.trim();
  if (!fileKey) {
    logger.warn('Skipping file message without file key', {
      messageId: message.message_id,
      chatId,
    });
    return null;
  }

  try {
    const filePath = await messageService.downloadMessageFile(message.message_id, fileKey, content.file_name);
    const prompt = [
      `用户发送了一个文件${content.file_name ? `：${content.file_name}` : ''}。`,
      `文件已保存到本地路径：${filePath}`,
      '请先读取该文件，再继续处理当前请求。',
    ].join('\n');

    return {
      data,
      text: prompt,
      messageType: 'file',
      enqueuedAt: Date.now(),
    };
  } catch (error) {
    logger.error('Failed to download file message resource', {
      messageId: message.message_id,
      chatId,
      fileKey,
      fileName: content.file_name,
      error,
    });
    await messageService.sendTextMessage(chatId, '文件下载失败，请稍后重试。');
    return null;
  }
}
