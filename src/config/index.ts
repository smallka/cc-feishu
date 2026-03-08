import dotenv from 'dotenv';

dotenv.config();

interface Config {
  feishu: {
    appId: string;
    appSecret: string;
  };
  claude: {
    workRoot: string;
    model: string; // 运行时可变
    messageTimeout: number;
    messageTimeoutAction: 'notify' | 'kill';
  };
  streaming: {
    enabled: boolean;
    throttleMs: number;
  };
  app: {
    env: string;
    logLevel: string;
  };
}

// 模型映射表
export const MODEL_MAP: Record<string, string> = {
  'opus': 'claude-opus-4-6',
  'sonnet': 'claude-sonnet-4-6',
};

const config: Config = {
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
  },
  claude: {
    workRoot: process.env.CLAUDE_WORK_ROOT || process.cwd(),
    model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
    messageTimeout: parseInt(process.env.MESSAGE_TIMEOUT || '300000', 10),
    messageTimeoutAction: (process.env.MESSAGE_TIMEOUT_ACTION || 'notify') as 'notify' | 'kill',
  },
  streaming: {
    enabled: process.env.STREAMING_ENABLED !== 'false',
    throttleMs: parseInt(process.env.STREAMING_THROTTLE_MS || '150', 10),
  },
  app: {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};

// 验证必需配置
if (!config.feishu.appId || !config.feishu.appSecret) {
  throw new Error('Missing required Feishu credentials: FEISHU_APP_ID and FEISHU_APP_SECRET');
}

export default config;
