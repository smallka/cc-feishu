import { spawn } from 'node:child_process';
import logger from '../utils/logger';

const LARK_CLI_COMMAND = 'lark-cli';
const USER_CLI_FILE_DELIVERY_SCOPE = 'im:message im:resource';
const DETECTION_TIMEOUT_MS = 2_000;

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: Error;
}

export async function detectLarkImFileDeliveryAvailable(chatId?: string): Promise<boolean> {
  return detectLarkImFileDeliveryAvailableWithRunner(runLarkCli, {
    appCredentialsAvailable: Boolean(configuredAppCredentialsAvailable()),
    chatId,
  });
}

export async function detectLarkImFileDeliveryAvailableWithRunner(
  runner: (args: string[]) => Promise<CommandResult>,
  options: {
    appCredentialsAvailable?: boolean;
    chatId?: string;
  } = {},
): Promise<boolean> {
  // Primary path: Codex runs inside the Feishu bot process, so app credentials
  // plus the current chat are enough for bot-side file delivery.
  if (options.appCredentialsAvailable && options.chatId) {
    return true;
  }

  // Fallback path: a local user-authenticated lark-cli can also send files.
  const help = await runner(['im', '+messages-send', '--help']);
  if (!isSuccessfulCommand(help)) {
    logDetectionFailure('im +messages-send help failed', help);
    return false;
  }

  const userScopeCheck = await runner(['auth', 'check', '--scope', USER_CLI_FILE_DELIVERY_SCOPE]);
  if (isSuccessfulCommand(userScopeCheck)) {
    return true;
  }

  logDetectionFailure('auth check failed', userScopeCheck);

  return false;
}

function configuredAppCredentialsAvailable(): boolean {
  return Boolean(process.env.FEISHU_APP_ID?.trim() && process.env.FEISHU_APP_SECRET?.trim());
}

function runLarkCli(args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(LARK_CLI_COMMAND, args, {
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, DETECTION_TIMEOUT_MS);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk;
    });

    child.on('error', error => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        error,
      });
    });

    child.on('close', exitCode => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function isSuccessfulCommand(result: CommandResult): boolean {
  return !result.error && !result.timedOut && result.exitCode === 0;
}

function logDetectionFailure(reason: string, result: CommandResult): void {
  logger.debug('[LarkImFileDeliveryCapability] detection skipped', {
    reason,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    error: result.error?.message,
    stderr: result.stderr.trim(),
  });
}
