export interface SessionSummary {
  sessionId: string;
  cwd: string;
  filePath: string;
  firstMessage: string;
  mtimeMs: number;
}

export interface SessionTarget {
  sessionId: string;
  cwd: string;
}

export interface DirectorySummary {
  cwd: string;
  mtimeMs: number;
}
