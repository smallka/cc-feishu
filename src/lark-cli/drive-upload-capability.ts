import { spawn } from 'node:child_process';
import logger from '../utils/logger';

const LARK_CLI_COMMAND = 'lark-cli';
const DRIVE_UPLOAD_SCOPE = 'drive:file:upload';
const DETECTION_TIMEOUT_MS = 2_000;

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: Error;
}

export async function detectLarkDriveUploadAvailable(): Promise<boolean> {
  return detectLarkDriveUploadAvailableWithRunner(runLarkCli);
}

export async function detectLarkDriveUploadAvailableWithRunner(
  runner: (args: string[]) => Promise<CommandResult>,
): Promise<boolean> {
  const status = await runner(['auth', 'status', '--format', 'json']);
  if (!isSuccessfulCommand(status)) {
    logDetectionFailure('auth status failed', status);
    return false;
  }

  const scopeCheck = await runner([
    'auth',
    'check',
    '--scope',
    DRIVE_UPLOAD_SCOPE,
    '--format',
    'json',
  ]);
  if (!isSuccessfulCommand(scopeCheck)) {
    logDetectionFailure('auth check failed', scopeCheck);
    return false;
  }

  return true;
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
  logger.debug('[LarkDriveUploadCapability] detection skipped', {
    reason,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    error: result.error?.message,
    stderr: result.stderr.trim(),
  });
}
