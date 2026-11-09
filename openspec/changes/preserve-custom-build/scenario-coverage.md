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
