// Claude Code CLI NDJSON 协议类型定义（精简版）

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
  | { type: 'thinking'; thinking: string };

export interface CLISystemInitMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
  cwd: string;
  tools: string[];
  permissionMode: string;
  claude_code_version: string;
  mcp_servers: { name: string; status: string }[];
  agents?: string[];
  slash_commands?: string[];
  skills?: string[];
}

export interface CLIAssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    model: string;
    content: ContentBlock[];
    stop_reason: string | null;
  };
  parent_tool_use_id: string | null;
  session_id: string;
}

export interface CLIResultMessage {
  type: 'result';
  subtype: string;
  is_error: boolean;
  result?: string;
  duration_ms: number;
  num_turns: number;
  total_cost_usd: number;
  session_id: string;
}

export interface CLIControlRequestMessage {
  type: 'control_request';
  request_id: string;
  request: {
    subtype: 'can_use_tool';
    tool_name: string;
    input: Record<string, unknown>;
    tool_use_id: string;
  };
}

export interface CLIStreamEventMessage {
  type: 'stream_event';
  event: unknown;
  parent_tool_use_id: string | null;
  session_id: string;
}

export interface CLIKeepAliveMessage {
  type: 'keep_alive';
}

export type CLIMessage =
  | CLISystemInitMessage
  | CLIAssistantMessage
  | CLIResultMessage
  | CLIControlRequestMessage
  | CLIStreamEventMessage
  | CLIKeepAliveMessage
  | { type: 'system'; subtype: 'status'; [key: string]: unknown }
  | { type: 'tool_progress'; [key: string]: unknown }
  | { type: 'tool_use_summary'; [key: string]: unknown }
  | { type: 'auth_status'; [key: string]: unknown };
