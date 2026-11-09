## ADDED Requirements

### Requirement: CustomBuildPreservation

Both npm and standalone build paths SHALL mark this fork's artifact as custom.
The custom update command SHALL refuse stock replacement before registry or
installer access. Read-only checks SHALL remain available. Update notices SHALL
name the merge, rebuild, verification, and deployment path, not a stock install.

#### Scenario: CustomBuildRefusesStockReplacement
- **GIVEN** a custom build installed globally
- **WHEN** the operator runs `pi-outpost update`
- **THEN** it exits nonzero, explains how to preserve customization, and invokes neither registry lookup nor installer

#### Scenario: CustomBuildAllowsReadOnlyCheck
- **WHEN** a custom build runs `update --check`
- **THEN** it reports the lookup result without invoking the installer

#### Scenario: CustomBuildNoticePreservesCustomUpgradePath
- **WHEN** a newer version is available for a custom build
- **THEN** the notice directs the operator to merge, rebuild, verify, and deploy, and its copyable command is only a read-only check

### Requirement: BuiltCustomUiRegressionGate

CI SHALL exercise the built distribution in an isolated running app without model
requests. The gate SHALL fail if the custom marker, compact Process group, or model
search is missing.

#### Scenario: BuiltCompactProcess
- **GIVEN** a saved turn containing reasoning and two tools
- **WHEN** the built app opens it
- **THEN** one collapsed Process group appears, tool output is hidden, and expansion and rapid collapse toggles work

#### Scenario: BuiltSearchableModels
- **WHEN** the operator opens the model picker in the built app
- **THEN** case-insensitive provider search filters models, a missing query shows no options, Escape restores focus, and reopening resets the search

### Requirement: CustomNativeDeployment

The native updater SHALL verify committed source, await idle workspaces, exclude
client input through restoration, and pin the service outside global npm. It SHALL
verify saved IDs on fresh connections and record outcomes. It SHALL refuse side
sessions and record identity changes for unsaved empty sessions. Temporary ingress
rules SHALL be removed on completion and by termination cleanup.

#### Scenario: NativeRestorationMatchesExactIdentity
- **GIVEN** stale snapshots and unrelated errors precede the requested saved session
- **WHEN** restoration waits for its result
- **THEN** only the exact workspace and session ID complete restoration, and a genuine refusal does not succeed

#### Scenario: NativeBusyWorkIsNotInterrupted
- **GIVEN** streaming work, a waiting/starting workspace, unknown background state, or running/queued background agents
- **WHEN** the updater checks for an idle maintenance window
- **THEN** it refuses to stop the service in that state

#### Scenario: NativeIngressExcludesClientSubmissions
- **WHEN** the temporary deployment gate is held
- **THEN** normal client connections are rejected, the updater's loopback connection still works, and cleanup restores normal connectivity

#### Scenario: NativeServiceUsesCustomRelease
- **GIVEN** a disposable native service with a saved session
- **WHEN** the real updater deploys its built artifact
- **THEN** systemd selects the immutable custom release, the saved ID survives restart and a fresh connection, authenticated mobile model search works, and the CLI bridge is installed

#### Scenario: NativeRollbackPreservesNewSelection
- **GIVEN** restoration completes and a user selects another saved session after ingress reopens
- **WHEN** the subsequent browser check fails
- **THEN** rollback restores the prior service entry but preserves the newer user-selected session and restores normal connectivity
