export interface JsonRpcErrorShape {
  code?: number;
  message?: string;
}

export interface JsonRpcRequestShape<TParams = unknown> {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: TParams;
}

export interface JsonRpcNotificationShape<TParams = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: TParams;
}

export interface JsonRpcResponseShape<TResult = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: TResult;
  error?: JsonRpcErrorShape;
}

export interface AppServerErrorDetail {
  message?: string;
}

export interface AppServerTurnShape {
  id?: string;
  status?: string;
  error?: AppServerErrorDetail;
}

export interface AppServerTurnStartedParams {
  threadId?: string;
  turn?: AppServerTurnShape;
}

export interface AppServerTurnCompletedParams {
  threadId?: string;
  status?: string;
  error?: AppServerErrorDetail;
  turn?: AppServerTurnShape;
}

export interface AppServerItemShape {
  type?: string;
  text?: string;
  message?: string;
}

export interface AppServerItemCompletedParams {
  threadId?: string;
  item?: AppServerItemShape;
}

export interface AppServerErrorNotificationParams {
  threadId?: string;
  willRetry?: boolean;
  message?: string;
  error?: AppServerErrorDetail;
}

export type AppServerServerRequestMethod =
  | 'item/commandExecution/requestApproval'
  | 'execCommandApproval'
  | 'item/fileChange/requestApproval'
  | 'applyPatchApproval'
  | (string & {});
