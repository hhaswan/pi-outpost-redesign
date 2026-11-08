/** Browser MCP management: bounded operations, never arbitrary gateway tool calls. */
export type McpConfigScope = "project" | "global" | "project-adapter" | "global-adapter";
export type McpManagementOperation =
  | { action: "list" }
  | { action: "connect"; name: string }
  | { action: "save"; scope: McpConfigScope; name: string; config: Record<string, unknown>; revision: string; create?: boolean }
  | { action: "remove"; scope: McpConfigScope; name: string; revision: string };

export interface McpConfigDocument {
  scope: McpConfigScope;
  path: string;
  revision: string;
  servers: Record<string, Record<string, unknown>>;
}
export interface McpLiveServer {
  name: string;
  status: string;
  listenState?: string;
  toolCount: number;
}
export interface McpManagementData {
  documents: McpConfigDocument[];
  servers: McpLiveServer[];
  /** Runtime does not expose a management gateway or its status could not be read. */
  statusError?: string;
  editable: boolean;
}
export interface McpManagementReply {
  requestId: string;
  data?: McpManagementData;
  error?: string;
  message?: string;
  reloadRequired?: boolean;
}
