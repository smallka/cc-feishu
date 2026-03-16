import { existsSync, statSync } from 'fs';
import { isAbsolute, resolve } from 'path';

import logger from '../utils/logger';
import { chatManager } from '../bot/chat-manager';
import menuContext, { renderMenu, type MenuAction, type MenuContext } from '../bot/menu-context';
import type { SessionSummary } from '../claude/session-scanner';
import messageService from '../services/message.service';
import config, { type AgentProvider } from '../config';

const processedMessages = new Set<string>();
const MAX_CACHE_SIZE = 500;
const queuedMessages = new Map<string, QueuedMessageTask[]>();
const activeProcessors = new Map<string, Promise<void>>();
let acceptingMessages = true;
const MESSAGE_TIMEOUT_MS = 300000;
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
  };
}

interface QueuedMessageTask {
  data: MessageEvent;
  text: string;
  enqueuedAt: number;
}

function resolveWorkPath(input: string): string | null {
  const target = isAbsolute(input) ? input : resolve(config.claude.workRoot, input);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return null;
  }
  return target;
}

function getHelpText(chatId: string): string {
  const lines = [
    '可用命令:',
    '/help - 显示帮助',
    '/new - 重置会话',
    '/stop - 打断当前任务',
    '/stat - 查看会话状态',
    '/agent - 选择 agent（支持数字选择）',
    '/cd <路径> - 切换工作目录，/cd . 回到根目录',
    '/debug - 查看调试信息',
  ];

  if (chatManager.supportsSessionResume(chatId)) {
    lines.push('/resume - 列出可恢复的 sessions（支持数字选择）');
    lines.push('/resume <编号|session_id> - 恢复指定 session');
  } else {
    lines.push('/resume - 当前 agent 暂不支持');
  }

  return lines.join('\n');
}

function formatDuration(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  if (wholeSeconds < 60) {
    return `${wholeSeconds}秒`;
  }
  if (wholeSeconds < 3600) {
    const minutes = Math.floor(wholeSeconds / 60);
    const secs = wholeSeconds % 60;
    return `${minutes}分${secs}秒`;
  }
  if (wholeSeconds < 86400) {
    const hours = Math.floor(wholeSeconds / 3600);
    const minutes = Math.floor((wholeSeconds % 3600) / 60);
    return `${hours}小时${minutes}分`;
  }
  const days = Math.floor(wholeSeconds / 86400);
  const hours = Math.floor((wholeSeconds % 86400) / 3600);
  return `${days}天${hours}小时`;
}

function formatSessionMenuLabel(session: SessionSummary, currentCwd: string): string {
  const shortId = session.sessionId.length > 8 ? `${session.sessionId.slice(0, 8)}...` : session.sessionId;
  const age = formatDuration((Date.now() - session.mtimeMs) / 1000);
  const summary = session.firstMessage || '无摘要';
  const cwdSuffix = session.cwd === currentCwd ? '' : ` · ${session.cwd}`;
  return `\`${shortId}\`  ${age}前${cwdSuffix}\n摘要 ${summary}`;
}

function buildResumeMenu(chatId: string): MenuContext | null {
  const sessions = chatManager.getRecentSessions(chatId, 9);
  if (sessions.length === 0) {
    return null;
  }

  const currentCwd = chatManager.getCurrentCwd(chatId);
  const total = chatManager.getSessionCount(chatId);
  const descriptionLines = [`工作目录: \`${currentCwd}\``];
  if (total > sessions.length) {
    descriptionLines.push(`仅显示最近 ${sessions.length} 个会话；更多会话请使用 /resume <session_id>。`);
  }

  return {
    kind: 'resume',
    title: `恢复会话（最近 ${sessions.length} 条）`,
    description: descriptionLines.join('\n'),
    items: sessions.map((session, index) => ({
      index: index + 1,
      label: formatSessionMenuLabel(session, currentCwd),
      action: { type: 'resume_session', sessionId: session.sessionId, cwd: session.cwd },
    })),
    expiresAt: Date.now(),
  };
}

function buildAgentMenu(chatId: string): MenuContext {
  const currentProvider = chatManager.getProvider(chatId);
  const currentLabel = currentProvider === 'claude'
    ? `当前 agent: Claude（模型: ${config.claude.model}）`
    : '当前 agent: Codex';

  return {
    kind: 'agent',
    title: '选择 Agent',
    description: currentLabel,
    items: [
      {
        index: 1,
        label: `Claude${currentProvider === 'claude' ? '（当前）' : `（模型: ${config.claude.model}）`}`,
        action: { type: 'switch_provider', provider: 'claude' },
      },
      {
        index: 2,
        label: `Codex${currentProvider === 'codex' ? '（当前）' : ''}`,
        action: { type: 'switch_provider', provider: 'codex' },
      },
    ],
    expiresAt: Date.now(),
  };
}

function formatProviderSwitchMessage(provider: AgentProvider, result: { changed: boolean; cwd: string }, resumeSupported: boolean): string {
  const lines = result.changed
    ? [
      `已切换 agent: ${provider}`,
      `工作目录: ${result.cwd}`,
      '当前会话已重置。',
    ]
    : [
      `当前已是 agent: ${provider}`,
      `工作目录: ${result.cwd}`,
    ];

  if (provider === 'claude') {
    lines.splice(1, 0, `模型: ${config.claude.model}`);
  }

  if (!resumeSupported) {
    lines.push('该 agent 暂不支持 /resume。');
  }

  return lines.join('\n');
}

async function executeMenuAction(chatId: string, action: MenuAction): Promise<void> {
  if (action.type === 'resume_session') {
    await chatManager.switchCwd(chatId, action.cwd);
    const result = await chatManager.resumeSession(chatId, action.sessionId);
    await messageService.sendTextMessage(chatId, result);
    return;
  }

  const result = await chatManager.switchProvider(chatId, action.provider);
  await messageService.sendTextMessage(
    chatId,
    formatProviderSwitchMessage(action.provider, result, chatManager.supportsSessionResume(chatId)),
  );
}

async function handleMenuSelection(chatId: string, text: string): Promise<boolean> {
  const resolved = menuContext.resolve(chatId, text);
  if (!resolved) {
    return false;
  }

  switch (resolved.kind) {
    case 'selected':
      await executeMenuAction(chatId, resolved.action);
      return true;
    case 'cancelled':
      await messageService.sendTextMessage(chatId, '已取消当前选择。');
      return true;
    case 'expired':
      await messageService.sendTextMessage(chatId, '上一个菜单已过期，请重新输入命令。');
      return true;
    case 'invalid': {
      const validChoices = resolved.validChoices.join('、');
      await messageService.sendTextMessage(chatId, `无效编号，请回复 ${validChoices} 或 0。`);
      return true;
    }
    default:
      return false;
  }
}

async function sendMenu(chatId: string, context: Omit<MenuContext, 'expiresAt'>): Promise<void> {
  const activeMenu = menuContext.set(chatId, context);
  await messageService.sendCardMessage(chatId, renderMenu(activeMenu));
}

export function handleMessage(data: MessageEvent): Promise<void> {
  const { message, sender } = data;
  const chatId = message.chat_id;

  if (!acceptingMessages) {
    logger.warn('Dropping incoming message because handler is stopping', {
      messageId: message.message_id,
      chatId,
    });
    return Promise.resolve();
  }

  if (processedMessages.has(message.message_id)) {
    logger.debug('Skipping duplicate message', { messageId: message.message_id });
    return Promise.resolve();
  }

  if (message.message_type !== 'text') {
    logger.debug('Skipping non-text message', {
      messageId: message.message_id,
      chatId,
      messageType: message.message_type,
    });
    return Promise.resolve();
  }

  let content: { text?: string };
  try {
    content = JSON.parse(message.content) as { text?: string };
  } catch (error) {
    logger.error('Failed to parse message content', {
      messageId: message.message_id,
      chatId,
      error,
    });
    return Promise.resolve();
  }

  const text = (content.text || '').trim();
  if (!text) {
    logger.debug('Skipping empty text message', {
      messageId: message.message_id,
      chatId,
    });
    return Promise.resolve();
  }

  rememberProcessedMessage(message.message_id);

  if (text === '/stop') {
    return handleImmediateStop(chatId);
  }

  if (text === '/new') {
    return handleImmediateReset(chatId);
  }

  const task: QueuedMessageTask = {
    data,
    text,
    enqueuedAt: Date.now(),
  };

  enqueueTask(task);

  logger.info('Queued incoming message', {
    messageId: message.message_id,
    chatId,
    senderId: sender.sender_id.open_id,
    provider: chatManager.getProvider(),
    textLength: text.length,
    queueDepth: getChatQueueLength(chatId),
  });

  return Promise.resolve();
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
  const cwd = await chatManager.reset(chatId);
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

async function processQueuedMessage(task: QueuedMessageTask): Promise<void> {
  const { data } = task;
  const { sender, message } = data;
  const startTime = Date.now();
  const timeout = MESSAGE_TIMEOUT_MS;
  const queueDelay = startTime - task.enqueuedAt;

  logger.info('Processing queued message', {
    messageId: message.message_id,
    chatId: message.chat_id,
    senderId: sender.sender_id.open_id,
    provider: chatManager.getProvider(),
    queueDelay,
    remainingQueueDepth: getChatQueueLength(message.chat_id),
  });

  const processingPromise = handleMessageInternal(task, startTime);
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race<'completed' | 'timeout'>([
      processingPromise.then(() => 'completed' as const),
      new Promise<'timeout'>((resolve) => {
        timeoutTimer = setTimeout(() => resolve('timeout'), timeout);
      }),
    ]);

    if (result === 'completed') {
      return;
    }

    const duration = Date.now() - startTime;
    logger.error('Message processing timeout', {
      messageId: message.message_id,
      chatId: message.chat_id,
      duration,
      timeout,
    });

    if (MESSAGE_TIMEOUT_ACTION === 'kill') {
      await messageService.sendTextMessage(
        message.chat_id,
        `消息处理超时（${Math.round(timeout / 1000)}秒），已终止当前任务。请重试或使用 /new 重置会话。`,
      ).catch(error => {
        logger.error('Failed to send timeout notification', { error });
      });

      logger.info('Terminating session due to timeout', { chatId: message.chat_id });
      await chatManager.interrupt(message.chat_id).catch(() => 'error');
      await chatManager.reset(message.chat_id);
    } else {
      await messageService.sendTextMessage(
        message.chat_id,
        `消息处理超时（${Math.round(timeout / 1000)}秒），当前任务仍在收尾，后续消息会继续排队。`,
      ).catch(error => {
        logger.error('Failed to send timeout notification', { error });
      });
    }

    await processingPromise.catch(error => {
      logger.warn('Queued message finished after timeout', {
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
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
    }
  }
}

async function handleMessageInternal(task: QueuedMessageTask, startTime: number): Promise<void> {
  const { data, text } = task;
  const { message } = data;
  const chatId = message.chat_id;
  const timeout = MESSAGE_TIMEOUT_MS;

  logger.info('Received chat text', {
    messageId: message.message_id,
    chatId,
    provider: chatManager.getProvider(chatId),
    text,
    textLength: text.length,
  });

  if (text.startsWith('/')) {
    menuContext.clear(chatId);
  }

  if (text === '/help') {
    await messageService.sendTextMessage(chatId, getHelpText(chatId));
    return;
  }

  if (text === '/stat') {
    const info = chatManager.getSessionInfo(chatId);
    await messageService.sendTextMessage(chatId, info);
    return;
  }

  if (text === '/agent') {
    await sendMenu(chatId, buildAgentMenu(chatId));
    return;
  }

  if (text === '/debug') {
    const info = chatManager.getDebugInfo();
    await messageService.sendCardMessage(chatId, info);
    return;
  }

  if (text === '/cd') {
    await messageService.sendTextMessage(chatId, '用法: /cd <路径>\n使用 /cd . 切换到根目录');
    return;
  }

  if (text.startsWith('/cd ')) {
    const input = text.slice(4).trim();
    const target = input === '.' ? config.claude.workRoot : resolveWorkPath(input);
    if (!target) {
      await messageService.sendTextMessage(chatId, `目录不存在: ${input}`);
      return;
    }

    await chatManager.switchCwd(chatId, target);
    if (chatManager.supportsSessionResume(chatId)) {
      await messageService.sendCardMessage(chatId, chatManager.listSessions(chatId));
    } else {
      await messageService.sendTextMessage(chatId, `已切换工作目录: ${target}`);
    }
    return;
  }

  if (text === '/resume') {
    if (!chatManager.supportsSessionResume(chatId)) {
      await messageService.sendTextMessage(chatId, chatManager.listSessions(chatId));
      return;
    }

    const menu = buildResumeMenu(chatId);
    if (!menu) {
      await messageService.sendCardMessage(chatId, chatManager.listSessions(chatId));
      return;
    }

    await sendMenu(chatId, menu);
    return;
  }

  if (text.startsWith('/resume ')) {
    if (!chatManager.supportsSessionResume(chatId)) {
      await messageService.sendTextMessage(chatId, chatManager.listSessions(chatId));
      return;
    }

    const input = text.slice(8).trim();
    if (!input) {
      await messageService.sendCardMessage(chatId, chatManager.listSessions(chatId));
      return;
    }

    if (/^\d+$/.test(input)) {
      const index = Number(input);
      if (index < 1) {
        await messageService.sendTextMessage(chatId, '编号必须大于 0。');
        return;
      }

      const target = chatManager.resolveResumeTarget(chatId, index);
      if (!target) {
        const total = chatManager.getSessionCount(chatId);
        await messageService.sendTextMessage(
          chatId,
          `编号超出范围（共 ${total} 个 session）。\n使用 /resume 查看可用的 sessions。`,
        );
        return;
      }

      await chatManager.switchCwd(chatId, target.cwd);
      const result = await chatManager.resumeSession(chatId, target.sessionId);
      await messageService.sendTextMessage(chatId, result);
      return;
    }

    const result = await chatManager.resumeSession(chatId, input);
    await messageService.sendTextMessage(chatId, result);
    return;
  }

  if (await handleMenuSelection(chatId, text)) {
    return;
  }

  if (text.startsWith('/')) {
    await messageService.sendTextMessage(chatId, `未知命令: ${text.split(' ')[0]}\n输入 /help 查看可用命令。`);
    return;
  }

  menuContext.clear(chatId);

  const reactionId = await messageService.addReaction(message.message_id, 'Typing');
  try {
    await chatManager.sendMessage(chatId, text);
  } finally {
    if (reactionId) {
      await messageService.removeReaction(message.message_id, reactionId).catch(error => {
        logger.error('Failed to remove reaction', {
          messageId: message.message_id,
          chatId,
          error,
        });
      });
    }
  }

  const duration = Date.now() - startTime;
  if (duration > timeout * 0.5) {
    logger.warn('Message processing took long time', {
      messageId: message.message_id,
      chatId,
      duration,
      threshold: timeout * 0.5,
    });
  }
}
