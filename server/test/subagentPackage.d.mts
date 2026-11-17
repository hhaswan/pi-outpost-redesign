/** Types for subagentPackage.mjs. */

export const SUBAGENTS_ROOT: string;
export function subagentsInstalled(): boolean;
/** The installed package's own loaders; `undefined` when it is not installed. Its configs are the package's `AgentConfig`. */
export function installedSubagents(agentDir: string): Promise<{
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  load(cwd: string): Map<string, any>;
  preloadSkills(names: string[], cwd: string): Array<{ name: string; content: string }>;
} | undefined>;
