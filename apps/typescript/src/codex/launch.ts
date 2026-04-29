export interface CodexLaunchConfig {
  executablePath: string;
  argsPrefix: string[];
}

export interface CodexLaunchOverrides {
  executablePath?: string;
  argsPrefix?: string[];
}

export interface CodexAppServerSpawnTarget {
  command: string;
  args: string[];
  launchDescription: string;
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

export function resolveCodexAppServerSpawnTarget(): CodexAppServerSpawnTarget {
  const { executablePath } = resolveCodexLaunchConfig();

  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', executablePath, 'app-server'],
      launchDescription: `cmd.exe trampoline (${executablePath} app-server)`,
    };
  }

  return {
    command: executablePath,
    args: ['app-server'],
    launchDescription: `direct spawn (${executablePath} app-server)`,
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
