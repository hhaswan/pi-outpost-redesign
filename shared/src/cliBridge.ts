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
  | { action: "submit"; id: string; generation: string; inputId: string; text: string }
  | { action: "resume"; id: string };

export interface CliHandoffSummary {
  id: string;
  cwd: string;
  sessionId: string;
  state: "releasing" | "ready" | "owned";
}

export interface CliBridgeReply {
  requestId: string;
  sessions?: CliBridgeSummary[];
  snapshot?: CliBridgeSnapshot;
  submitted?: boolean;
  handoffs?: CliHandoffSummary[];
  resumed?: boolean;
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
