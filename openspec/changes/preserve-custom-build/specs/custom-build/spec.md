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
