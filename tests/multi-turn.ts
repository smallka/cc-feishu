#!/usr/bin/env node

/**
 * Claude Code CLI 连续对话测试
 *
 * 测试场景：在同一个会话中发送多轮对话
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

interface Message {
  type: string;
  subtype?: string;
  text?: string;
  result?: string;
  session_id?: string;
  [key: string]: any;
}

interface UserMessage {
  type: 'user';
  session_id: string;
  message: {
    role: 'user';
    content: string;
  };
  parent_tool_use_id: null;
}

// 配置
const CLAUDE_CMD = 'claude';
const CLAUDE_ARGS = [
  '--print',
  '--verbose',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
];

// 测试消息队列
const TEST_MESSAGES = [
  '请用一句话介绍你自己',
  '你刚才说了什么？',
  '谢谢',
];

// 状态
let initialized = false;
let requestId = 1;
let sessionId = '';
let currentMessageIndex = 0;
let cli: ChildProcess;
let rl: readline.Interface;

console.log('[测试开始] 连续对话测试');
console.log('[测试消息数量]', TEST_MESSAGES.length);

// 准备环境
const env = { ...process.env };
delete env.CLAUDECODE;

// 启动 CLI
cli = spawn(
  process.platform === 'win32' ? 'cmd.exe' : CLAUDE_CMD,
  process.platform === 'win32'
    ? ['/c', `set CLAUDECODE= && ${CLAUDE_CMD} ${CLAUDE_ARGS.join(' ')}`]
    : CLAUDE_ARGS,
  {
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  }
);

console.log('[进程启动] PID:', cli.pid);

// 读取输出
rl = readline.createInterface({
  input: cli.stdout!,
  crlfDelay: Infinity,
});

rl.on('line', (line: string) => {
  try {
    const msg: Message = JSON.parse(line);

    switch (msg.type) {
      case 'control_response':
        handleControlResponse();
        break;

      case 'system':
        if (msg.subtype === 'init') {
          sessionId = msg.session_id || '';
          console.log('[会话初始化] session_id:', sessionId);
        }
        break;

      case 'assistant':
        if (msg.text) {
          process.stdout.write(msg.text);
        }
        break;

      case 'result':
        handleResult(msg);
        break;
    }
  } catch (e) {
    const error = e as Error;
    console.error('[解析错误]', error.message);
  }
});

function handleControlResponse(): void {
  if (!initialized) {
    initialized = true;
    sendNextMessage();
  }
}

function handleResult(msg: Message): void {
  console.log('\n[第', currentMessageIndex, '轮完成] result:', msg.result);

  // 发送下一条消息
  if (currentMessageIndex < TEST_MESSAGES.length) {
    setTimeout(() => {
      sendNextMessage();
    }, 500);
  } else {
    console.log('\n[测试完成] 所有消息已发送');
    cleanup(0);
  }
}

function sendInitialize(): void {
  const initRequest = {
    type: 'control_request',
    request_id: `req_${requestId++}`,
    request: {
      subtype: 'initialize',
      hooks: null,
    },
  };

  console.log('[发送] control_request (initialize)');
  cli.stdin!.write(JSON.stringify(initRequest) + '\n');
}

function sendNextMessage(): void {
  if (currentMessageIndex >= TEST_MESSAGES.length) {
    return;
  }

  const content = TEST_MESSAGES[currentMessageIndex];
  currentMessageIndex++;

  const userMsg: UserMessage = {
    type: 'user',
    session_id: sessionId,
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
  };

  console.log(`\n[发送第 ${currentMessageIndex} 条消息]`, content);
  cli.stdin!.write(JSON.stringify(userMsg) + '\n');
}

function cleanup(code: number): void {
  setTimeout(() => {
    cli.stdin!.end();
    rl.close();
    process.exit(code);
  }, 100);
}

// 错误处理
cli.stderr!.on('data', (data: Buffer) => {
  console.error('[stderr]', data.toString().trim());
});

cli.on('exit', (code: number | null) => {
  console.log('[进程退出] code:', code);
  process.exit(code || 0);
});

cli.on('error', (err: Error) => {
  console.error('[进程错误]', err.message);
  process.exit(1);
});

// 启动
setTimeout(() => {
  sendInitialize();
}, 1000);

// 超时保护
setTimeout(() => {
  console.error('[超时] 测试超时');
  cli.kill();
  process.exit(1);
}, 60000);
