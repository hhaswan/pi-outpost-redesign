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
  | { action: "resume"; id: string }
  /** Release the current web conversation to a CLI (web to CLI handoff). */
  | { action: "release" }
  /** Take back a web-to-CLI reservation that no running CLI holds. */
  | { action: "reclaim"; id: string }
  /** Continue a closed CLI's history file in web; the operator confirms the CLI is closed. */
  | { action: "adopt"; path: string };

export interface CliReservationSummary {
  id: string;
  sessionId: string;
  /** Shell command that opens the released file in a CLI. */
  command: string;
  state: "releasing" | "waiting" | "claimed" | "stale";
}

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
  reservations?: CliReservationSummary[];
  /** Recent history of this project's CLI that no enrolled CLI claims; adoptable after the CLI exits. */
  closed?: Array<{ path: string; sessionId: string; title: string; modified: string }>;
  released?: CliReservationSummary;
  reclaimed?: boolean;
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
