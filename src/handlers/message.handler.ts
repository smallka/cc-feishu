import { existsSync } from 'fs';
import { mkdirSync } from 'fs';

import logger from '../utils/logger';
import { chatManager } from '../bot/chat-manager';
import { resolveChatAccess } from '../bot/chat-access';
import { chatBindingStore } from '../bot/chat-binding-store';
import { deriveChatDirectoryName } from '../bot/directory-name';
import menuContext from '../bot/menu-context';
import {
  getInvalidBindingText,
  getInvalidStoredBinding,
  handleMessageCommand,
  logLongProcessing,
} from '../bot/message-command-router';
import { ChatWorkloadQueue } from '../bot/chat-workload-queue';
import { isDirectoryAvailable, resolveWorkPathCandidate } from '../bot/work-directory';
import type { ActivityEvent } from '../agent/types';
import chatService from '../services/chat.service';
import messageService from '../services/message.service';
import config from '../config';
import {
  parseMessageTask,
  type MessageEvent,
  type ParsedMessageTask,
} from './message-intake';
import {
  materializeQueuedTask,
  type QueuedMessageTask,
} from './message-media-materialization';

const processedMessages = new Set<string>();
const MAX_CACHE_SIZE = 500;
let acceptingMessages = true;
const MESSAGE_IDLE_TIMEOUT_MS = 300000;

interface MessageProcessingOptions {
  onActivity?: (event?: ActivityEvent) => void;
}

const workloadQueue = new ChatWorkloadQueue<QueuedMessageTask>({
  describeTask: (task) => ({
    chatId: task.data.message.chat_id,
    messageId: task.data.message.message_id,
    senderId: task.data.sender.sender_id.open_id,
    provider: chatManager.getProvider(task.data.message.chat_id),
    messageType: task.messageType,
    textLength: task.text.length,
    imageCount: task.imagePaths?.length ?? 0,
    enqueuedAt: task.enqueuedAt,
  }),
  processTask: (task, context) => handleQueuedWorkload(task, context.startTime, {
    onActivity: context.onActivity,
  }),
});

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

  if (parsedTask.messageType === 'text') {
    const controlHandled = await handleControlMessage(parsedTask);
    if (controlHandled) {
      return;
    }
  }

  const task = await materializeQueuedTask(parsedTask);
  if (!task) {
    return;
  }

  workloadQueue.enqueue(task);
}

export async function stopMessageHandling(): Promise<void> {
  acceptingMessages = false;
  logger.info('Stopping message handler', {
    queuedMessages: workloadQueue.getTotalQueuedMessages(),
  });
  await workloadQueue.stop();
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
  const droppedCount = workloadQueue.clear(chatId);
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
    getActiveTaskStatus: chatId => workloadQueue.getActiveTaskStatus(chatId),
  });
}

async function handleControlMessage(task: ParsedMessageTask): Promise<boolean> {
  const { text } = task;
  const chatId = task.data.message.chat_id;
  const hasActiveMenuSelection = /^\d$/.test(text) && menuContext.get(chatId) !== null;

  if (text === '/stop') {
    await handleImmediateStop(chatId);
    return true;
  }

  if (text === '/new') {
    await handleImmediateReset(chatId);
    return true;
  }

  if (text === '/stat') {
    await handleImmediateStatus(task);
    return true;
  }

  if (!text.startsWith('/') && !hasActiveMenuSelection) {
    return false;
  }

  const handled = await handleMessageCommand({
    text,
    messageType: task.messageType,
    message: task.data.message,
  }, {
    getActiveTaskStatus: chatId => workloadQueue.getActiveTaskStatus(chatId),
  });

  return handled.kind === 'command';
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

async function handleQueuedWorkload(
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
    getActiveTaskStatus: chatId => workloadQueue.getActiveTaskStatus(chatId),
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
