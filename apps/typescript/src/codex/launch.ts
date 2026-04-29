export interface CodexLaunchConfig {
  executablePath: string;
  argsPrefix: string[];
}

export interface CodexLaunchOverrides {
  executablePath?: string;
  argsPrefix?: string[];
}

export function resolveCodexLaunchConfig(): CodexLaunchConfig {
  const codexCmd = readCodexCommandOverride();
  if (codexCmd) {
    return {
      executablePath: codexCmd,
      argsPrefix: [],
    };
  }

  return {
    executablePath: 'codex',
    argsPrefix: [],
  };
}

export function resolveLegacyCodexLaunchOverrides(): CodexLaunchOverrides {
  const codexCmd = readCodexCommandOverride();
  if (codexCmd) {
    return {
      executablePath: codexCmd,
      argsPrefix: [],
    };
  }

  if (process.platform === 'win32') {
    return {};
  }

  return {
    executablePath: 'codex',
    argsPrefix: [],
  };
}

function readCodexCommandOverride(): string | null {
  const rawCommand = process.env.CODEX_CMD;
  if (!rawCommand) {
    return null;
  }

  const trimmedCommand = rawCommand.trim();
  return trimmedCommand ? trimmedCommand : null;
}
