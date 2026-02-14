import logger from '../utils/logger';
import { SessionManager } from '../claude/session-manager';
import messageService from '../services/message.service';

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

export async function handleMessage(data: MessageEvent): Promise<void> {
  const { sender, message } = data;

  // 消息去重
  if (processedMessages.has(message.message_id)) {
    logger.debug('Skipping duplicate message', { messageId: message.message_id });
    return;
  }
  processedMessages.add(message.message_id);
  // 防止缓存无限增长
  if (processedMessages.size > MAX_CACHE_SIZE) {
    const first = processedMessages.values().next().value;
    if (first) processedMessages.delete(first);
  }

  logger.info('Processing message', {
    messageId: message.message_id,
    chatId: message.chat_id,
    senderId: sender.sender_id.open_id,
  });

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

  // 命令处理
  if (text === '/new' || text === '/reset') {
    await sessionManager?.resetSession(message.chat_id);
    await messageService.sendTextMessage(message.chat_id, '会话已重置，可以开始新的对话。');
    return;
  }

  if (text === '/status') {
    const info = sessionManager?.getSessionInfo(message.chat_id) || '未初始化';
    await messageService.sendTextMessage(message.chat_id, info);
    return;
  }

  if (!sessionManager) {
    await messageService.sendTextMessage(message.chat_id, 'Claude Code 服务未就绪，请稍后再试。');
    return;
  }

  // 转发给 Claude Code
  await sessionManager.sendMessage(message.chat_id, text);
}
