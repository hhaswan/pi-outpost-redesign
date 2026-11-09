# Scenario-to-test matrix

Inventory verified with `rg '^#### Scenario:' openspec/`. The delta contains eleven
new scenarios plus the two modified main-spec scenarios. Existing bridge scenarios
remain applicable and are mapped below as well. OpenLore returned no index;
targeted implementation inspection, full SDK extension documentation and actual
lifecycle source were used. Assertions were read, not inferred from names.

## New handoff scenarios

- **ConfirmedTerminalHandoff — covered.**
  `extensions/cli-session-bridge.test.ts`,
  `ConfirmedTerminalHandoff / ShutdownEventIsNotRelease: separate consent prepares receipt and closes CLI without rewriting history`,
  asserts private receipt identity, shutdown request, unchanged JSONL and blocked
  acquisition while PID lives. `scripts/check-cli-handoff.mjs` drives actual
  terminal confirmation, same ID/path discovery and original-file persistence.
  Its additional intercepted-submission unit case verifies handoff does not retry
  or claim acceptance of unresolved text.
- **DeclinedOrBusyTerminalHandoff — covered.**
  `extensions/cli-session-bridge.test.ts`,
  `DeclinedOrBusyTerminalHandoff: no release while declined, working, queued or dialog-blocked`,
  checks decline, non-idle, SDK queue, dialog, changed identity, and becoming busy
  during confirmation. Every case asserts no receipt and no shutdown request.
- **ShutdownEventIsNotRelease — covered.** The extension test above rejects claims
  before and after a shutdown event while the process still lives.
  `scripts/check-cli-handoff.mjs`, `ShutdownNotificationCannotAuthorizeSecondWriter`,
  holds a real shutdown finalizer after bridge cleanup, checks the browser/raw
  resume is blocked, permits the finalizer's late append, then waits for PID exit
  before clicking continuation. A timer or missing endpoint is never the barrier.
- **ContinueExactReleasedFile — covered.**
  `server/test/cli-handoff-wire.test.mjs`,
  `ContinueExactReleasedFile: Terminal sessions adopts the original ID and canonical file without a fork`,
  audits the actual SDK manager's file, verifies the session inventory, and renames
  through the real runtime to prove persistence lands in the original JSONL.
  The PTY/Playwright probe also checks original history, ID and original-file rename.
- **ConcurrentWebAcquisition — covered.**
  `server/test/cli-handoff-wire.test.mjs`,
  `ConcurrentWebAcquisition: two server processes cannot open the same released CLI file`,
  races two actual server processes and audits that the loser never opens the file.
  `server/test/cliHandoffStore.test.ts` also checks concurrent workspaces, exclusive
  mkdir mutexes, duplicate receipts and hardlinked conversation refusal.
- **UnsafeOrCrossProjectReceipt — covered.**
  `server/test/cli-handoff-wire.test.mjs`,
  `UnsafeOrCrossProjectReceipt: other cwd and tampered session headers are refused without changing source bytes`,
  verifies refusal preserves current web identity and source bytes. Store tests
  additionally exercise malformed/oversized/extra metadata, PID/UUID validation,
  private modes, symlink ancestors and hardlinked receipts at the actual FS boundary.
- **CancelledSwitchIsNotContinuation — covered.**
  `server/test/cli-handoff-wire.test.mjs`,
  `CancelledSwitchIsNotContinuation: SDK cancellation preserves the current session and permits same-workspace retry`,
  vetoes the actual SDK switch, verifies no resumed/snapshot success or source
  mutation, removes the veto and retries the same lease. UI tests verify refusal
  and disconnection do not claim success or automatically retry.
- **DiscoverAndContinueReleasedSession — covered.**
  `ui/src/components/CliSessions.test.tsx`,
  `DiscoverAndContinueReleasedSession: lists releasing/ready state and resumes only after explicit click`,
  checks disabled releasing action, enabled ready action, explicit request and
  result. Actual PTY/Playwright drives the same current-project list in the built
  app and verifies the panel closes only when the real session changes.
- **RecoverAfterWebRestart — covered.**
  `server/test/cli-handoff-wire.test.mjs`,
  `RecoverAfterWebRestart: a new server lists and switches the adopted external file`,
  stops the owner process, starts a different server and restores the original ID
  and file through the normal authorized inventory. Store tests independently
  recover a dead prior web owner under the claim mutex.
- **CliCannotReopenReservedFile — covered (cooperative scope).**
  `extensions/cli-session-bridge.test.ts`,
  `CliCannotReopenReservedFile: enrolled runtime resume is cancelled before another session loads`,
  verifies the supported pre-switch cancellation. The store's real-PID reservation
  tests check startup admission. The actual PTY probe starts a second enrolled CLI
  on a fresh session, calls the supported runtime switch path and asserts it is
  cancelled with the original web-owned file unchanged, including after shutdown.
  This is not a guarantee against an independent SDK startup migration, direct
  raw-file access, or an unmodified CLI deliberately launched on a web-owned file.

## Modified and unchanged main bridge scenarios

- **EnrolledCliDiscovery — covered.** Extension test
  `EnrolledCliDiscovery / PrivateBridgeBoundary: authenticated loopback, private files, no factory writes`
  and server `cliBridge.test.ts` discovery assertions verify identity, no credential
  exposure, and observation without a second runtime. Actual PTY probe lists it.
- **PrivateBridgeBoundary — covered.** The extension and server suites exercise
  incorrect auth, origin/size/registry boundaries. `cli-bridge-wire.test.mjs`,
  `PrivateBridgeBoundary: sandbox refuses external CLI discovery at the browser boundary`,
  and new `SandboxDeniesContinuation` prove the host policy also denies handoff.
- **ObserveAndReconnect — covered.** Extension branch/stream/shutdown test,
  `cliBridge.test.ts` snapshot identity-race tests and `CliSessions.test.tsx`
  observation/refresh tests. The actual PTY probe runs `/reload`, verifies bridge
  instance rotation without changing the original session, then refreshes browser.
- **UnreachableOwner — covered.** `cliBridge.test.ts`,
  `UnreachableOwner: timeout disables input and retains claim`, and CLI UI tests
  verify unknown activity and disabled input. A new receipt never bypasses a stale
  CLI claim (`StaleCliClaimStillBlocksContinuation` integration case).
- **GrantAndSubmit — covered.** Extension consent/idempotency/reservation tests,
  server submit tests and actual PTY/Playwright `ActualSubmitToCliFeedbackAndAcceptance`.
  The probe confirms one input-boundary delivery, displays submitted-only feedback,
  observes the accepted transcript entry and asserts no model turn starts.
- **SubmitWhileOwnerRefreshes — covered.** `CliSessions.test.tsx` refresh-click
  regression preserves draft, renders inline checking explanation and sends no
  duplicate. Actual running-app submission and manual refresh also pass.
- **RefuseUnsafeInput — covered.** Extension/server tests check command-shaped,
  oversized, stale, busy, ungranted and conflicting duplicate input without sending.
- **ClaimedHistoryCannotBeMutated — covered.** `cli-bridge-wire.test.mjs`,
  `ClaimedHistoryCannotBeMutated: unreachable CLI claims block browser switch, rename and delete`,
  checks all three production messages and unchanged source bytes. The new stale
  claim integration case preserves this boundary even with a released receipt.

## Verification notes and failures retained

- The first real PTY probe encountered an intercepted input whose bridge reservation
  correctly stayed unresolved despite an SDK-idle state. Handoff now separately
  requires terminal confirmation warning about unpersisted submitted text; it does
  not clear the remote-submit reservation or resend anything. The original PID
  still must exit. SDK-queued/running input remains a refusal.
- An initial browser assertion expected a success notice inside a panel that the
  existing App deliberately closes on actual session replacement. The probe now
  asserts that real transition, original transcript, exact inventory path and
  original-file persistence; it does not infer success from a click or screenshot.
- A root `npx tsc -b web` invocation selected the wrong compiler/configuration and
  reported unrelated DOM/type errors. The actual workspace production build passes.
  Server typecheck still reports the previously known missing node-pty declarations;
  no new handoff type error is reported. Windows execution is delegated to CI;
  tests use path.join/resolve, file URLs, CRLF-safe parsing and Node child spawning.
- Review identified an abandoned claim mutex after process death. This is an
  intentional fail-closed boundary, not an automatic timeout takeover. The runbook
  now provides explicit stop-all-owners, verify PIDs, empty-rmdir recovery. A store
  test exercises the same manual empty-mutex recovery with the original PID dead.

The normal server suite exercises the source app. Set `CLI_HANDOFF_TEST_ENTRY` to
`cli/dist/pi-outpost.mjs` for the identical wire tests against the distributable;
the native update command and browser CI do so. The real PTY/Playwright probe always
uses the built CLI extension and built embedded web server.

- **SideWorkspaceCannotAcquireTransferredFile — covered.**
  `server/test/cli-handoff-wire.test.mjs`,
  `SideWorkspaceCannotAcquireTransferredFile: a side session cannot strand a dead prior main-owner lease`,
  adopts in a main process, stops it, opens a side session in a new process, then
  refuses both saved-path and receipt continuation. It verifies the side runtime,
  original JSONL and private lease remain unchanged across those refused actions.
  This prevents a closed side session from permanently reserving a main-only file.

Additional transition checks: the same-file wire test repeats continuation and
asserts no new SDK runtime or file mutation. The actual browser probe repeats the
owned-session action without a stuck loading panel. `useAgent.test.ts`,
`CLI handoff acknowledgment survives only its same-workspace session replacement`,
checks pending results survive only the handoff's own snapshot and never cross a
project change. `HostPolicyDeniesContinuation` exercises extensionLock and
workspaceLock in addition to the actual sandbox boundary.

The first full UI run failed only on the old CLI-history help text. Its assertion
now checks the explicit handoff guidance while preserving the no-switch/no-rename/
no-delete assertions. The side-session test initially compared bytes from before
an authorized main adoption; the SDK legitimately appended its thinking setting
there. The assertion now brackets the refused side actions and checks both source
and lease bytes unchanged, which is the actual negative contract.

Final predeployment gates: all 2795 UI tests pass; the production embedded build,
142 focused server/extension/update tests, actual PTY/browser handoff and Submit proof,
custom Process/model gate, disposable native deployment and rollback, and three-tab
offline/reconnect probe pass. Live service stayed unchanged throughout staging.

PID-death evidence is namespace-bound on Linux. The store test `a PID from another
namespace never proves that the original CLI exited` tampers that evidence and
requires discovery/acquisition refusal with unchanged source bytes. This prevents
a shared registry plus host networking from confusing container and host PIDs.

The failed-switch half is also checked independently of cancellation:
`server/test/cli-handoff-wire.test.mjs`, `FailedSwitchIsNotContinuation`, removes
access to the source after lease validation through a trusted test extension. The
SDK's fallback is never acknowledged as the original session; the parked original
bytes remain intact, and repair plus explicit retry opens the original file.
The real PTY/browser probe injects that same boundary. It requires an explicit
refusal visible in the main UI even after SDK recovery closes the session panel.
`useAgent.test.ts`, `handoff failure remains visible when SDK recovery closes the old session panel`,
protects that feedback. No successful continuation is inferred from panel closure.
