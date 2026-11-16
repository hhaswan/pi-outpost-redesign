# Opt-in CLI session bridge

The bridge observes an existing Pi terminal runtime without creating another agent, and keeps a terminal and Outpost web in step when both write the same session JSONL (see [Shared session files](#shared-session-files)). An unmodified CLI cannot be attached retroactively. Load the extension explicitly when starting a terminal session:

```sh
pi -e /absolute/path/to/pi-outpost/extensions/cli-session-bridge.ts
```

The build also ships a standalone `dist/extensions/cli-session-bridge.mjs`; it can be passed to `pi -e` without this source tree. For automatic discovery in future terminal sessions, copy that bundle to `~/.pi/agent/extensions/pi-outpost-cli-bridge.js` (mode 0600). Pi auto-discovers global `*.js` and `*.ts` files, **not** `*.mjs`; the bundled JavaScript is also valid under the `.js` name. For the native root-owned deployment, this copy has already been installed. Existing terminal sessions need `/reload` while idle to load it; no process is remotely reloaded. A Pi CLI running as another OS user needs its own compatible installation and a secure, shared bridge registry before the root-owned server can discover it.

The build itself installs nothing globally. The extension starts its endpoint only on `session_start` in TUI mode, not during module loading or SDK discovery. It uses type-only imports from the installed SDK and `shared/src/cliBridge.ts`, and imports `shared/src/sessionSync.ts`, which the build bundles in. Keep the repository layout when distributing the source.

## Consent

Observation is enabled by loading the extension. Input is disabled by default. In the terminal, run `/outpost-bridge allow` and confirm the dialog to permit authorized web operators to submit text while the CLI is idle. Run `/outpost-bridge revoke` to withdraw permission. Revocation prevents new submissions, not work already submitted. Grants do not survive runtime replacement or tree navigation.

Browser disconnects do not stop the CLI. Dialogs, tool approvals, authentication prompts, and custom terminal screens stay in the terminal. Input may cause the agent to execute tools with the CLI user's permissions; granting input is not a sandbox. **Submitted to CLI** means the bridge accepted the text, not that Pi accepted the input or completed a model turn. If nothing appears afterward, check the actual CLI terminal for a provider/authentication error or an extension that handled the input; do not submit again automatically.

## Shared session files

Outpost web and the Pi CLI may open and write the **same** session file at the same
time. There is no handoff, lock or reservation.

- New web conversations are written to the Pi CLI's per-project directory
  (`<agentDir>/sessions/--<cwd>--/`), so `pi -c` and `/resume` in the project list
  them. Older web conversations in the flat `<agentDir>/sessions/` stay readable
  where they are; nothing is migrated.
- The Pi CLI history of the project is listed in the web session menu like any
  session: open, rename and delete it from there. Deleting is refused while a
  bridged CLI has the file open.
- Each side appends one line per entry. Between turns each side re-reads the file
  when it grew: web on every prompt and when the file changes while idle (a file
  watch, with a two-second poll as fallback); the terminal on every prompt and on
  the same watch while idle. The next entry then chains after the other writer's
  last entry, and the next model request includes the other side's messages.
- The web conversation updates in place, without a reload. The terminal does not
  redraw its scrollback; it shows `Synced N new messages from Outpost web`.
- Neither side re-reads during a running turn. If both send at the same moment,
  the conversation tree may branch; the file stays valid and both sides keep working.
- Two Outpost tabs of one server still cannot have one conversation live in two of
  its sessions at once.
- Only the default embedded runtime re-reads; under `agentRuntime.mode: "rpc"` web
  sees CLI turns after reopening the session.

## Private protocol

The registry is `PI_OUTPOST_BRIDGE_DIR`, or `~/.pi/outpost-bridges` by default. Outpost and the CLI must use the same directory and OS account. Each process writes `<instanceId>.json` using the shared `CliBridgeRegistration` contract. Updates use a private temporary file and atomic rename. POSIX directory permissions are 0700 and files are 0600. Existing unsafe ownership, permissions, symlink directories, and unsafe ancestors are refused, not repaired. Root-owned sticky temporary directories are allowed as ancestors. On Windows, Node cannot enforce equivalent POSIX ownership checks; operators must secure the directory with account-only ACLs. Do not place it on a shared or untrusted filesystem.

The HTTP server binds only `127.0.0.1` on an OS-selected port. Both routes require the random bearer credential from the private registration. Origin-bearing requests are refused; this is a server-to-server endpoint, not a browser API. Credentials are never logged or included in snapshots. Transcript text itself may contain sensitive user or tool content; enrollment authorizes its observation and does not redact arbitrary secrets from conversation text.

- `GET /snapshot`: `CliBridgeSnapshot`, at most 512 KiB of encoded JSON. Reads the active branch through the supported read-only session manager, plus the latest partial assistant message. At most 100 entries and 60,000 transcript characters are returned. Images, thinking, hidden metadata, and tool arguments are omitted. `truncated` marks bounded history. This is a readable excerpt, not a lossless export or terminal screen mirror.
- `POST /submit`: `{generation,inputId,text}`, at most 16 KiB encoded, text at most 8,000 UTF-16 code units. IDs contain 1–128 ASCII letters, digits, underscores, or hyphens. Blank text and leading whitespace followed by `/` or `!` are refused. The bridge calls `pi.sendUserMessage(text, {expandPromptTemplates:false})`; it does not expose tools, shell commands, or terminal answers. Other installed extensions retain their normal ability to transform or intercept plain text.

Submission reserves the owner synchronously before calling the SDK. `{submitted:true}` means only that submission was attempted, not that input was accepted, persisted, or completed. Identical IDs and text return the original acknowledgment without sending again; changed text under an existing ID is refused. IDs remain remembered for the generation, up to 4,096 submissions, after which new input fails closed.

Busy owners, queued input, UI prompts, stale generations, and ungranted input are refused. A reservation releases after a matching actual user-message event or `agent_settled`, never merely `agent_end`. If an input extension consumes text without those events, the reservation remains. After 30 seconds its activity becomes `waiting`: the outcome is uncertain, and input remains blocked. There is no automatic timeout release or blind resend. Inspect the terminal; a genuine settled event or an explicit session/tree change establishes a fresh boundary. A synchronous SDK error also leaves the reservation blocked and the ID recorded as uncertain. Transport failures likewise require observation, not a new request ID and automatic resend.

Runtime replacement closes the old endpoint and creates a new instance and generation. Tree navigation rotates generation and revokes consent. Registration identity is updated atomically, including when the first persisted message creates a session file. Remote consumers must discard cached generations after a change.

## Shutdown and stale claims

Normal shutdown closes all connections and removes only an unchanged, owned registration. A crash, forced kill, permission change, or replaced registration can leave a stale claim. An unreachable endpoint is not evidence that its session is idle. Investigate the terminal/process before manually removing a stale registration. Outpost refuses to delete a file a registration claims, reachable or not.

Web discovery, authenticated authorization, sandbox policy, unreachable-state UI, and the delete refusal are implemented by Outpost separately. This extension alone does not enforce those browser/server policies.

## Verification

Run the fake-context tests against real loopback HTTP without credentials or model calls:

```sh
node --import tsx --test extensions/cli-session-bridge.test.ts
```

The extension tests cover registration, authentication, limits, consent, revocation and idempotency. `server/test/sessionSync.test.ts` covers re-reading a file another writer appended to, chaining after it, keeping a navigated leaf, and never re-reading mid-turn (web runtime and terminal `input` hook). `server/test/sharedSessionWire.test.mjs` drives a real server with a fake provider: per-project storage, live sync without reload, a chained web prompt the model sees, nothing mid-turn, and opening/renaming CLI history. On Linux with python3 and Playwright Chromium installed, build the CLI and run `node scripts/check-shared-session.mjs`: a real TUI started with `pi -c` and the built web app alternate turns on one file through a local fake Anthropic endpoint (no model spend), the file stays one linear chain, a simultaneous send keeps both sides working, and `/reload` plus **Submit to CLI** still work.

## Web access

Open **Terminal sessions**, select the owner and read its transcript. The view refreshes the selected owner periodically, preserving unsent drafts. Submit status and errors appear beside the button. If a refresh is still checking CLI status when you press Submit, the view preserves the draft and asks you to try again after the check, without sending input. A transport failure disables submission; check the terminal before retrying an uncertain send. The server refuses this host-wide bridge under sandbox, extension-lock, or workspace-lock policy. Registry credentials stay on the server.
