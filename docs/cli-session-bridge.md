# Opt-in CLI session bridge

The bridge observes an existing Pi terminal runtime. It never creates an agent, resumes a session, or writes the session JSONL file. An unmodified CLI cannot be attached retroactively. Load the extension explicitly when starting a terminal session:

```sh
pi -e /absolute/path/to/pi-outpost/extensions/cli-session-bridge.ts
```

The build also ships a standalone `dist/extensions/cli-session-bridge.mjs`; it can be passed to `pi -e` without this source tree. For automatic discovery in future terminal sessions, copy that bundle to `~/.pi/agent/extensions/pi-outpost-cli-bridge.js` (mode 0600). Pi auto-discovers global `*.js` and `*.ts` files, **not** `*.mjs`; the bundled JavaScript is also valid under the `.js` name. For the native root-owned deployment, this copy has already been installed. Existing terminal sessions need `/reload` while idle to load it; no process is remotely reloaded. A Pi CLI running as another OS user needs its own compatible installation and a secure, shared bridge registry before the root-owned server can discover it.

The build itself installs nothing globally. The extension starts its endpoint only on `session_start` in TUI mode, not during module loading or SDK discovery. It uses type-only imports from the installed SDK and `shared/src/cliBridge.ts`; these imports disappear under the extension loader. Keep the repository layout when distributing the source.

## Consent and ownership

Observation is enabled by loading the extension. Input is disabled by default. In the terminal, run `/outpost-bridge allow` and confirm the dialog to permit authorized web operators to submit text while the CLI is idle. Run `/outpost-bridge revoke` to withdraw permission. Revocation prevents new submissions, not work already submitted. Grants do not survive runtime replacement or tree navigation.

The CLI remains the sole writer. Browser disconnects do not stop it. Dialogs, tool approvals, authentication prompts, and custom terminal screens stay in the terminal. Input may cause the agent to execute tools with the CLI user's permissions; granting input is not a sandbox. **Submitted to CLI** means the bridge accepted the text, not that Pi accepted the input or completed a model turn. If nothing appears afterward, check the actual CLI terminal for a provider/authentication error or an extension that handled the input; do not submit again automatically.

## Private protocol

The registry is `PI_OUTPOST_BRIDGE_DIR`, or `~/.pi/outpost-bridges` by default. Outpost and the CLI must use the same directory and OS account. Each process writes `<instanceId>.json` using the shared `CliBridgeRegistration` contract. Updates use a private temporary file and atomic rename. POSIX directory permissions are 0700 and files are 0600. Existing unsafe ownership, permissions, symlink directories, and unsafe ancestors are refused, not repaired. Root-owned sticky temporary directories are allowed as ancestors. On Windows, Node cannot enforce equivalent POSIX ownership checks; operators must secure the directory with account-only ACLs. Do not place it on a shared or untrusted filesystem.

The HTTP server binds only `127.0.0.1` on an OS-selected port. Both routes require the random bearer credential from the private registration. Origin-bearing requests are refused; this is a server-to-server endpoint, not a browser API. Credentials are never logged or included in snapshots. Transcript text itself may contain sensitive user or tool content; enrollment authorizes its observation and does not redact arbitrary secrets from conversation text.

- `GET /snapshot`: `CliBridgeSnapshot`, at most 512 KiB of encoded JSON. Reads the active branch through the supported read-only session manager, plus the latest partial assistant message. At most 100 entries and 60,000 transcript characters are returned. Images, thinking, hidden metadata, and tool arguments are omitted. `truncated` marks bounded history. This is a readable excerpt, not a lossless export or terminal screen mirror.
- `POST /submit`: `{generation,inputId,text}`, at most 16 KiB encoded, text at most 8,000 UTF-16 code units. IDs contain 1–128 ASCII letters, digits, underscores, or hyphens. Blank text and leading whitespace followed by `/` or `!` are refused. The bridge calls `pi.sendUserMessage(text, {expandPromptTemplates:false})`; it does not expose tools, shell commands, or terminal answers. Other installed extensions retain their normal ability to transform or intercept plain text.

Submission reserves the owner synchronously before calling the SDK. `{submitted:true}` means only that submission was attempted, not that input was accepted, persisted, or completed. Identical IDs and text return the original acknowledgment without sending again; changed text under an existing ID is refused. IDs remain remembered for the generation, up to 4,096 submissions, after which new input fails closed.

Busy owners, queued input, UI prompts, stale generations, and ungranted input are refused. A reservation releases after a matching actual user-message event or `agent_settled`, never merely `agent_end`. If an input extension consumes text without those events, the reservation remains. After 30 seconds its activity becomes `waiting`: the outcome is uncertain, and input remains blocked. There is no automatic timeout release or blind resend. Inspect the terminal; a genuine settled event or an explicit session/tree change establishes a fresh boundary. A synchronous SDK error also leaves the reservation blocked and the ID recorded as uncertain. Transport failures likewise require observation, not a new request ID and automatic resend.

Runtime replacement closes the old endpoint and creates a new instance and generation. Tree navigation rotates generation and revokes consent. Registration identity is updated atomically, including when the first persisted message creates a session file. Remote consumers must discard cached generations after a change.

## Shutdown and stale claims

Normal shutdown closes all connections and removes only an unchanged, owned registration. A crash, forced kill, permission change, or replaced registration can leave a stale claim. An unreachable endpoint is not evidence that its session is idle or safe to modify. Investigate the terminal/process before manually removing a stale registration. Outpost's saved-session protections must retain unreachable claims; these cooperative claims are not universal locks against unmodified external CLI writers.

Web discovery, authenticated authorization, sandbox policy, unreachable-state UI, and saved-session write protection are implemented by Outpost separately. This extension alone does not enforce those browser/server policies.

## Verification

Run the fake-context tests against real loopback HTTP without credentials or model calls:

```sh
node --test extensions/cli-session-bridge.test.ts
```

The extension tests cover registration, authentication, limits, consent, revocation and idempotency. Backend and UI tests cover unreachable owners and mutation refusal. An isolated real Pi TUI plus browser test exercises terminal confirmation, observation, one intercepted submission, reload and owner disappearance without a model request. This proves delivery to the extension input boundary, **not** that a provider completes a model response in a user's live CLI; check that terminal for errors.

## Web access

Open **Terminal sessions**, select the owner and read its transcript. The view refreshes the selected owner periodically, preserving unsent drafts. Submit status and errors appear beside the button. If a refresh is still checking CLI status when you press Submit, the view preserves the draft and asks you to try again after the check, without sending input. A transport failure disables submission; check the terminal before retrying an uncertain send. The server refuses this host-wide bridge under sandbox, extension-lock, or workspace-lock policy. Registry credentials stay on the server.
