import path from 'node:path';
import { pathToFileURL } from 'node:url';
import logger from '../utils/logger';

export interface ThreadRunResult {
  items: unknown[];
  finalResponse: string;
  usage: unknown;
}

export interface ThreadInputTextItem {
  type: 'text';
  text: string;
}

export interface ThreadInputImageItem {
  type: 'local_image';
  path: string;
}

export type ThreadInputItem = ThreadInputTextItem | ThreadInputImageItem;

export interface ThreadRunOptions {
  signal?: AbortSignal;
  onEvent?: (event: unknown) => void;
}

export interface ThreadLike {
  readonly id: string | null;
  run(input: string | ThreadInputItem[], options?: ThreadRunOptions): Promise<ThreadRunResult>;
}

export interface CodexLike {
  startThread(options?: {
    model?: string;
    sandboxMode?: string;
    workingDirectory?: string;
    skipGitRepoCheck?: boolean;
    approvalPolicy?: string;
    additionalDirectories?: string[];
    networkAccessEnabled?: boolean;
  }): ThreadLike;
  resumeThread(id: string, options?: {
    model?: string;
    sandboxMode?: string;
    workingDirectory?: string;
    skipGitRepoCheck?: boolean;
    approvalPolicy?: string;
    additionalDirectories?: string[];
    networkAccessEnabled?: boolean;
  }): ThreadLike;
}

export interface CodexSdkModule {
  Codex: new (options?: {
    codexPathOverride?: string;
    codexArgsPrefix?: string[];
    baseUrl?: string;
    apiKey?: string;
    env?: Record<string, string>;
  }) => CodexLike;
}

let sdkPromise: Promise<CodexSdkModule> | null = null;

export function getVendoredSdkEntryPath(): string {
  return path.resolve(__dirname, '..', '..', 'vendor', 'codex-sdk-minimal', 'dist', 'index.js');
}

export async function loadCodexSdk(): Promise<CodexSdkModule> {
  if (!sdkPromise) {
    const entryUrl = pathToFileURL(getVendoredSdkEntryPath()).href;
    const dynamicImport = new Function('specifier', 'return import(specifier);') as (
      specifier: string,
    ) => Promise<CodexSdkModule>;
    logger.info('[CodexSdkLoader] Loading vendored Codex SDK', { entryUrl });
    sdkPromise = dynamicImport(entryUrl);
  }

  return sdkPromise;
}
