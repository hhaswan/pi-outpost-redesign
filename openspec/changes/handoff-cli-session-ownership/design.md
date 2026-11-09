# Ownership design

The authoritative release boundary is process death, not a removed bridge file,
missing endpoint, idle report, timeout, or `session_shutdown` event. The installed
SDK emits shutdown before final disposal; later extensions can still append.
The CLI writes only a private transfer receipt after separate terminal consent and
requests graceful shutdown. Web never writes the JSONL before the original PID exits.

A receipt names the canonical cwd, UUID session ID, original file, bridge instance
and original PID/namespace. Linux receivers refuse a different PID namespace rather
than mistaking a container-local PID for a dead host process. The server validates a bounded session header and regular,
non-symlink, non-hardlinked source file before adoption. It never accepts a browser
path as transfer authority. Private directory/receipt ownership, modes, ancestors,
size, strict keys, UUIDs and process state fail closed. Duplicate receipts for one
file fail closed instead of creating independent leases.

Each claim acquires an atomic per-receipt directory mutex, then rechecks the
original PID and file identity. A live web owner in another process/workspace
blocks acquisition. A dead prior web owner can be recovered under the mutex.
Abandoned mutexes are not stolen: explicit operator recovery stops all relevant
servers, verifies PIDs and removes only an empty mutex. This trades a rare manual
recovery requirement for avoiding unsafe automatic takeover.

The existing replacement sequencer reserves the target main workspace before any
awaited lease work. Receipt validation refusal returns cancellation without
manufacturing another web session. Real runtime failures retain existing recovery
behavior, but only an observed original ID and exact path acknowledge continuation.
A retry of an already-owned current file does not recreate its runtime. Pending
handoff results survive only their same-workspace session snapshot, never a project
switch or disconnection.

Adopted files join the real SDK inventory as exact allowlisted external paths.
Authorization queries bypass the display scan cache. Saved-session restoration
recovers dead prior owners before opening the original file. Unadopted CLI history
remains read-only. Existing terminal registrations, including stale claims, still
block opening; handoff is not a shortcut around that boundary. Deletion is disabled
while a receipt reserves the original file.

The original CLI/web transfer is single-writer. Cooperative pre-switch guards also
refuse enrolled CLI resume operations on reserved files. This is not a universal
OS filesystem lock: independent SDK startup migrations, deliberately unmodified
CLI launches and unrelated extensions retaining raw writers are outside scope.
