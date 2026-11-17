/**
 * The installed @tintinweb/pi-subagents, loaded as pi loads it: through jiti, with the SDK
 * handed in as an already-loaded module. Lets tests and probes ask the real package whether
 * it accepts the files the Agents panel writes. `undefined` when the package is not installed.
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

export const SUBAGENTS_ROOT = process.env.PI_SUBAGENTS_PACKAGE
  ?? path.join(os.homedir(), ".pi", "agent", "npm", "node_modules", "@tintinweb", "pi-subagents");

export function subagentsInstalled() {
  return existsSync(path.join(SUBAGENTS_ROOT, "dist", "custom-agents.js"));
}

/** The package's own loaders, with `getAgentDir()` pointed at `agentDir`. */
export async function installedSubagents(agentDir) {
  if (!subagentsInstalled()) return undefined;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const sdk = await import("@earendil-works/pi-coding-agent");
  const jiti = createJiti(import.meta.url, { virtualModules: { "@earendil-works/pi-coding-agent": sdk }, moduleCache: false });
  const agents = await jiti.import(path.join(SUBAGENTS_ROOT, "dist", "custom-agents.js"));
  const skills = await jiti.import(path.join(SUBAGENTS_ROOT, "dist", "skill-loader.js"));
  return {
    /** Every custom agent the package loads for `cwd`, strict so a broken file throws. */
    load: (cwd) => agents.loadCustomAgents(cwd, true, { packageDirs: [], packageFiles: [] }),
    preloadSkills: (names, cwd) => skills.preloadSkills(names, cwd),
  };
}
