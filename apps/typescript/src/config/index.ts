import dotenv from 'dotenv';

dotenv.config();

export type AgentProvider = 'claude' | 'codex';

interface Config {
  feishu: {
    appId: string;
    appSecret: string;
  };
  agent: {
    provider: AgentProvider;
  };
  claude: {
    workRoot: string;
    model: string;
  };
  app: {
    env: string;
    logLevel: string;
    singleInstancePort: number;
  };
}

export const MODEL_MAP: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
};

function resolveAgentProvider(): AgentProvider {
  const rawValue = (process.env.AGENT_PROVIDER || 'claude').trim().toLowerCase();
  if (rawValue === 'claude' || rawValue === 'codex') {
    return rawValue;
  }

  throw new Error(`Unsupported AGENT_PROVIDER: ${process.env.AGENT_PROVIDER}`);
}

function parsePositiveInt(name: string, fallback: number): number {
  const rawValue = (process.env[name] || `${fallback}`).trim();
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${rawValue}`);
  }

  return parsed;
}

function parsePort(name: string, fallback: number): number {
  const parsed = parsePositiveInt(name, fallback);
  if (parsed > 65535) {
    throw new Error(`Invalid ${name}: ${parsed}`);
  }
  return parsed;
}

const config: Config = {
  feishu: {
    appId: process.env.FEISHU_APP_ID || '',
    appSecret: process.env.FEISHU_APP_SECRET || '',
  },
  agent: {
    provider: resolveAgentProvider(),
  },
  claude: {
    workRoot: process.env.CLAUDE_WORK_ROOT || process.cwd(),
    model: process.env.CLAUDE_MODEL || 'claude-opus-4-6',
  },
  app: {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    singleInstancePort: parsePort('SINGLE_INSTANCE_PORT', 8652),
  },
};

if (!config.feishu.appId || !config.feishu.appSecret) {
  throw new Error('Missing required Feishu credentials: FEISHU_APP_ID and FEISHU_APP_SECRET');
}

export default config;
