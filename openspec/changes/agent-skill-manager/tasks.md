# Tasks

## 1. Server

- [x] 1.1 Add `server/src/subagentFiles.ts`: discovery across the five agent sources with override status, name validation, scope-to-directory resolution, symlink refusal, atomic writes, content hashes; unit tests incl. traversal names, symlinked dir/file, rename collisions (Windows-safe paths).
- [x] 1.2 Frontmatter key-block rewrite preserving unknown keys, comments, order and CRLF; tests pinning byte-exact output for each edited key and for body edits.
- [x] 1.3 Sub-agent skill scan matching pi-subagents' loader (five roots, flat and `SKILL.md` layouts, symlinked roots rejected, dot/`node_modules` skipped) and comparison against the resource inventory; tests.
- [x] 1.4 Extend `server/src/subagentActivity.ts` with `ping()` and `spawn()` over `pi.events` (10 s timeout); tests with a fake event bus for reply, error and timeout.
- [x] 1.5 WebSocket handlers and shared wire types for list/read/save/create/duplicate/rename/delete/spawn scoped to the bound workspace; wire tests incl. conflict and `rpc` runtime refusal.

## 2. UI

- [x] 2.1 `AgentsPanel.tsx` opened from the header Agents button (phone: controls sheet): cards with source, override and enabled state; create, duplicate, rename, delete (confirm), enable toggle.
- [x] 2.2 Agent editor: skills mode + checklist with disabled/flagged entries, tools checklist + extra entries, model, thinking, prompt mode, prompt editor, sandbox disclaimer, conflict reload.
- [x] 2.3 Run dialog with prompt, result id or error; hidden when pi-subagents is not loaded or on `rpc`.
- [x] 2.4 UI unit tests for the panel and editor.

## 3. Verification and docs

- [ ] 3.1 Running-app Playwright: create a project agent, attach/detach skills, rename, disable, run it, and read back the files on disk and the transcript; monkey pass (double save, external edit while open, delete while editing, switch project mid-save, rapid toggles). Done in `scripts/check-agent-manager.mjs` except "switch project mid-save" (server drops the reply for a socket that moved; not exercised in the browser) and the transcript read-back (Run uses a stand-in RPC; no model call).
- [x] 3.2 Scenario-to-test matrix for every scenario in this change, focused and full suites, `openspec validate agent-skill-manager --strict`.
- [x] 3.3 Document the Agents panel (user docs) and the not-a-sandbox note; Documentation impact note in the PR.
