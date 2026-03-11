#!/usr/bin/env node

/**
 * Claude Code CLI 工具调用测试
 *
 * 测试场景：AI 调用工具（如 Bash）并处理工具结果
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

interface Message {
  type: string;
  subtype?: string;
  text?: string;
  result?: string;
  session_id?: string;
  tool_name?: string;
  tool_use_id?: string;
  input?: any;
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

// 测试消息：让 AI 使用工具
const TEST_MESSAGE = '当前目录下有哪些文件？请列出来';

// 状态
let initialized = false;
let requestId = 1;
let sessionId = '';
let toolCallCount = 0;
let cli: ChildProcess;
let rl: readline.Interface;

console.log('[测试开始] 工具调用测试');
console.log('[测试消息]', TEST_MESSAGE);

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

      case 'tool_use':
        handleToolUse(msg);
        break;

      case 'result':
        handleResult(msg);
        break;

      default:
        // 记录其他消息类型
        if (msg.type !== 'assistant') {
          console.log('[收到]', msg.type, msg.subtype || '');
        }
    }
  } catch (e) {
    const error = e as Error;
    console.error('[解析错误]', error.message);
  }
});

function handleControlResponse(): void {
  if (!initialized) {
    initialized = true;
    sendUserMessage(TEST_MESSAGE);
  }
}

function handleToolUse(msg: Message): void {
  toolCallCount++;
  console.log(
    `\n[工具调用 #${toolCallCount}]`,
    msg.tool_name,
    'tool_use_id:',
    msg.tool_use_id
  );
  if (msg.input) {
    console.log('[工具参数]', JSON.stringify(msg.input).substring(0, 100));
  }
}

function handleResult(msg: Message): void {
  console.log('\n[任务完成] result:', msg.result);
  console.log('[工具调用次数]', toolCallCount);
  cleanup(0);
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

function sendUserMessage(content: string): void {
  const userMsg: UserMessage = {
    type: 'user',
    session_id: sessionId,
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
  };

  console.log('[发送] 用户消息:', content);
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
}, 30000);
