# Share one session file between Outpost web and the Pi CLI

## Why

`handoff-cli-session-ownership` made the CLI and web exclusive writers of a session
file: continuing a conversation on the other side took an explicit handoff, a closed
CLI, receipts, reservations and leases. The user found the steps too heavy and
decided, accepting the risk, that web and CLI may both open and write the same JSONL
at once. A rare simultaneous turn may branch the conversation tree; that is accepted.

This change **supersedes the exclusivity of `handoff-cli-session-ownership`**. Its
handoff, reservation, adoption and lease requirements are removed (see the
`cli-session-handoff` delta); its bridge observation and Submit to CLI stay.

## Implementation evidence

OpenLore was not available; targeted inspection of the SDK replaced it.

- `SessionManager` appends each entry with one `appendFileSync` line.
  `setSessionFile(sameFile)` re-reads the file in place, rebuilds the index and puts
  the leaf on the last entry, so the next append chains after the other writer.
- `AgentSession` builds every model request from
  `sessionManager.buildSessionProjection()` (`_installAgentRequestProjection`), so a
  re-read before a prompt is enough for the model to see the other side's messages;
  no `context` hook is needed. `refreshContext()` rebuilds the transcript the web shows.
- Extension `input` handlers run before the prompt's user message is persisted.

## What changes

- A shared primitive (`shared/src/sessionSync.ts`) re-reads the file when it holds
  more complete lines than entries in memory, and keeps a leaf the user moved off
  the tip.
- Web: `EmbeddedRuntime.syncFromFile()` (idle only), called before every prompt and
  from a debounced `fs.watch` with a two-second poll fallback. An idle change is
  broadcast as `session_synced` — the transcript only, same session id, no snapshot.
- CLI bridge (terminal mode): re-reads on `input` and on a watch/poll while idle, and
  notifies `Synced N new messages from Outpost web`.
- New web sessions are written to the Pi CLI's per-project directory; the flat
  directory is still read. CLI history of the project is listed, opened, renamed and
  deleted like any session.
- Removed: `/outpost-bridge handoff`, the CLI startup and resume vetoes, receipts,
  reservations, adoption, leases, the CLI process scan, the handoff UI sections and
  server actions `resume`, `release`, `reclaim`, `adopt`.
- Kept: deleting a file an enrolled CLI has open is refused; one conversation is
  still live in at most one runtime of a server.

## Non-goals

No locks, no merge of branches, no RPC-runtime re-read (the child owns its
SessionManager), no migration of older flat-directory web sessions.
