import path from 'node:path';

export interface CodexLaunchConfig {
  executablePath: string;
  argsPrefix: string[];
}

export function resolveCodexLaunchConfig(): CodexLaunchConfig {
  if (process.env.CODEX_CMD && process.env.CODEX_CMD.trim()) {
    return {
      executablePath: process.env.CODEX_CMD,
      argsPrefix: [],
    };
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new Error('APPDATA is not set, cannot infer codex.js path on Windows.');
    }

    return {
      executablePath: process.execPath,
      argsPrefix: [path.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')],
    };
  }

  return {
    executablePath: 'codex',
    argsPrefix: [],
  };
}
