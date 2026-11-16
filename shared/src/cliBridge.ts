/** Opt-in CLI owner protocol; endpoint credentials never cross the browser boundary. */
export interface CliBridgeSnapshot {
  instanceId: string;
  generation: string;
  cwd: string;
  sessionId: string;
  sessionFile?: string;
  activity: "working" | "waiting" | "idle";
  inputGranted: boolean;
  transcript: string;
  truncated: boolean;
}

export interface CliBridgeSummary {
  id: string;
  cwd: string;
  sessionId: string;
  activity: "working" | "waiting" | "idle" | "unreachable";
  inputGranted: boolean;
}

export type CliBridgeOperation =
  | { action: "list" }
  | { action: "read"; id: string }
  | { action: "submit"; id: string; generation: string; inputId: string; text: string };

export interface CliBridgeReply {
  requestId: string;
  sessions?: CliBridgeSummary[];
  snapshot?: CliBridgeSnapshot;
  submitted?: boolean;
  error?: string;
}

/** Private on-disk registration, readable only by the local server account. */
export interface CliBridgeRegistration {
  version: 1;
  id: string;
  port: number;
  token: string;
  cwd: string;
  sessionId: string;
  sessionFile?: string;
}

/** One live turn event a bridged CLI streams to the server (one NDJSON line each). */
export type CliBridgeEvent =
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "assistant_start" }
  | { type: "block_delta"; block: "text" | "thinking"; contentIndex: number; delta: string }
  | { type: "assistant_end"; message: unknown }
  | { type: "tool_start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool_end"; toolCallId: string; toolName: string; content: unknown; details?: unknown; isError: boolean };
