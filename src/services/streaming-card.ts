import feishuClient from '../bot/client';
import config from '../config';
import logger from '../utils/logger';

const ELEMENT_ID = 'streaming_content';
const MAX_CARD_CONTENT_LEN = 30000; // 飞书卡片 markdown 元素内容长度上限（保守值）
const TRUNCATION_SUFFIX = '\n\n---\n*（内容过长，已截断）*';

export class StreamingCard {
  private cardId: string | null = null;
  private sequence = 0;
  private closed = false;
  private closing = false; // 防止重复关闭
  private chatId: string;
  private startPromise: Promise<boolean> | null = null;

  // 节流状态
  private pendingText: string | null = null;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastUpdateTime = 0;
  private updatePromise: Promise<void> = Promise.resolve();

  constructor(chatId: string) {
    this.chatId = chatId;
  }

  /** 创建卡片实体并发送到聊天，失败返回 false */
  async start(): Promise<boolean> {
    this.startPromise = this.doStart();
    return this.startPromise;
  }

  private async doStart(): Promise<boolean> {
    try {
      const client = feishuClient.getClient();

      const cardJson = {
        schema: '2.0',
        config: {
          streaming_mode: true,
          summary: { content: '[生成中...]' },
          streaming_config: {
            print_frequency_ms: { default: 50 },
            print_step: { default: 2 },
            print_strategy: 'fast',
          },
        },
        body: {
          elements: [
            {
              tag: 'markdown',
              content: '思考中...',
              element_id: ELEMENT_ID,
            },
          ],
        },
      };

      const createRes = await client.cardkit.v1.card.create({
        data: {
          type: 'card_json',
          data: JSON.stringify(cardJson),
        },
      });

      if (!createRes?.data?.card_id) {
        logger.error('Failed to create streaming card: no card_id', { chatId: this.chatId });
        return false;
      }

      this.cardId = createRes.data.card_id;

      // 发送卡片消息到聊天
      await client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: this.chatId,
          msg_type: 'interactive',
          content: JSON.stringify({ type: 'card', data: { card_id: this.cardId } }),
        },
      });

      logger.info('Streaming card started', { chatId: this.chatId, cardId: this.cardId });
      return true;
    } catch (err: any) {
      logger.error('Failed to start streaming card', { chatId: this.chatId, error: err.message });
      return false;
    }
  }

  /** 等待 start 完成（供外部在 close 前调用） */
  async waitForStart(): Promise<boolean> {
    if (!this.startPromise) return false;
    return this.startPromise.catch(() => false);
  }

  /** 更新卡片内容（节流） */
  update(fullText: string): void {
    if (this.closed || !this.cardId) return;

    this.pendingText = fullText;

    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;
    const throttleMs = config.streaming.throttleMs;

    if (elapsed >= throttleMs) {
      this.flushUpdate();
    } else if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        this.flushUpdate();
      }, throttleMs - elapsed);
    }
  }

  /** 发送最终文本并关闭流式模式 */
  async close(finalText: string): Promise<void> {
    if (this.closed || this.closing) {
      logger.debug('Streaming card already closed or closing', {
        chatId: this.chatId,
        cardId: this.cardId,
        closed: this.closed,
        closing: this.closing,
      });
      return;
    }
    this.closing = true;

    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }

    // 等待 start 完成（处理 onResponse 在 start 未完成时触发的竞态）
    if (this.startPromise) {
      await this.startPromise.catch(() => {});
    }

    if (!this.cardId) {
      logger.warn('Cannot close card: not started successfully', { chatId: this.chatId });
      this.closed = true;
      return;
    }

    await this.updatePromise;

    try {
      const client = feishuClient.getClient();

      this.sequence++;
      const displayText = this.truncate(finalText || '(无内容)');
      await client.cardkit.v1.cardElement.content({
        path: { card_id: this.cardId, element_id: ELEMENT_ID },
        data: {
          content: displayText,
          sequence: this.sequence,
        },
      });

      this.sequence++;
      const summary = finalText
        ? finalText.replace(/\n/g, ' ').trim().slice(0, 50)
        : '';
      await client.cardkit.v1.card.settings({
        path: { card_id: this.cardId },
        data: {
          settings: JSON.stringify({
            config: {
              streaming_mode: false,
              summary: { content: summary || '回复完成' },
            },
          }),
          sequence: this.sequence,
        },
      });

      logger.info('Streaming card closed', { chatId: this.chatId, cardId: this.cardId });
    } catch (err: any) {
      logger.error('Failed to close streaming card', {
        chatId: this.chatId,
        cardId: this.cardId,
        error: err.message
      });
    } finally {
      this.closed = true;
    }
  }

  isActive(): boolean {
    return !this.closed && this.cardId !== null;
  }

  private truncate(text: string): string {
    if (text.length <= MAX_CARD_CONTENT_LEN) return text;
    return text.slice(0, MAX_CARD_CONTENT_LEN - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
  }

  private flushUpdate(): void {
    const text = this.pendingText;
    if (!text || !this.cardId || this.closed) return;
    this.pendingText = null;

    this.sequence++;
    const seq = this.sequence;
    const cardId = this.cardId;

    this.updatePromise = this.updatePromise.then(async () => {
      try {
        const client = feishuClient.getClient();
        await client.cardkit.v1.cardElement.content({
          path: { card_id: cardId, element_id: ELEMENT_ID },
          data: { content: this.truncate(text), sequence: seq },
        });
        this.lastUpdateTime = Date.now();
      } catch (err: any) {
        logger.error('Streaming card update failed', { cardId, error: err.message });
      }
    });
  }
}