import { existsSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';

import logger from '../utils/logger';
import { chatManager } from '../bot/chat-manager';
import messageService from '../services/message.service';
import config from '../config';

const processedMessages = new Set<string>();
const MAX_CACHE_SIZE = 500;
const reactionQueue: Array<{ messageId: string; reactionId: string }> = [];

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
  const target = isAbsolute(input) ? input : resolve(config.claude.workRoot, input);
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    return null;
  }
  return target;
}

export async function handleMessage(data: MessageEvent): Promise<void> {
  const startTime = Date.now();
  const { sender, message } = data;

  if (processedMessages.has(message.message_id)) {
    logger.debug('Skipping duplicate message', { messageId: message.message_id });
    return;
  }
  processedMessages.add(message.message_id);
  if (processedMessages.size > MAX_CACHE_SIZE) {
    const first = processedMessages.values().next().value;
    if (first) {
      processedMessages.delete(first);
    }
  }

  logger.info('Processing message', {
    messageId: message.message_id,
    chatId: message.chat_id,
    senderId: sender.sender_id.open_id,
  });

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
        `消息处理超时（${Math.round(timeout / 1000)}秒），已终止处理。请重试或使用 /new 重置会话。`,
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
  const timeout = config.claude.messageTimeout;

  if (message.message_type !== 'text') {
    return;
  }

  let content: any;
  try {
    content = JSON.parse(message.content);
  } catch (error) {
    logger.error('Failed to parse message content', { error });
    return;
  }

  const text = (content.text || '').trim();
  if (!text) {
    return;
  }

  const chatId = message.chat_id;

  if (text === '/help') {
    const helpText = [
      '可用命令:',
      '/help — 显示帮助',
      '/new — 重置会话',
      '/stop — 打断任务',
      '/stat — 会话状态',
      '/cd <路径> — 切换目录（/cd . 切换到根目录）',
      '/resume — 列出 sessions',
      '/resume <编号|session_id> — 恢复 session',
      '/debug — 系统调试信息',
    ].join('\n');
    await messageService.sendTextMessage(chatId, helpText);
    return;
  }

  if (text === '/stop') {
    const result = await chatManager.interrupt(chatId);

    if (result === 'success') {
      await messageService.sendTextMessage(chatId, '⏸️ 已发送中断信号，AI 将停止当前任务');
    } else if (result === 'timeout') {
      await messageService.sendTextMessage(chatId, '⚠️ 中断信号发送超时，请使用 /new 强制重置会话');
    } else if (result === 'no_session') {
      await messageService.sendTextMessage(chatId, '❌ 当前没有活跃的会话');
    } else {
      await messageService.sendTextMessage(chatId, '⚠️ 中断失败，请使用 /new 强制重置会话');
    }
    return;
  }

  if (text === '/new') {
    const cwd = await chatManager.reset(chatId);
    await messageService.sendTextMessage(chatId, `✅ 会话已重置，可以开始新的对话\n工作目录: ${cwd}`);
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
    await messageService.sendCardMessage(chatId, chatManager.listSessions(chatId));
    return;
  }

  if (text === '/resume') {
    await messageService.sendCardMessage(chatId, chatManager.listSessions(chatId));
    return;
  }

  if (text.startsWith('/resume ')) {
    const input = text.slice(8).trim();
    if (!input) {
      await messageService.sendCardMessage(chatId, chatManager.listSessions(chatId));
      return;
    }

    if (/^\d+$/.test(input)) {
      const index = Number(input);
      if (index < 1) {
        await messageService.sendTextMessage(chatId, '❌ 编号必须大于 0');
        return;
      }

      const target = chatManager.resolveResumeTarget(chatId, index);
      if (!target) {
        const total = chatManager.getSessionCount(chatId);
        await messageService.sendTextMessage(chatId, `❌ 编号超出范围（共 ${total} 个 session）\n使用 /resume 查看可用的 sessions`);
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

  if (text.startsWith('/')) {
    await messageService.sendTextMessage(chatId, `未知命令: ${text.split(' ')[0]}\n输入 /help 查看可用命令。`);
    return;
  }

  const reactionId = await messageService.addReaction(message.message_id, 'Typing');
  if (reactionId) {
    reactionQueue.push({ messageId: message.message_id, reactionId });
  }

  await chatManager.sendMessage(chatId, text);

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