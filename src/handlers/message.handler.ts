import { existsSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import logger from '../utils/logger';
import { chatManager } from '../bot/chat-manager';
import messageService from '../services/message.service';
import config from '../config';

// 消息去重：缓存已处理的 message_id
const processedMessages = new Set<string>();
const MAX_CACHE_SIZE = 500;

// 表情队列：按顺序存储待移除的表情
const reactionQueue: Array<{ messageId: string; reactionId: string }> = [];

// 注册响应完成回调，按顺序移除表情
chatManager.onResponseComplete(() => {
  const reaction = reactionQueue.shift();
  if (reaction) {
    messageService.removeReaction(reaction.messageId, reaction.reactionId).catch(() => {});
  }
});

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
        await chatManager.reset(message.chat_id);
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
      '/help — 显示帮助',
      '/new — 重置会话',
      '/stop — 打断任务',
      '/stat — 会话状态',
      '/cd [路径] — 切换目录',
      '/approve <requestId> — 批准权限',
      '/deny <requestId> — 拒绝权限',
      '/debug — 系统调试信息',
    ].join('\n');
    await messageService.sendTextMessage(chatId, helpText);
    return;
  }

  if (text === '/stop') {
    const result = chatManager.interrupt(chatId);
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
    const cwd = await chatManager.reset(chatId);
    await messageService.sendTextMessage(chatId, `会话已重置，可以开始新的对话。\n工作目录: ${cwd}`);
    return;
  }

  if (text === '/stat') {
    const info = chatManager.getSessionInfo(chatId);
    await messageService.sendTextMessage(chatId, info);
    return;
  }

  if (text === '/debug') {
    const info = chatManager.getDebugInfo();
    await messageService.sendCardMessage(chatId, info);
    return;
  }

  if (text === '/cd') {
    const defaultCwd = config.claude.workRoot;
    await chatManager.switchCwd(chatId, defaultCwd);
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
    await chatManager.switchCwd(chatId, target);
    await messageService.sendTextMessage(chatId, `工作目录已切换到: ${target}`);
    return;
  }

  if (text.startsWith('/approve ')) {
    const requestId = text.slice(9).trim();
    if (!requestId) {
      await messageService.sendTextMessage(chatId, '用法: /approve <requestId>');
      return;
    }
    const resolved = await chatManager.approvePermission(chatId, requestId);
    if (resolved) {
      await messageService.sendTextMessage(chatId, '✅ 已批准');
    } else {
      await messageService.sendTextMessage(chatId, '❌ 请求不存在或已过期');
    }
    return;
  }

  if (text.startsWith('/deny ')) {
    const requestId = text.slice(6).trim();
    if (!requestId) {
      await messageService.sendTextMessage(chatId, '用法: /deny <requestId>');
      return;
    }
    const resolved = await chatManager.denyPermission(chatId, requestId, '用户拒绝');
    if (resolved) {
      await messageService.sendTextMessage(chatId, '🚫 已拒绝');
    } else {
      await messageService.sendTextMessage(chatId, '❌ 请求不存在或已过期');
    }
    return;
  }

  // 未知命令拦截
  if (text.startsWith('/')) {
    await messageService.sendTextMessage(chatId, `未知命令: ${text.split(' ')[0]}\n输入 /help 查看可用命令。`);
    return;
  }

  // 转发给 Claude Code
  const reactionId = await messageService.addReaction(message.message_id, 'Typing');
  if (reactionId) {
    reactionQueue.push({ messageId: message.message_id, reactionId });
  }

  await chatManager.sendMessage(chatId, text);

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
