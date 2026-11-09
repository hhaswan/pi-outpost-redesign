# Transfer a CLI session to the web without copying its file

## Intent and implementation evidence

The user requires continuation of the exact CLI JSONL file, not a fork. The current
bridge explicitly keeps the terminal as sole writer and only observes/submits text.
Opening external CLI history also fails the web's normal saved-session allowlist.
OpenLore has no index; targeted source inspection and the installed SDK's complete
extension documentation and lifecycle implementation were used instead.

The SDK supports `ctx.shutdown()`, but it is only a shutdown request.
`session_shutdown` runs before final session disposal and later extension handlers
can still append. Therefore only original process exit is the release barrier.
The transfer is cooperative protection for enrolled CLI processes, not a universal
filesystem lock against arbitrary programs.

## Narrow implementation

1. The terminal operator runs `/outpost-bridge handoff`, separately confirms that
   the terminal will close, and must be idle with no pending input/dialog.
2. The extension persists a private receipt naming the exact cwd, session ID, file,
   bridge instance and original PID, then requests graceful shutdown. It never
   rewrites the conversation. Declining creates no receipt.
3. The web's terminal-session panel lists released receipts for the current project.
   It never treats disappearance or an unreachable endpoint as permission.
4. Continue in web acquires a durable same-user writer lease, but only after the
   original PID is dead, header identity remains valid and no CLI claim remains.
   A per-receipt filesystem mutex serializes acquisitions across servers.
5. The server opens the exact file through its existing runtime switch path.
   Adopted files join the authorized saved-session inventory so restoration after
   web restart still uses the same file. Dead prior web owners may be recovered
   under the mutex; live owners in another server/workspace are refused.
6. A newly enrolled CLI refuses a file reserved by a handoff instead of reopening
   it while the web owns it. Unmodified external writers remain outside this
   cooperative boundary.

## Non-goals and failure behavior

No automatic terminal input granting, remote terminal-dialog answers, history
forking, arbitrary path admission, automatic stale-mutex deletion, or forced CLI
termination. A stale bridge claim still blocks transfer. A crash inside the brief
claim mutex requires operator investigation. A cancelled or failed SDK switch does
not report successful continuation; its reserved receipt remains retryable by the
same workspace. Existing Submit to CLI remains a separate operation with submitted,
not completed, feedback.
