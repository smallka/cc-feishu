export type OnResponseCallback = (text: string) => void;
export type OnErrorCallback = (error: Error) => void;

export interface ChatAgent {
  sendMessage(text: string): Promise<void>;
  interrupt(): boolean;
  destroy(error?: Error): Promise<void>;
  getAgentId(): string;
  getCwd(): string;
  getSessionId(): string | undefined;
  isInitialized(): boolean;
  isAlive(): boolean;
  onResponse(callback: OnResponseCallback): void;
  onError(callback: OnErrorCallback): void;
  getStartTime(): number;
}
