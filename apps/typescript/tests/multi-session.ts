#!/usr/bin/env node

/**
 * Claude Code CLI 多 Session 管理测试
 *
 * 测试场景：
 * /cd 命令的本质是按目录分组管理多个独立的 session
 * 每个目录有自己的 session，上下文互不影响
 *
 * 测试流程：
 * 1. 在目录 A 创建 session_A，让 AI 记住数字 42
 * 2. 在目录 B 创建 session_B，让 AI 记住数字 99
 * 3. 在目录 A 使用 --continue 恢复 session_A，验证记住的是 42
 * 4. 在目录 B 使用 --continue 恢复 session_B，验证记住的是 99
 */

import { spawn, ChildProcess } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface Message {
  type: string;
  subtype?: string;
  text?: string;
  result?: string;
  session_id?: string;
  id?: string;
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
const TEST_DIR_A = path.join(os.tmpdir(), 'claude-test-session-a');
const TEST_DIR_B = path.join(os.tmpdir(), 'claude-test-session-b');
const STATE_FILE = path.join(process.cwd(), '.test-multi-session-state.json');

// 测试阶段
enum TestPhase {
  CREATE_SESSION_A = 'create_a',
  CREATE_SESSION_B = 'create_b',
  RESUME_SESSION_A = 'resume_a',
  RESUME_SESSION_B = 'resume_b',
}

interface TestState {
  phase: TestPhase;
  session_a?: string;
  session_b?: string;
}

// 准备测试目录
function setupTestDirs(): void {
  if (!fs.existsSync(TEST_DIR_A)) {
    fs.mkdirSync(TEST_DIR_A, { recursive: true });
  }
  if (!fs.existsSync(TEST_DIR_B)) {
    fs.mkdirSync(TEST_DIR_B, { recursive: true });
  }
  console.log('[测试目录已创建]');
  console.log('  目录 A:', TEST_DIR_A);
  console.log('  目录 B:', TEST_DIR_B);
}

// 清理测试目录
function cleanupTestDirs(): void {
  try {
    if (fs.existsSync(TEST_DIR_A)) {
      fs.rmSync(TEST_DIR_A, { recursive: true, force: true });
    }
    if (fs.existsSync(TEST_DIR_B)) {
      fs.rmSync(TEST_DIR_B, { recursive: true, force: true });
    }
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
    }
    console.log('[测试目录已清理]');
  } catch (e) {
    console.error('[清理失败]', (e as Error).message);
  }
}

// 读取测试状态
function loadState(): TestState {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  }
  return { phase: TestPhase.CREATE_SESSION_A };
}

// 保存测试状态
function saveState(state: TestState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// 获取当前测试配置
function getTestConfig(state: TestState): {
  phase: TestPhase;
  dir: string;
  useResume: boolean;
  message: string;
  description: string;
} {
  switch (state.phase) {
    case TestPhase.CREATE_SESSION_A:
      return {
        phase: TestPhase.CREATE_SESSION_A,
        dir: TEST_DIR_A,
        useResume: false,
        message: '请记住这个数字：42',
        description: '在目录 A 创建新会话',
      };
    case TestPhase.CREATE_SESSION_B:
      return {
        phase: TestPhase.CREATE_SESSION_B,
        dir: TEST_DIR_B,
        useResume: false,
        message: '请记住这个数字：99',
        description: '在目录 B 创建新会话',
      };
    case TestPhase.RESUME_SESSION_A:
      return {
        phase: TestPhase.RESUME_SESSION_A,
        dir: TEST_DIR_A,
        useResume: true,
        message: '我刚才让你记住的数字是多少？',
        description: '在目录 A 恢复会话（应该回答 42）',
      };
    case TestPhase.RESUME_SESSION_B:
      return {
        phase: TestPhase.RESUME_SESSION_B,
        dir: TEST_DIR_B,
        useResume: true,
        message: '我刚才让你记住的数字是多少？',
        description: '在目录 B 恢复会话（应该回答 99）',
      };
  }
}

// 获取下一个阶段
function getNextPhase(current: TestPhase): TestPhase | null {
  const phases = [
    TestPhase.CREATE_SESSION_A,
    TestPhase.CREATE_SESSION_B,
    TestPhase.RESUME_SESSION_A,
    TestPhase.RESUME_SESSION_B,
  ];
  const index = phases.indexOf(current);
  return index < phases.length - 1 ? phases[index + 1] : null;
}

// 主测试逻辑
const state = loadState();
const config = getTestConfig(state);

console.log(`[测试阶段 ${Object.values(TestPhase).indexOf(config.phase) + 1}/4] ${config.description}`);
console.log('[工作目录]', config.dir);
console.log('[测试消息]', config.message);

if (config.phase === TestPhase.CREATE_SESSION_A) {
  setupTestDirs();
}

// 构建启动参数
const CLAUDE_ARGS = [
  '--print',
  '--verbose',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
];

if (config.useResume) {
  CLAUDE_ARGS.push('--continue');
}

console.log('[命令]', CLAUDE_CMD, CLAUDE_ARGS.join(' '));

// 状态
let initialized = false;
let requestId = 1;
let sessionId = '';
let assistantResponse = ''; // 收集 AI 的完整响应
let cli: ChildProcess;
let rl: readline.Interface;

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
    cwd: config.dir,
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

          // 保存 session_id
          if (config.phase === TestPhase.CREATE_SESSION_A) {
            state.session_a = sessionId;
            saveState(state);
            console.log('[保存] session_A:', sessionId);
          } else if (config.phase === TestPhase.CREATE_SESSION_B) {
            state.session_b = sessionId;
            saveState(state);
            console.log('[保存] session_B:', sessionId);
          } else if (config.phase === TestPhase.RESUME_SESSION_A) {
            console.log('[验证] 期望恢复 session_A:', state.session_a);
            console.log('[验证] 实际 session_id:', sessionId);
          } else if (config.phase === TestPhase.RESUME_SESSION_B) {
            console.log('[验证] 期望恢复 session_B:', state.session_b);
            console.log('[验证] 实际 session_id:', sessionId);
          }
        }
        break;

      case 'assistant':
        if (msg.text) {
          assistantResponse += msg.text; // 收集响应
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
    sendUserMessage(config.message);
  }
}

function handlePermissionRequest(msg: Message): void {
  // 自动批准工具使用
  const response = {
    type: 'control_response',
    id: msg.id,
    response: {
      approved: true,
      updatedInput: msg.input,
    },
  };
  cli.stdin!.write(JSON.stringify(response) + '\n');
}

function handleResult(_msg: Message): void {
  console.log('\n[当前阶段完成]');

  // 在恢复阶段显示 AI 的响应
  if (config.phase === TestPhase.RESUME_SESSION_A || config.phase === TestPhase.RESUME_SESSION_B) {
    console.log('[AI 响应]', assistantResponse.trim());
  }

  const nextPhase = getNextPhase(config.phase);
  if (nextPhase) {
    state.phase = nextPhase;
    saveState(state);
    console.log('[提示] 请再次运行此脚本继续测试');
  } else {
    console.log('\n[测试完成] 所有阶段已完成');
    console.log('[验证结果]');
    console.log('  - 阶段 3 应该回答 42（目录 A 的上下文）');
    console.log('  - 阶段 4 应该回答 99（目录 B 的上下文）');
    console.log('  - 如果两个回答都正确，说明多 session 管理工作正常');
    cleanupTestDirs();
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
