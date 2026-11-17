/**
 * Browser management of pi-subagents agent files. The client addresses an agent file by
 * writable scope and file name only, never by a path; the server owns every path.
 */
export type SubagentScope = "global" | "project";
/** Where pi-subagents finds an agent: lowest priority first is builtin, package, global, shared, project. */
export type SubagentSource = "builtin" | "package" | "global" | "shared" | "project";
export type SubagentThinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
/** `true` inherits every skill (no `skills:` key), `false` none, a list only those names. */
export type SubagentSkills = true | false | string[];

export interface SubagentEntry {
  /** The agent type pi-subagents registers: frontmatter `name`, else the file name. */
  name: string;
  source: SubagentSource;
  /** Set for the two writable sources: the scope and file name to address it by. */
  scope?: SubagentScope;
  /** File name without `.md`. Operations name a writable agent by this, not by `name`. */
  file?: string;
  /** Source file shown to the user (project agents are repository content). */
  path?: string;
  packageName?: string;
  /** SHA-256 of the file as read; a write carrying another value is a conflict. */
  hash?: string;
  enabled: boolean;
  description: string;
  color?: string;
  /** False when a higher-priority source defines the same name. */
  active: boolean;
  overrides?: SubagentSource;
  overriddenBy?: SubagentSource;
  skills: SubagentSkills;
  /** Raw `tools:` value; absent means pi-subagents' default (all built-in tools). */
  tools?: string;
  model?: string;
  thinking?: string;
  promptMode: "replace" | "append";
  /** The file body after the closing `---`, without its first line break. */
  prompt: string;
  /** Frontmatter keys this panel does not edit, shown read-only and preserved on save. */
  otherFields: Array<{ key: string; value: string }>;
  /** The file could not be parsed; pi-subagents skips it. */
  error?: string;
}

export interface SubagentSkillInfo {
  name: string;
  /** Attachable: pi-subagents' skill loader resolves this name for the current project. */
  available: boolean;
  /** Found only under the project's own skill roots. */
  projectOnly?: boolean;
  path?: string;
  reason?: string;
}

export interface SubagentManagementData {
  agents: SubagentEntry[];
  skills: SubagentSkillInfo[];
  dirs: Record<SubagentScope, string>;
  /** Whether pi-subagents answered `subagents:rpc:ping`; absent where it cannot be asked (rpc runtime). */
  loaded?: boolean;
  canRun: boolean;
  runUnavailableReason?: string;
}

export interface SubagentChanges {
  description?: string;
  enabled?: boolean;
  skills?: SubagentSkills;
  /** `null` removes the key (default tools). */
  tools?: string | null;
  model?: string | null;
  thinking?: SubagentThinking | null;
  promptMode?: "replace" | "append";
  prompt?: string;
}

export type SubagentManagementOperation =
  | { action: "list" }
  | { action: "create"; scope: SubagentScope; name: string }
  | { action: "duplicate"; from: { source: SubagentSource; name: string }; scope: SubagentScope; name: string }
  | { action: "save"; scope: SubagentScope; name: string; hash: string; changes: SubagentChanges }
  | { action: "rename"; scope: SubagentScope; name: string; to: string; hash: string }
  | { action: "delete"; scope: SubagentScope; name: string; hash: string }
  | { action: "spawn"; type: string; prompt: string };

export interface SubagentManagementReply {
  requestId: string;
  data?: SubagentManagementData;
  error?: string;
  /** The file changed on disk since it was read; `data` holds the current state. */
  conflict?: boolean;
  message?: string;
  /** The agent id pi-subagents returned for a spawn. */
  spawnedId?: string;
}
