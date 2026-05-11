#!/usr/bin/env node

/**
 * Claude Code CLI stdin/stdout 通信协议测试
 *
 * 本测试演示如何通过 stdin/stdout 与 Claude Code CLI 进行通信。
 *
 * 通信流程：
 * 1. 启动 CLI 进程（必须包含 --verbose 参数）
 * 2. 使用 readline 逐行解析 stdout 的 NDJSON 输出
 * 3. 发送 control_request (initialize) 进行初始化
 * 4. 等待 control_response 确认初始化完成
 * 5. 发送用户消息（格式：{ type: 'user', message: { role, content } }）
 * 6. 接收 assistant 消息流和最终 result
 *
 * 参考文档：docs/STDIO_PROTOCOL.md
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

// 消息类型定义
interface ControlRequest {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'initialize';
    hooks: null;
  };
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

interface Message {
  type: string;
  subtype?: string;
  text?: string;
  result?: string;
  session_id?: string;
  [key: string]: any;
}

// 配置
const CLAUDE_CMD = 'claude';
const CLAUDE_ARGS = [
  '--print',
  '--verbose', // 必需：stream-json 输出格式要求
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
];
const TEST_MESSAGE = 'hello, what time is it?';
const INIT_TIMEOUT = 1000; // 初始化延迟（ms）
const OVERALL_TIMEOUT = 30000; // 总超时时间（ms）

// 状态
let initialized = false;
let requestId = 1;
let sessionId = '';
let cli: ChildProcess;
let rl: readline.Interface;

console.log('[测试开始] Claude Code CLI stdin/stdout 通信');
console.log('[命令]', CLAUDE_CMD, CLAUDE_ARGS.join(' '));

// 准备环境变量（清除 CLAUDECODE 避免嵌套调用）
const env = { ...process.env };
delete env.CLAUDECODE;

// 启动 CLI 进程
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

// 读取并解析 stdout（NDJSON 格式）
rl = readline.createInterface({
  input: cli.stdout!,
  crlfDelay: Infinity,
});

rl.on('line', (line: string) => {
  try {
    const msg: Message = JSON.parse(line);

    // 处理不同类型的消息
    switch (msg.type) {
      case 'control_response':
        handleControlResponse(msg);
        break;

      case 'system':
        handleSystemMessage(msg);
        break;

      case 'assistant':
        handleAssistantMessage(msg);
        break;

      case 'result':
        handleResult(msg);
        break;

      default:
        console.log('[收到]', msg.type, msg.subtype || '');
    }
  } catch (e) {
    const error = e as Error;
    console.error('[解析错误]', error.message);
    console.error('[原始数据]', line.substring(0, 200));
  }
});

// 处理控制响应（初始化完成）
function handleControlResponse(_msg: Message): void {
  console.log('[初始化完成]');

  if (!initialized) {
    initialized = true;
    sendUserMessage(TEST_MESSAGE);
  }
}

// 处理系统消息
function handleSystemMessage(msg: Message): void {
  if (msg.subtype === 'init') {
    sessionId = msg.session_id || '';
    console.log('[会话初始化] session_id:', sessionId);
  } else {
    console.log('[系统消息]', msg.subtype);
  }
}

// 处理 AI 响应（流式输出）
function handleAssistantMessage(msg: Message): void {
  if (msg.text) {
    process.stdout.write(msg.text);
  }
}

// 处理最终结果
function handleResult(msg: Message): void {
  console.log('\n[任务完成] result:', msg.result);
  cleanup(0);
}

// 发送初始化请求
function sendInitialize(): void {
  const initRequest: ControlRequest = {
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

// 发送用户消息
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

// 清理并退出
function cleanup(code: number): void {
  setTimeout(() => {
    cli.stdin!.end();
    rl.close();
    process.exit(code);
  }, 100);
}

// 处理 stderr 输出
cli.stderr!.on('data', (data: Buffer) => {
  console.error('[stderr]', data.toString().trim());
});

// 进程退出处理
cli.on('exit', (code: number | null, signal: string | null) => {
  console.log('[进程退出] code:', code, 'signal:', signal);
  process.exit(code || 0);
});

// 进程错误处理
cli.on('error', (err: Error) => {
  console.error('[进程错误]', err.message);
  process.exit(1);
});

// 启动流程：延迟发送初始化请求
setTimeout(() => {
  sendInitialize();
}, INIT_TIMEOUT);

// 超时保护
setTimeout(() => {
  console.error('[超时] 测试超时，强制退出');
  cli.kill();
  process.exit(1);
}, OVERALL_TIMEOUT);
