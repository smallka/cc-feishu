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

  if (!sessionManager) {
    await messageService.sendTextMessage(chatId, 'Claude Code 服务未就绪，请稍后再试。');
    return;
  }

  // 转发给 Claude Code
  await sessionManager.sendMessage(chatId, text);
}
