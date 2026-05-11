import { existsSync, statSync } from 'fs';
import { isAbsolute, resolve } from 'path';

import config from '../config';

export function resolveWorkPath(input: string): string | null {
  const target = resolveWorkPathCandidate(input);
  if (!isDirectoryAvailable(target)) {
    return null;
  }
  return target;
}

export function resolveWorkPathCandidate(input: string): string {
  return isAbsolute(input) ? input : resolve(config.agent.workRoot, input);
}

export function isDirectoryAvailable(target: string): boolean {
  try {
    return existsSync(target) && statSync(target).isDirectory();
  } catch {
    return false;
  }
}
