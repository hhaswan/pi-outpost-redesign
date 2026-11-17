# Proposal

## Why

The installed `@tintinweb/pi-subagents` package defines sub-agents as Markdown files with YAML
frontmatter (`~/.pi/agent/agents/*.md` globally, `<project>/.pi/agents/*.md` per project; project
overrides global by name). Choosing which skills, tools, model and prompt an agent gets currently
means hand-editing those files on the server, which is impractical from the iPad and error-prone
(a `skills:` typo silently loads nothing). pi-outpost already inventories skills and manages
agent resources; it should let the user manage sub-agents and their skills from the web UI.

## What Changes

- An **Agents** panel, opened from an **Agents** header button (and from the phone's "More
  controls" sheet; a full-screen sheet on a phone, a dialog on wider screens), listing the sub-agents visible to the current project, with
  their source (global, project, shared `.agents/agents`, package, built-in) and override status.
- **Create, duplicate, rename, delete, enable/disable** agent files in the two writable scopes
  (global and current project). Read-only sources can be duplicated into a writable scope.
- **Skills checklist** to attach and detach skills: "All skills" (omit `skills:`), "No skills"
  (`skills: false`), or a selection (`skills: a, b`). Only skills that pi-subagents can actually
  resolve for the project are attachable; others are shown disabled with the reason.
- **Tools allow-list**, **model**, **thinking** and a **system-prompt editor** (the file body).
- **Run in this project**: spawn the agent with a prompt through pi-subagents' cross-extension RPC
  (`subagents:rpc:spawn`) on the project's embedded runtime.
- Rewrites preserve every frontmatter key the panel does not edit, comments and line endings;
  writes are confined to the two agent directories, names are validated, and concurrent external
  edits are detected.
- The panel states that tool and skill limits shape behaviour but are not a security sandbox.

## Capabilities

### New Capabilities

- `subagent-manager`: discovery and display of sub-agent definitions, confined file operations,
  frontmatter-preserving edits, skill attachment, tools/model/thinking/prompt editing, and spawning.

### Modified Capabilities

None. `agent-resource-management` (skill/extension repositories) is reused for skill metadata but
its behaviour does not change.

## Impact

- **Server**: new `server/src/subagentFiles.ts` (discovery, confinement, frontmatter edit),
  one WebSocket message handler in `server/src/index.ts`, spawn/ping RPC added to
  `server/src/subagentActivity.ts` (already holds the runtime's `pi.events`), shared wire types in
  `@pi-outpost/shared`.
- **UI**: new `ui/src/components/AgentsPanel.tsx` opened from `Header.tsx` (wide header and the
  compact header's controls sheet); `useAgent.ts` wire handling.
- **Tests**: server unit and wire tests, UI tests, running-app Playwright.
- **No new dependencies.** No change to pi-subagents itself; it re-reads agent files on every
  Agent call, so edits apply without a restart.
- **Not available** when pi-subagents is not loaded, and "Run" is unavailable on the `rpc` runtime.
