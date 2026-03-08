/**
 * ChatManager - 负责维护每个 chatId 对应的数据
 *
 * 职责：
 * - 存储每个飞书会话的工作目录和 Claude session ID
 * - 提供会话数据的查询、更新和清理接口
 */

import config from '../config';

interface ChatData {
  cwd: string;
  sessionId: string | undefined;
}

export class ChatManager {
  private store: Map<string, ChatData> = new Map();
  private defaultCwd: string;

  constructor() {
    this.defaultCwd = config.claude.workRoot;
  }

  /**
   * 获取指定 chat 的工作目录
   * 如果未设置，返回默认工作目录
   */
  getCwd(chatId: string): string {
    return this.store.get(chatId)?.cwd ?? this.defaultCwd;
  }

  /**
   * 获取指定 chat 的 session ID
   * 如果未设置，返回 undefined
   */
  getSessionId(chatId: string): string | undefined {
    return this.store.get(chatId)?.sessionId;
  }

  /**
   * 设置指定 chat 的完整会话信息
   */
  setSession(chatId: string, cwd: string, sessionId: string): void {
    this.store.set(chatId, { cwd, sessionId });
  }

  /**
   * 清除指定 chat 的会话信息
   */
  clearSession(chatId: string): void {
    this.store.delete(chatId);
  }
}

// 导出单例实例
export const chatManager = new ChatManager();
