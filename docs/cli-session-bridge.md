# Opt-in CLI session bridge

The bridge observes an existing Pi terminal runtime without creating another agent or writing its session JSONL. A separately confirmed handoff can close the CLI and let Outpost continue the exact original file, as described below. An unmodified CLI cannot be attached retroactively. Load the extension explicitly when starting a terminal session:

```sh
pi -e /absolute/path/to/pi-outpost/extensions/cli-session-bridge.ts
```

The build also ships a standalone `dist/extensions/cli-session-bridge.mjs`; it can be passed to `pi -e` without this source tree. For automatic discovery in future terminal sessions, copy that bundle to `~/.pi/agent/extensions/pi-outpost-cli-bridge.js` (mode 0600). Pi auto-discovers global `*.js` and `*.ts` files, **not** `*.mjs`; the bundled JavaScript is also valid under the `.js` name. For the native root-owned deployment, this copy has already been installed. Existing terminal sessions need `/reload` while idle to load it; no process is remotely reloaded. A Pi CLI running as another OS user needs its own compatible installation and a secure, shared bridge registry before the root-owned server can discover it.

The build itself installs nothing globally. The extension starts its endpoint only on `session_start` in TUI mode, not during module loading or SDK discovery. It uses type-only imports from the installed SDK and `shared/src/cliBridge.ts`; these imports disappear under the extension loader. Keep the repository layout when distributing the source.

## Consent and ownership

Observation is enabled by loading the extension. Input is disabled by default. In the terminal, run `/outpost-bridge allow` and confirm the dialog to permit authorized web operators to submit text while the CLI is idle. Run `/outpost-bridge revoke` to withdraw permission. Revocation prevents new submissions, not work already submitted. Grants do not survive runtime replacement or tree navigation.

The CLI remains the sole writer until its operator explicitly releases the session and the process exits. Browser disconnects do not stop it. Dialogs, tool approvals, authentication prompts, and custom terminal screens stay in the terminal. Input may cause the agent to execute tools with the CLI user's permissions; granting input is not a sandbox. **Submitted to CLI** means the bridge accepted the text, not that Pi accepted the input or completed a model turn. If nothing appears afterward, check the actual CLI terminal for a provider/authentication error or an extension that handled the input; do not submit again automatically.

## Continue the same session file in web

1. If the CLI was already running before this update, run `/reload` while idle.
2. In that CLI, run `/outpost-bridge handoff` and confirm the separate warning.
   **This closes the CLI.** It does not grant remote input or copy/fork history.
3. In Outpost select the same project, open **Terminal sessions**, and click
   **Refresh list**. Under **Continue a CLI session in web**, wait until it says
   **Released; ready to continue**, then click **Continue in web**.
4. The panel closes when the actual session changes. Continue in the web composer.
   The session ID and original JSONL path remain the same. Continuation uses the
   web server's configured tools and credentials, not a copied CLI environment.

The command refuses a working CLI, SDK-queued messages, a terminal dialog, or a
session that changes during confirmation. A fresh CLI with no persisted file
cannot be handed off. An unresolved bridge submission reservation does not turn
into an accepted message: the handoff confirmation explicitly warns that submitted
text without a transcript entry may be absent from history. Handoff never resends
that text. It closes the original process before authorizing a new writer.

Shutdown notification is not a release barrier. Other extension shutdown handlers
can still append. Outpost waits until the original PID is no longer alive, then
validates the file/header identity and acquires an exclusive web writer lease.
An unreachable bridge or missing registration alone never grants ownership. A
remaining stale CLI claim still blocks continuation and requires investigation.
A cancelled or failed SDK switch does not report continuation as successful.

Receipts live in `PI_OUTPOST_HANDOFF_DIR`, default `~/.pi/outpost-handoffs`.
CLI and web must share that same private directory, OS account, and PID/network
namespaces. Linux receipts record `/proc/self/ns/pid`; mismatched or unavailable
PID namespace evidence fails closed. A container-local PID must never be treated
as a host PID. Keep the CLI and web in the same supported environment rather than
weakening container isolation to bypass this check. Directory mode
is 0700 and receipt mode is 0600 on POSIX; use account-only ACLs on Windows.
The browser receives only project/session identity and releasing/ready/owned state,
not original or web owner PIDs. A filesystem mutex serializes claims. A live lease
in another server/workspace refuses a second writer. Adoption and later restoration are supported only
from an idle project's **main workspace**, not a side session.

Adopted files appear in the normal saved-session inventory, so server restart and
session restoration still use the original file. A dead prior web owner's lease
can be recovered under the claim mutex. Renaming uses the owning runtime/lease;
deletion is deliberately refused while a handoff receipt reserves the original file.

Enrolled CLIs refuse normal operation on a reserved file and cancel supported
runtime resume operations before switching. This veto is TUI-only: when the same
extension is auto-discovered by the web runtime in RPC mode, it must not reject
the web owner after the server has validated and acquired the lease. This is **cooperative protection, not
an OS-wide file lock**. Do not independently launch `pi --session`, `--continue`, an
unmodified CLI, or extensions that directly write a web-owned file. SDK startup
loads a selected file before extension startup checks run; an SDK format migration
or unrelated raw-file writer is outside this bridge's guarantee. The transfer
itself proves that its original CLI process has exited before web writes begin.

If a web process crashes inside the short claim critical section, the empty
`.<receipt-id>.lock` directory is retained rather than automatically stolen.
For explicit recovery: stop **all** Outpost instances using that handoff directory,
verify the receipt's original PID and any web owner PID have exited, investigate
any remaining CLI registration, then remove **only that empty mutex with `rmdir`**.
Do not delete the receipt or conversation. A nonempty mutex is unsafe and must not
be recursively removed. Restart Outpost and retry continuation. Do not perform
this recovery while another server or CLI can still use the file.

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
node --import tsx --test extensions/cli-session-bridge.test.ts
```

The extension tests cover registration, authentication, limits, consent, revocation, idempotency and confirmed handoff. `server/test/cliHandoffStore.test.ts` covers real child-PID barriers, lease contention, unsafe metadata and restart recovery. `server/test/cli-handoff-wire.test.mjs` drives actual server processes, exact-file persistence, cancellation and cross-server competition. On Linux with python3 and Playwright Chromium installed, build the CLI and run `node scripts/check-cli-handoff.mjs` to exercise a real TUI, reload, browser Submit, a late shutdown append while web remains blocked, and exact-file continuation after PID exit. No model request is sent. Backend and UI tests cover unreachable owners and mutation refusal. An isolated real Pi TUI plus browser test exercises terminal confirmation, observation, one intercepted submission, reload and owner disappearance without a model request. This proves delivery to the extension input boundary, **not** that a provider completes a model response in a user's live CLI; check that terminal for errors.

## Web access

Open **Terminal sessions**, select the owner and read its transcript. The view refreshes the selected owner periodically, preserving unsent drafts. Submit status and errors appear beside the button. If a refresh is still checking CLI status when you press Submit, the view preserves the draft and asks you to try again after the check, without sending input. A transport failure disables submission; check the terminal before retrying an uncertain send. The server refuses this host-wide bridge under sandbox, extension-lock, or workspace-lock policy. Registry credentials stay on the server.
