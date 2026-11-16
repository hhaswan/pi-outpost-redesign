## Implementation and proof

- [x] Reconcile the user decision, the handoff change and the SDK append/re-read behaviour.
- [x] Add the shared re-read primitive and `EmbeddedRuntime.syncFromFile()`; sync before prompts and on an idle file watch with poll fallback; broadcast `session_synced`.
- [x] Re-read in the terminal bridge on input and on an idle watch; notify the terminal.
- [x] Write new web sessions to the CLI's per-project directory; list, open, rename and delete CLI history.
- [x] Remove handoff, reservation, adoption and lease code, UI, tests, probe steps and docs.
- [x] Cover every scenario: unit, wire and the real PTY/browser probe `scripts/check-shared-session.mjs`.
- [x] Run the UI suite, affected server tests, build, probes and strict OpenSpec validation.
- [x] Cache CLI-directory message counts and transcript text per file version in the background; search covers it.
- [x] Test a real branch from another writer (unit and wire).
- [x] RPC runtime: reload the same file in the child when it grew, before a prompt and on the idle watch.
- [x] Route web prompts to a live bridged CLI on the same file (default grant, revoke per CLI, busy follow-up, Stop, live event stream, fallback only when not delivered); unit, wire and real PTY proof.
- [ ] Deploy through `scripts/update-custom-native.sh` after commit.
