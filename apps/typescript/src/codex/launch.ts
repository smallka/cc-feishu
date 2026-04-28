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

  return {
    executablePath: 'codex',
    argsPrefix: [],
  };
}
