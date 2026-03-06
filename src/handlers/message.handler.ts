import { existsSync, statSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import logger from '../utils/logger';
import { SessionManager } from '../claude/session-manager';
import messageService from '../services/message.service';
import config, { MODEL_MAP } from '../config';

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

      // 关闭流式卡片
      await sessionManager?.closeStreamingCard(message.chat_id);

      // 发送超时提示
      await messageService.sendTextMessage(
        message.chat_id,
        `⚠️ 消息处理超时（${Math.round(timeout / 1000)}秒），已终止处理。请重试或使用 /new 重置会话。`
      ).catch(err => {
        logger.error('Failed to send timeout notification', { error: err });
      });

      // 根据配置决定是否终止会话
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
      '/resume — 列出可恢复的历史会话',
      '/resume <序号> — 恢复指定的历史会话',
      '/status — 查看当前会话状态和工作目录',
      '/cd — 列出所有已记录的工作目录',
      '/cd <路径> — 切换工作目录（绝对路径或相对路径）',
      '/model opus — 切换到 Opus 4.6 模型',
      '/model sonnet — 切换到 Sonnet 4.6 模型',
    ].join('\n');
    await messageService.sendTextMessage(chatId, helpText);
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
    const cwds = sessionManager?.listCwds(chatId) ?? [];
    if (cwds.length === 0) {
      await messageService.sendTextMessage(chatId, `当前没有已记录的工作目录。\n用法: /cd <路径>`);
    } else {
      const currentCwd = sessionManager?.getCwd(chatId);
      const list = cwds.map(c => c === currentCwd ? `👉 ${c}` : `   ${c}`).join('\n');
      await messageService.sendTextMessage(chatId, `已记录的工作目录:\n${list}\n\n用 /cd <路径> 切换`);
    }
    return;
  }

  if (text.startsWith('/cd ')) {
    const input = text.slice(4).trim();
    if (!input) {
      await messageService.sendTextMessage(chatId, '用法: /cd <路径>');
      return;
    }
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

  if (text.startsWith('/model ')) {
    const modelKey = text.slice(7).trim().toLowerCase();
    if (!MODEL_MAP[modelKey]) {
      await messageService.sendTextMessage(
        chatId,
        `无效的模型，请使用:\n/model opus — 切换到 Opus 4.6\n/model sonnet — 切换到 Sonnet 4.6`
      );
      return;
    }

    const newModel = MODEL_MAP[modelKey];
    const oldModel = config.claude.model;

    if (newModel === oldModel) {
      await messageService.sendTextMessage(chatId, `当前已经是 ${modelKey.toUpperCase()} 模型`);
      return;
    }

    // 修改全局配置
    config.claude.model = newModel;
    logger.info('Model changed globally', { oldModel, newModel, requestedBy: chatId });

    // 重启所有活跃会话
    const affectedChats = await sessionManager?.restartAllSessions() ?? [];

    // 通知所有受影响的 chat
    for (const affectedChatId of affectedChats) {
      await messageService.sendTextMessage(
        affectedChatId,
        `🔄 模型已切换为 ${modelKey.toUpperCase()}，会话已重启`
      ).catch(err => {
        logger.error('Failed to notify chat about model change', { chatId: affectedChatId, error: err });
      });
    }

    return;
  }

  if (text === '/resume') {
    if (!sessionManager) {
      await messageService.sendTextMessage(chatId, 'Claude Code 服务未就绪，请稍后再试。');
      return;
    }
    const sessions = sessionManager.listResumableSessions(chatId);
    if (sessions.length === 0) {
      await messageService.sendTextMessage(chatId, '当前工作目录下没有可恢复的会话。');
      return;
    }
    const list = sessions.map((s, i) => {
      const date = new Date(s.timestamp);
      const ts = `${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
      return `${i + 1}. [${ts}] "${s.firstMessage}" (${s.sessionId.slice(0, 8)})`;
    }).join('\n');
    await messageService.sendTextMessage(chatId, `可恢复的会话:\n${list}\n\n用 /resume <序号> 恢复`);
    return;
  }

  if (text.startsWith('/resume ')) {
    const arg = text.slice(8).trim();
    if (!arg) {
      await messageService.sendTextMessage(chatId, '用法: /resume <序号>');
      return;
    }
    if (!sessionManager) {
      await messageService.sendTextMessage(chatId, 'Claude Code 服务未就绪，请稍后再试。');
      return;
    }
    const sessions = sessionManager.listResumableSessions(chatId);
    const index = parseInt(arg, 10);
    let targetSession: { sessionId: string } | undefined;
    if (!isNaN(index) && index >= 1 && index <= sessions.length) {
      targetSession = sessions[index - 1];
    } else {
      // 按 sessionId 前缀匹配
      targetSession = sessions.find(s => s.sessionId.startsWith(arg));
    }
    if (!targetSession) {
      await messageService.sendTextMessage(chatId, `未找到匹配的会话。用 /resume 查看可恢复列表。`);
      return;
    }
    const ok = await sessionManager.resumeSession(chatId, targetSession.sessionId);
    if (ok) {
      await messageService.sendTextMessage(chatId, `会话已恢复: ${targetSession.sessionId.slice(0, 8)}`);
    } else {
      await messageService.sendTextMessage(chatId, `会话恢复失败（可能已过期），请用 /new 开始新对话。`);
    }
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
  await sessionManager.sendMessage(chatId, text, async () => {
    if (reactionId) {
      await messageService.removeReaction(message.message_id, reactionId);
    }
  });

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
