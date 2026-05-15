export type SessionDecisionMode = 'continue' | 'new';

export type SessionDecisionReason =
  | 'explicit_continue'
  | 'explicit_new'
  | 'continue_unavailable'
  | 'same_workday'
  | 'cross_workday'
  | 'first_message';

export interface SessionDecision {
  mode: SessionDecisionMode;
  reason: SessionDecisionReason;
}

interface DecideSessionOptions {
  previousAtMs?: number;
  currentAtMs: number;
  text: string;
  workdayCutoffHour?: number;
}

const DEFAULT_WORKDAY_CUTOFF_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

const EXPLICIT_NEW_PATTERNS = [
  /^\/new\b/i,
  /\breset\b/i,
  /新开/,
  /换个话题/,
  /重新开始/,
  /从头开始/,
  /重置(?:会话|对话)/,
  /(?:不要|别|不用)(?:接上文|接着|沿用|延续|继续)/,
];

const EXPLICIT_CONTINUE_PATTERNS = [
  /继续/,
  /接着/,
  /接上文/,
  /沿用(?:上次|上个|之前|原来)?/,
  /延续(?:上次|上个|之前|原来)?/,
  /按(?:刚才|上次|昨天|前面|上面|之前)/,
  /(?:刚才|上次|昨天|前面|上面|之前)(?:那个|的任务|的会话|的内容)/,
];

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function hasExplicitNewSessionIntent(text: string): boolean {
  const normalized = normalizeText(text);
  return EXPLICIT_NEW_PATTERNS.some(pattern => pattern.test(normalized));
}

export function hasExplicitContinueSessionIntent(text: string): boolean {
  const normalized = normalizeText(text);
  return EXPLICIT_CONTINUE_PATTERNS.some(pattern => pattern.test(normalized));
}

function getWorkdayKey(timestampMs: number, cutoffHour: number): string {
  const shifted = new Date(timestampMs - cutoffHour * HOUR_MS);
  const year = shifted.getFullYear();
  const month = String(shifted.getMonth() + 1).padStart(2, '0');
  const day = String(shifted.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isSameWorkday(previousAtMs: number, currentAtMs: number, cutoffHour = DEFAULT_WORKDAY_CUTOFF_HOUR): boolean {
  return getWorkdayKey(previousAtMs, cutoffHour) === getWorkdayKey(currentAtMs, cutoffHour);
}

export function decideSession(options: DecideSessionOptions): SessionDecision {
  if (hasExplicitNewSessionIntent(options.text)) {
    return { mode: 'new', reason: 'explicit_new' };
  }

  if (hasExplicitContinueSessionIntent(options.text)) {
    return options.previousAtMs === undefined
      ? { mode: 'new', reason: 'continue_unavailable' }
      : { mode: 'continue', reason: 'explicit_continue' };
  }

  if (options.previousAtMs === undefined) {
    return { mode: 'new', reason: 'first_message' };
  }

  return isSameWorkday(options.previousAtMs, options.currentAtMs, options.workdayCutoffHour)
    ? { mode: 'continue', reason: 'same_workday' }
    : { mode: 'new', reason: 'cross_workday' };
}

export function formatSessionDecisionNotice(decision: SessionDecision): string {
  switch (decision.reason) {
    case 'explicit_continue':
      return '检测到继续意图，沿用上一个会话。';
    case 'explicit_new':
      return '检测到新开意图，已新开会话。';
    case 'continue_unavailable':
      return '检测到继续意图，但当前没有可延续会话，已新开会话。';
    case 'same_workday':
      return '继续使用上一个会话。';
    case 'cross_workday':
      return '已跨作息日，未检测到继续意图，已新开会话。';
    case 'first_message':
    default:
      return '已新开会话。';
  }
}
