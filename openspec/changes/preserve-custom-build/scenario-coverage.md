# Scenario coverage

Inventory: `rg '^#### Scenario:' openspec/` and the delta's five scenario headings.
Source assertions were read, not inferred from test names. OpenLore had no analysis;
targeted source inspection was used. The upstream update behavior is unchanged for
unmarked builds and its existing suite passes alongside these additions.

- **CustomBuildRefusesStockReplacement — covered.** `server/test/update.test.ts`,
  `CustomBuildRefusesStockReplacement before network or installer runs`, asserts
  nonzero exit and refusal; injected lookup and installer fail if called.
  `scripts/check-custom-build.mjs` also launches the actual built command and
  verifies npm and SEA artifacts carry the custom marker.
- **CustomBuildAllowsReadOnlyCheck — covered.** `server/test/update.test.ts`,
  `CustomBuildAllowsReadOnlyCheck without installing`, asserts successful lookup
  and makes installer invocation fail the test.
- **CustomBuildNoticePreservesCustomUpgradePath — covered.**
  `server/test/update.test.ts`, `CustomBuildNoticePreservesCustomUpgradePath`,
  verifies the warning and read-only copy command.
- **BuiltCompactProcess — covered.** `scripts/check-custom-build.mjs`,
  `BuiltCompactProcess`, reads the running DOM for exactly one collapsed group,
  hidden output, expanded state and successful rapid collapse toggles.
- **BuiltSearchableModels — covered.** `scripts/check-custom-build.mjs`,
  `BuiltSearchableModels`, checks empty options, uppercase provider filtering,
  Escape, restored focus and successful reopening.

Executed locally: 99 update unit/process/package tests, all 2791 UI tests across 144 files, production build, the
isolated artifact gate, and the existing three-tab refresh/offline/reconnect probe
all pass. An initial build failed because conflict resolution dropped Tailwind 3
transitive lock records. Restoring missing custom dependency records followed by
pinned npm 12.2.2 lock regeneration and installation fixed it. The first artifact
probe used a different fixture session directory than the harness; aligning those
directories fixed fixture discovery without weakening product assertions.

No live deployment is claimed. CLI handoff remains separate unfinished work.

Server typecheck remains blocked by pre-existing missing node-pty declarations and
an implicit exitCode type. npm audit reports two moderate development-dependency
findings in api-extractor/minimatch; no breaking dependency upgrade was applied.
Review found caller-side extension version hints could run after refusal; the
caller now suppresses hints on failure. The artifact probe includes an installed
extension and controlled npm command, and asserts no view/install calls occur.

## Native deployment extension

- **NativeRestorationMatchesExactIdentity — covered.**
  `scripts/check-native-deploy.mjs`, `ExactSessionRestorationAndBusyGuards`,
  sends stale/intermediate snapshots and unrelated errors before the exact target;
  a refusal must time out rather than being accepted as success.
- **NativeBusyWorkIsNotInterrupted — covered.** The same check asserts waiting,
  starting and working activity and unknown/running/queued background state are
  not idle. Streaming is independently rejected by the production predicate.
- **NativeIngressExcludesClientSubmissions — covered.**
  `scripts/check-native-deploy.mjs`, `TemporaryIngressExcludesClientsAndCleansUp`,
  applies actual temporary rules on the disposable port, checks normal requests
  fail and the bound loopback request succeeds, then removes the rules and checks
  normal HTTP succeeds again.
- **NativeServiceUsesCustomRelease — covered.**
  `scripts/check-native-deploy.mjs`, `RealNativeDeploymentAndFreshSessionIdentity`,
  drives an actual disposable systemd service through the production worker,
  checks ExecStart selects its immutable release, verifies the restored ID through
  a fresh WebSocket, checks bridge installation, and requires the worker's real
  authenticated mobile Playwright check to succeed.

The first native probe failed because its test connection omitted authentication;
it correctly received 4401. Adding the fixture's Authorization header fixed the
probe; no product assertion was weakened. The subsequent real systemd probe passes.
Live MainPID stayed 3998617 throughout isolated verification. Native probes require
explicit Linux/root execution and are not included in cross-platform unit suites.

- **NativeRollbackPreservesNewSelection — covered.**
  `scripts/check-native-deploy.mjs`,
  `RollbackPreservesSelectionMadeAfterIngressReopened`, uses a deliberately failing
  browser executable. While that executable waits, a real WebSocket selects a new
  saved session. The worker must fail, roll back the prior ExecStart, preserve the
  newer selection on a fresh connection, and reopen normal HTTP access.

The first injected rollback test exposed a real readiness bug: rollback attempted
WebSocket restoration before the restarted service listened, then waited for a
snapshot on a failed socket until the probe deadline terminated the worker.
The implementation now waits for health after rollback startup and fails socket
waiters promptly on error/close. The unchanged fault assertion then passes. Review
also identified stale selection rollback after ingress reopened; rollback now
captures and restores the current selection under the ingress gate. No watchdog
terminates the worker mid-transition; idle waiting and individual operations remain
bounded. Do not manually terminate an updater during restart/restoration.
