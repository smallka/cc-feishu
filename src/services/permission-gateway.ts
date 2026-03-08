import logger from '../utils/logger';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, any>;
}

export interface PermissionResult {
  behavior: 'allow' | 'deny';
  message?: string;
}

/**
 * 管理待处理的权限请求
 * 复用自 Claude-to-IM-skill
 */
export class PendingPermissions {
  private pending = new Map<
    string,
    {
      resolve: (result: PermissionResult) => void;
      timer: NodeJS.Timeout;
    }
  >();

  /**
   * 等待用户响应（带超时）
   */
  waitFor(requestId: string, timeoutMs = 5 * 60 * 1000): Promise<PermissionResult> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.warn('[PendingPermissions] Request timeout', { requestId });
        this.pending.delete(requestId);
        resolve({ behavior: 'deny', message: '权限请求超时（5 分钟）' });
      }, timeoutMs);

      this.pending.set(requestId, { resolve, timer });
    });
  }

  /**
   * 解析权限请求（用户批准/拒绝）
   */
  resolve(requestId: string, result: PermissionResult): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) {
      logger.warn('[PendingPermissions] Unknown request', { requestId });
      return false;
    }

    clearTimeout(entry.timer);
    entry.resolve(result);
    this.pending.delete(requestId);
    return true;
  }

  /**
   * 检查是否有待处理请求
   */
  hasPending(requestId: string): boolean {
    return this.pending.has(requestId);
  }

  /**
   * 清理所有待处理请求
   */
  clear() {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ behavior: 'deny', message: '会话已重置' });
    }
    this.pending.clear();
  }
}
