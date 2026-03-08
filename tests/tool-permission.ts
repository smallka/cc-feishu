#!/usr/bin/env node

/**
 * Claude Code CLI 工具权限自动批准测试
 *
 * 测试场景：
 * 1. 发送需要工具调用的消息
 * 2. 接收 control_request (can_use_tool)
 * 3. 自动发送 control_response (approved: true)
 * 4. 验证工具执行成功
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';

interface Message {
  type: string;
  subtype?: string;
  text?: string;
  result?: string;
  session_id?: string;
  id?: string;
  tool?: string;
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

interface ControlResponse {
  type: 'control_response';
  id: string;
  response: {
    approved: boolean;
    updatedInput?: any;
  };
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

// 测试消息：明确要求读取文件
const TEST_MESSAGE = '请使用 Read 工具读取 tsconfig.json 文件的完整内容，不要使用你已有的知识';

// 状态
let initialized = false;
let requestId = 1;
let sessionId = '';
let permissionRequestCount = 0;
let approvedCount = 0;
let cli: ChildProcess;
let rl: readline.Interface;

console.log('[测试开始] 工具权限自动批准测试');
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

      case 'control_request':
        if (msg.subtype === 'can_use_tool') {
          handlePermissionRequest(msg);
        }
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

      default:
        // 静默处理其他消息
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
    sendUserMessage(TEST_MESSAGE);
  }
}

function handlePermissionRequest(msg: Message): void {
  permissionRequestCount++;
  console.log(
    `\n[权限请求 #${permissionRequestCount}]`,
    'tool:',
    msg.tool,
    'id:',
    msg.id
  );

  // 自动批准
  approveToolUse(msg.id!, msg.input);
}

function approveToolUse(id: string, input: any): void {
  approvedCount++;

  const response: ControlResponse = {
    type: 'control_response',
    id,
    response: {
      approved: true,
      updatedInput: input,
    },
  };

  console.log(`[自动批准 #${approvedCount}]`, id);
  cli.stdin!.write(JSON.stringify(response) + '\n');
}

function handleResult(msg: Message): void {
  console.log('\n[任务完成] result:', msg.result);
  console.log('[统计] 权限请求:', permissionRequestCount, '已批准:', approvedCount);

  if (permissionRequestCount === 0) {
    console.warn('[警告] 未收到任何权限请求，可能 AI 没有调用工具');
  } else if (approvedCount !== permissionRequestCount) {
    console.error('[错误] 批准数量与请求数量不匹配');
  } else {
    console.log('[成功] 所有权限请求已正确处理');
  }

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
