import { existsSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import logger from '../utils/logger';
import { SessionManager } from '../claude/session-manager';
import messageService from '../services/message.service';
import config from '../config';

let sessionManager: SessionManager | null = null;

// 消息去重：缓存已处理的 message_id
const processedMessages = new Set<string>();
const MAX_CACHE_SIZE = 500;

export function setSessionManager(sm: SessionManager) {
  sessionManager = sm;
}

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

function resolveWorkPath(input: string): string | null {
  const target = isAbsolute(input)
    ? input
    : resolve(config.claude.workRoot, input);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return null;
  }
  return target;
}

export async function handleMessage(data: MessageEvent): Promise<void> {
  const startTime = Date.now();
  const { sender, message } = data;

  // 消息去重
  if (processedMessages.has(message.message_id)) {
    logger.debug('Skipping duplicate message', { messageId: message.message_id });
    return;
  }
  processedMessages.add(message.message_id);
  if (processedMessages.size > MAX_CACHE_SIZE) {
    const first = processedMessages.values().next().value;
    if (first) processedMessages.delete(first);
  }

  logger.info('Processing message', {
    messageId: message.message_id,
    chatId: message.chat_id,
    senderId: sender.sender_id.open_id,
  });

  // 包装超时保护
  const timeout = config.claude.messageTimeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error('Message processing timeout'));
    }, timeout);
  });

  try {
    await Promise.race([
      handleMessageInternal(data, startTime),
      timeoutPromise,
    ]);
  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof Error && error.message === 'Message processing timeout') {
      logger.error('Message processing timeout', {
        messageId: message.message_id,
        chatId: message.chat_id,
        duration,
        timeout,
      });

      await messageService.sendTextMessage(
        message.chat_id,
        `⚠️ 消息处理超时（${Math.round(timeout / 1000)}秒），已终止处理。请重试或使用 /new 重置会话。`
      ).catch(err => {
        logger.error('Failed to send timeout notification', { error: err });
      });

      if (config.claude.messageTimeoutAction === 'kill') {
        logger.info('Terminating session due to timeout', { chatId: message.chat_id });
        await sessionManager?.resetSession(message.chat_id);
      }
    } else {
      logger.error('Error handling message event', { error, duration });
    }
  }
}

async function handleMessageInternal(data: MessageEvent, startTime: number): Promise<void> {
  const { message } = data;

  if (message.message_type !== 'text') return;

  let content: any;
  try {
    content = JSON.parse(message.content);
  } catch (error) {
    logger.error('Failed to parse message content', { error });
    return;
  }

  const text = (content.text || '').trim();
  if (!text) return;

  const chatId = message.chat_id;

  // 命令处理
  if (text === '/help') {
    const helpText = [
      '可用命令:',
      '/help — 显示本帮助信息',
      '/new — 重置当前会话，开始新对话',
      '/stop — 打断 AI 当前任务（不销毁会话）',
      '/status — 查看当前会话状态和工作目录',
      '/cd — 列出所有已记录的工作目录',
      '/cd <路径> — 切换工作目录（绝对路径或相对路径）',
    ].join('\n');
    await messageService.sendTextMessage(chatId, helpText);
    return;
  }

  if (text === '/stop') {
    if (!sessionManager) {
      await messageService.sendTextMessage(chatId, 'Claude Code 服务未就绪。');
      return;
    }
    const result = sessionManager.interruptSession(chatId);
    if (result === 'success') {
      await messageService.sendTextMessage(chatId, '⏸️ 已发送打断指令，AI 将停止当前任务');
    } else if (result === 'no_session') {
      await messageService.sendTextMessage(chatId, '❌ 当前没有活跃的会话');
    } else {
      await messageService.sendTextMessage(chatId, '⚠️ AI 当前未在执行任务，无需打断\n\n提示：只有在 AI 正在思考或执行工具时才能打断');
    }
    return;
  }

  if (text === '/new') {
    await sessionManager?.resetSession(chatId);
    const cwd = sessionManager?.getCwd(chatId) ?? config.claude.workRoot;
    await messageService.sendTextMessage(chatId, `会话已重置，可以开始新的对话。\n工作目录: ${cwd}`);
    return;
  }

  if (text === '/status') {
    const info = sessionManager?.getSessionInfo(chatId) || '未初始化';
    await messageService.sendTextMessage(chatId, info);
    return;
  }

  if (text === '/cd') {
    const defaultCwd = config.claude.workRoot;
    if (!sessionManager) {
      await messageService.sendTextMessage(chatId, 'Claude Code 服务未就绪，请稍后再试。');
      return;
    }
    await sessionManager.switchCwd(chatId, defaultCwd);
    await messageService.sendTextMessage(chatId, `已切换到默认工作目录:\n${defaultCwd}`);
    return;
  }

  if (text.startsWith('/cd ')) {
    const input = text.slice(4).trim();

    const target = resolveWorkPath(input);
    if (!target) {
      await messageService.sendTextMessage(chatId, `目录不存在: ${input}`);
      return;
    }
    if (!sessionManager) {
      await messageService.sendTextMessage(chatId, 'Claude Code 服务未就绪，请稍后再试。');
      return;
    }
    await sessionManager.switchCwd(chatId, target);
    await messageService.sendTextMessage(chatId, `工作目录已切换到: ${target}`);
    return;
  }

  // 未知命令拦截
  if (text.startsWith('/')) {
    await messageService.sendTextMessage(chatId, `未知命令: ${text.split(' ')[0]}\n输入 /help 查看可用命令。`);
    return;
  }

  if (!sessionManager) {
    await messageService.sendTextMessage(chatId, 'Claude Code 服务未就绪，请稍后再试。');
    return;
  }

  // 转发给 Claude Code
  const reactionId = await messageService.addReaction(message.message_id, 'Typing');
  try {
    await sessionManager.sendMessage(chatId, text);
  } finally {
    if (reactionId) {
      await messageService.removeReaction(message.message_id, reactionId);
    }
  }

  // 记录处理时长
  const duration = Date.now() - startTime;
  const timeout = config.claude.messageTimeout;
  if (duration > timeout * 0.5) {
    logger.warn('Message processing took long time', {
      messageId: message.message_id,
      chatId,
      duration,
      threshold: timeout * 0.5,
    });
  }
}
