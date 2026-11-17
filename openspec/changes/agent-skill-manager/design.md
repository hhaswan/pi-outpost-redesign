# Design

## Context

OpenLore is not installed on this host, so evidence comes from `rg` and reads.

pi-subagents (`/root/.pi/agent/npm/node_modules/@tintinweb/pi-subagents/src`):

- `custom-agents.ts`: load order package < global `getAgentDir()/agents` (honours
  `PI_CODING_AGENT_DIR`) < `<cwd>/.agents/agents` < `<cwd>/.pi/agents`; later wins by name. Agent
  name = frontmatter `name` or the file's basename. `enabled: false` disables. `skills` (also
  `inherit_skills`): omitted/`true` inherit all, `false`/`none`/empty none, CSV listed names.
  Built-in defaults (`default-agents.ts`) exist without files and rank below every file.
- `skill-loader.ts`: a listed skill is looked up by name in `<cwd>/.pi/skills`,
  `<cwd>/.agents/skills`, `getAgentDir()/skills`, `~/.agents/skills`, `~/.pi/skills`, as
  `<root>/<name>.md` or a directory `<name>/SKILL.md` at any depth; symlinked roots are rejected,
  dot entries and `node_modules` skipped. A missing skill becomes a "not found" note in the prompt.
- `memory.ts` `isUnsafeName`: names must match `^[a-zA-Z0-9][a-zA-Z0-9._-]*$`, at most 128 chars.
- `agent-file-toggle.ts`: the package's own `/agents` command edits `enabled:` by line edits.
- `cross-extension-rpc.ts:111`: `subagents:rpc:spawn` `{ requestId, type, prompt, options }`,
  reply on `subagents:rpc:spawn:reply:<requestId>`; `subagents:rpc:ping` returns the protocol
  version. Files are re-read on every Agent call.

pi-outpost: `server/src/subagentActivity.ts` is an extension factory installed in every embedded
session (`index.ts` `extensionFactories`) that already listens on the runtime's private `pi.events`.
Skills applicable to a project are inventoried by `agent-resource-management`, including skills from
enrolled repositories under `~/.config/pi-outpost/resource-repositories`, which pi-subagents' loader
does not search.

## Goals / Non-Goals

Goals: manage agent files and their skills from the UI with the same semantics pi-subagents applies.
Non-goals: a security boundary; editing package or built-in agents in place; managing `memory`,
`isolation`, `inherit_context`, `run_in_background`, `max_turns`, `color`, `disallowed_tools` and
other fields beyond preserving them (shown read-only); drag-and-drop (a checklist works on touch and
keyboard; it can be added later); live result streaming of spawned agents (pi-subagents' own widgets
and notifications already report them).

## Decisions

- **Writable scopes**: exactly two directories, `global = <agentDir>/agents` and
  `project = <workspace root>/.pi/agents`, where `agentDir` is the one pi-outpost passes to the
  runtime. `<root>/.agents/agents`, package and built-in agents are listed read-only with a
  "Duplicate to global/project" action.
- **Confinement**: the client sends `{ scope, name }`, never a path. The server validates the name
  with the `isUnsafeName` rule, builds `<dir>/<name>.md`, requires the real path of `<dir>` to equal
  the expected directory (no symlinked directory), refuses a symlinked target file (`lstat`), and
  writes atomically (temp file in the same directory, then rename). Missing directories are created.
  Delete moves nothing outside the directory; it unlinks the file.
- **Identity**: agents created by the panel keep `name:` equal to the file basename. Rename changes
  both (refused when the target exists in that scope). A file whose declared `name` differs from its
  basename is shown under its declared name with the file name visible.
- **Optimistic concurrency**: every read returns a SHA-256 of the file; every write carries it; a
  mismatch answers `conflict` and the UI reloads the file before the user retries.
- **Frontmatter editing**: parse for display with the same YAML frontmatter parser pi uses. Rewrite
  by top-level key blocks: a key block is its line plus following indented lines. Changing a known
  key replaces only its block with a canonical scalar (`key: value`, quoted when YAML needs it);
  removing it deletes only its block; adding appends before the closing `---`. All other bytes,
  comments, unknown keys, key order and the file's line ending are preserved. The body (system
  prompt) is replaced as text after the closing `---`.
- **Skills**: the attachable list is computed server-side by scanning the five pi-subagents roots
  with the same rules (flat `.md`, `SKILL.md` directories, symlinked roots rejected, dot entries and
  `node_modules` skipped) for the current project. Skills from the general inventory that this scan
  does not find are listed disabled with "not available to sub-agents (outside sub-agent skill
  roots or behind a symlink)". Modes: All (remove `skills:`), None (`skills: false`), Selected (CSV;
  an empty selection writes `skills: false`). Attached names that do not resolve are flagged. A
  global agent attached to a project-only skill shows "resolves only in projects that contain it".
- **Tools**: checklist of pi built-ins (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) plus
  "all"; other existing entries (extension selectors, MCP patterns) are kept verbatim in an extra
  text field. Written as CSV in `tools:`.
- **Model/thinking**: model chosen from the project's available models or "inherit" (removes the
  key); thinking from `off|minimal|low|medium|high|xhigh` or "inherit". `prompt_mode` toggle
  `replace|append`.
- **Enable/disable** writes `enabled: false` or removes the key, as pi-subagents' own toggle does.
- **Run in this project**: extend `subagentActivity.ts` with `ping()` and `spawn(type, prompt)` on
  the same `pi.events`, with a 10 s reply timeout. The panel pings when opened; no reply shows
  "pi-subagents is not loaded in this project" and hides editing actions that depend on it. Spawn
  is offered only on the `embedded` runtime and only for enabled agents; the reply's agent id or
  error is shown. Spawned agents report through pi-subagents' existing activity, which pi-outpost
  already surfaces.
- **Wire**: one WebSocket message, `subagent_management { requestId, operation }`, scoped to the
  connection's bound workspace, with operations `list`, `create`, `duplicate`, `save`, `rename`,
  `delete` and `spawn`; the reply `subagent_management_result` carries the refreshed list after
  every mutation (and on a conflict). This follows the existing `mcp_management` pattern rather
  than seven message types. Operations run one at a time in the server. No HTTP routes.
- **Entry point**: an **Agents** button in the wide header and in the phone's "More controls"
  sheet (not Settings). Phone: full-screen sheet; wider screens: a dialog. Touch targets follow
  `ui/src/touch.ts`.
- **Package and built-in tiers without importing package code**: package agents are found from
  pi's configured packages (`DefaultPackageManager.listConfiguredPackages`) and their
  `pi.subagents` / `pi-subagents` declarations, resolved as `package-resources.ts` does (exact
  paths, `!` exclusions, inside the package). Built-in defaults are read from the installed
  package's `dist/default-agents.js`, which has no imports; when it cannot be loaded (for example
  inside a standalone executable) no built-ins are listed. The package's project-trust gate and
  `packageAgents` setting are not mirrored (marked `shortcut:` in the code).
- **Skill checklist interaction**: ticking or clearing a box while in "All skills" or "No
  skills" switches to a selection that starts from what was shown, so one tap works on touch.
- **Ping timing**: the list pings with a 2 s timeout (pi-subagents answers in-process at once);
  Run pings first and then waits up to 10 s for the spawn reply.
- **Verification against the real package**: a test (`server/test/subagentPackageAccept.test.ts`)
  and the running-app probe load the written files with the installed package's own
  `loadCustomAgents` and `preloadSkills` through jiti; skipped where the package is absent.

## Security

Tool and skill limits only shape what a sub-agent is offered. They are not a sandbox: a sub-agent
with `bash` can read any file the server user can, including skills it was not given, and every
sub-agent runs with the parent runtime's privileges. Editing an agent file is equivalent to editing
a prompt the agent will act on with full power, so the panel is available to the same signed-in user
as the rest of Settings. Project agents are repository content: a cloned repository may ship
`.pi/agents/*.md`, so the panel always shows each agent's source file. Path confinement protects the
server from a malformed or hostile request writing outside the two agent directories; it does not
limit what the agents themselves can do.

## Risks / Trade-offs

- pi-subagents may change its file format or roots; the scan rules are isolated in one module with
  tests that pin the documented behaviour, and unknown keys are preserved.
- Key-block rewriting does not reformat YAML; exotic forms of a known key (anchors, multi-document)
  are replaced by the canonical scalar only when the user edits that key.
