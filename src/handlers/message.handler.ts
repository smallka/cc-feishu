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

interface ParsedMessageTask {
  data: MessageEvent;
  text: string;
  messageType: string;
  imageKey?: string;
  fileKey?: string;
  fileName?: string;
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

  const parsedTask = parseMessageTask(data);
  if (!parsedTask) {
    return;
  }

  rememberProcessedMessage(message.message_id);

  let binding = chatBindingStore.get(chatId);
  let bindingValid = !binding || isDirectoryAvailable(binding.cwd);
  const hasActiveMenuSelection = /^\d$/.test(parsedTask.text) && menuContext.get(chatId) !== null;

  let access = resolveChatAccess({
    text: parsedTask.text,
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
      messageType: parsedTask.messageType,
      text: parsedTask.text,
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
      text: parsedTask.text,
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

  if (parsedTask.messageType === 'text' && parsedTask.text === '/stop') {
    await handleImmediateStop(chatId);
    return;
  }

  if (parsedTask.messageType === 'text' && parsedTask.text === '/new') {
    await handleImmediateReset(chatId);
    return;
  }

  if (parsedTask.messageType === 'text' && parsedTask.text === '/stat') {
    await handleImmediateStatus(parsedTask);
    return;
  }

  const task = await materializeQueuedTask(parsedTask);
  if (!task) {
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

async function handleImmediateStatus(task: ParsedMessageTask): Promise<void> {
  await handleMessageCommand({
    text: task.text,
    messageType: task.messageType,
    message: task.data.message,
  }, {
    getActiveTaskStatus,
  });
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
  };

  activeTaskProgress.set(message.chat_id, progress);
  try {
    await handleMessageInternal(task, startTime, { onActivity: markActivity });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Error handling queued message event', {
      messageId: message.message_id,
      chatId: message.chat_id,
      duration,
      error,
    });
  } finally {
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

function parseMessageTask(data: MessageEvent): ParsedMessageTask | null {
  const { message } = data;

  if (message.message_type === 'text') {
    return parseTextTask(data);
  }

  if (message.message_type === 'image') {
    return parseImageTask(data);
  }

  if (message.message_type === 'file') {
    return parseFileTask(data);
  }

  logger.debug('Skipping unsupported message type', {
    messageId: message.message_id,
    chatId: message.chat_id,
    messageType: message.message_type,
  });
  return null;
}

function parseTextTask(data: MessageEvent): ParsedMessageTask | null {
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
  };
}

function parseImageTask(data: MessageEvent): ParsedMessageTask | null {
  const { message } = data;
  const chatId = message.chat_id;

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

  return {
    data,
    text: '用户发送了一张图片，请结合图片内容继续处理当前请求。',
    messageType: 'image',
    imageKey,
  };
}

function parseFileTask(data: MessageEvent): ParsedMessageTask | null {
  const { message } = data;
  const chatId = message.chat_id;

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

  return {
    data,
    text: '用户发送了一个文件。',
    messageType: 'file',
    fileKey,
    fileName: content.file_name,
  };
}

async function materializeQueuedTask(task: ParsedMessageTask): Promise<QueuedMessageTask | null> {
  if (task.messageType === 'text') {
    return {
      data: task.data,
      text: task.text,
      messageType: task.messageType,
      enqueuedAt: Date.now(),
    };
  }

  if (task.messageType === 'image') {
    return materializeImageTask(task);
  }

  if (task.messageType === 'file') {
    return materializeFileTask(task);
  }

  return null;
}

async function materializeImageTask(task: ParsedMessageTask): Promise<QueuedMessageTask | null> {
  const { message } = task.data;
  const chatId = message.chat_id;
  const imageKey = task.imageKey;

  if (chatManager.getProvider(chatId) !== 'codex') {
    await messageService.sendTextMessage(chatId, '当前仅 Codex 支持图片消息，请先使用 /agent 切换到 Codex。');
    return null;
  }

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
      data: task.data,
      text: task.text,
      messageType: task.messageType,
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

async function materializeFileTask(task: ParsedMessageTask): Promise<QueuedMessageTask | null> {
  const { message } = task.data;
  const chatId = message.chat_id;
  const fileKey = task.fileKey;
  const fileName = task.fileName;

  if (chatManager.getProvider(chatId) !== 'codex') {
    await messageService.sendTextMessage(chatId, '当前仅 Codex 支持文件消息，请先使用 /agent 切换到 Codex。');
    return null;
  }

  if (!fileKey) {
    logger.warn('Skipping file message without file key', {
      messageId: message.message_id,
      chatId,
    });
    return null;
  }

  try {
    const filePath = await messageService.downloadMessageFile(message.message_id, fileKey, fileName);
    const prompt = [
      `用户发送了一个文件${fileName ? `：${fileName}` : ''}。`,
      `文件已保存到本地路径：${filePath}`,
      '请先读取该文件，再继续处理当前请求。',
    ].join('\n');

    return {
      data: task.data,
      text: prompt,
      messageType: task.messageType,
      enqueuedAt: Date.now(),
    };
  } catch (error) {
    logger.error('Failed to download file message resource', {
      messageId: message.message_id,
      chatId,
      fileKey,
      fileName,
      error,
    });
    await messageService.sendTextMessage(chatId, '文件下载失败，请稍后重试。');
    return null;
  }
}
