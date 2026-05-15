import assert from 'node:assert/strict';

import {
  decideSession,
  formatSessionDecisionNotice,
  hasExplicitContinueSessionIntent,
  hasExplicitNewSessionIntent,
  isSameWorkday,
} from '../src/bot/session-decision';

const at = (iso: string): number => new Date(iso).getTime();

async function main(): Promise<void> {
  assert.equal(
    isSameWorkday(
      at('2026-05-15T23:30:00+08:00'),
      at('2026-05-16T00:30:00+08:00'),
    ),
    true,
    'midnight should stay in the same workday before the cutoff',
  );

  assert.equal(
    isSameWorkday(
      at('2026-05-15T23:30:00+08:00'),
      at('2026-05-16T05:30:00+08:00'),
    ),
    false,
    '05:00 local cutoff should start a new workday',
  );

  assert.equal(hasExplicitContinueSessionIntent('继续'), true);
  assert.equal(hasExplicitContinueSessionIntent('按昨天那个来'), true);
  assert.equal(hasExplicitNewSessionIntent('换个话题'), true);
  assert.equal(hasExplicitNewSessionIntent('/new'), true);
  assert.equal(hasExplicitNewSessionIntent('怎么重置这个配置'), false);
  assert.equal(hasExplicitNewSessionIntent('重置会话'), true);

  assert.deepEqual(decideSession({
    previousAtMs: at('2026-05-15T23:30:00+08:00'),
    currentAtMs: at('2026-05-16T00:30:00+08:00'),
    text: '这个怎么处理',
  }), {
    mode: 'continue',
    reason: 'same_workday',
  });

  assert.deepEqual(decideSession({
    previousAtMs: at('2026-05-15T23:30:00+08:00'),
    currentAtMs: at('2026-05-16T05:30:00+08:00'),
    text: '这个怎么处理',
  }), {
    mode: 'new',
    reason: 'cross_workday',
  });

  assert.deepEqual(decideSession({
    currentAtMs: at('2026-05-16T05:30:00+08:00'),
    text: '继续',
  }), {
    mode: 'new',
    reason: 'continue_unavailable',
  });

  assert.deepEqual(decideSession({
    previousAtMs: at('2026-05-15T23:30:00+08:00'),
    currentAtMs: at('2026-05-16T05:30:00+08:00'),
    text: '继续昨天那个',
  }), {
    mode: 'continue',
    reason: 'explicit_continue',
  });

  assert.deepEqual(decideSession({
    previousAtMs: at('2026-05-15T23:30:00+08:00'),
    currentAtMs: at('2026-05-16T00:30:00+08:00'),
    text: '换个话题',
  }), {
    mode: 'new',
    reason: 'explicit_new',
  });

  assert.equal(formatSessionDecisionNotice({ mode: 'continue', reason: 'same_workday' }), '继续使用上一个会话。');
  assert.equal(formatSessionDecisionNotice({ mode: 'new', reason: 'cross_workday' }), '已跨作息日，未检测到继续意图，已新开会话。');
  assert.equal(formatSessionDecisionNotice({ mode: 'new', reason: 'continue_unavailable' }), '检测到继续意图，但当前没有可延续会话，已新开会话。');

  console.log('session-decision.test.ts passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
