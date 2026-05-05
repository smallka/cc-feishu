const RESERVED_WINDOWS_DIR_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

const INVALID_WINDOWS_DIR_CHARS_RE = /[<>:"/\\|?*\u0000-\u001F]/g;
const INVALID_WINDOWS_DIR_CHARS_TEST_RE = /[<>:"/\\|?*\u0000-\u001F]/;
const TRAILING_WINDOWS_DIR_SUFFIX_RE = /[. ]+$/g;
const MULTI_SPACE_RE = /\s+/g;

export interface DerivedChatDirectoryName {
  originalName: string;
  directoryName: string | null;
  sanitized: boolean;
  autoBindable: boolean;
}

export function isSingleSegmentRelativePath(input: string): boolean {
  return input !== '.'
    && input !== '..'
    && !input.includes('/')
    && !input.includes('\\');
}

export function isValidWindowsDirectoryName(input: string): boolean {
  if (!input || !isSingleSegmentRelativePath(input) || INVALID_WINDOWS_DIR_CHARS_TEST_RE.test(input)) {
    return false;
  }

  if (input.endsWith(' ') || input.endsWith('.')) {
    return false;
  }

  const stem = input.split('.')[0]?.toUpperCase() ?? '';
  return !RESERVED_WINDOWS_DIR_NAMES.has(stem);
}

function normalizeWhitespace(input: string): string {
  return input.replace(MULTI_SPACE_RE, ' ').trim();
}

function sanitizeWindowsDirectorySegment(input: string): string {
  let sanitized = normalizeWhitespace(input);
  sanitized = sanitized.replace(INVALID_WINDOWS_DIR_CHARS_RE, ' ');
  sanitized = normalizeWhitespace(sanitized);
  sanitized = sanitized.replace(TRAILING_WINDOWS_DIR_SUFFIX_RE, '');
  sanitized = normalizeWhitespace(sanitized);

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return '';
  }

  const stem = sanitized.split('.')[0]?.toUpperCase() ?? '';
  if (RESERVED_WINDOWS_DIR_NAMES.has(stem)) {
    sanitized = `${sanitized}_group`;
  }

  sanitized = sanitized.replace(TRAILING_WINDOWS_DIR_SUFFIX_RE, '');
  return normalizeWhitespace(sanitized);
}

export function deriveChatDirectoryName(chatName: string): DerivedChatDirectoryName {
  const originalName = normalizeWhitespace(chatName);
  const sanitizedName = sanitizeWindowsDirectorySegment(chatName);

  if (sanitizedName && isValidWindowsDirectoryName(sanitizedName)) {
    return {
      originalName,
      directoryName: sanitizedName,
      sanitized: sanitizedName !== originalName,
      autoBindable: true,
    };
  }

  return {
    originalName,
    directoryName: null,
    sanitized: true,
    autoBindable: false,
  };
}
