# CLI session bridge

## Purpose

Let explicitly enrolled, same-user Pi CLI processes expose their existing conversation to the web without creating a second agent or writer. This is an opt-in extension, not automatic attachment to arbitrary terminal processes.

## Requirements

### Requirement: ExplicitEnrollmentAndOwnership

A CLI bridge SHALL be enabled explicitly by loading the bridge extension. The CLI SHALL remain the sole agent and session writer. Closing a browser SHALL NOT stop the CLI. The bridge SHALL publish an authenticated loopback endpoint in a private registry. Web access SHALL be disabled when server sandbox policy does not permit unrestricted host access. The browser SHALL never receive the endpoint credential. Discovery SHALL not read credentials from unrelated CLI configuration.

#### Scenario: EnrolledCliDiscovery
- **GIVEN** an enrolled CLI with a reachable authenticated endpoint
- **WHEN** an authorized operator lists terminal sessions
- **THEN** the web shows its project, session identity and reported activity without starting another runtime

#### Scenario: PrivateBridgeBoundary
- **WHEN** a request has the wrong credential, untrusted endpoint, oversized payload, or invalid registry file
- **THEN** it is refused without exposing transcript or executing a command

### Requirement: ObserveExistingRuntime

The browser SHALL retrieve bounded snapshots from the CLI owner. Snapshots SHALL include a runtime-instance identity and session generation. Unreachable owners SHALL be labeled unknown/unreachable, never idle or completed. The browser SHALL not automatically resume a session file after losing contact.

#### Scenario: ObserveAndReconnect
- **WHEN** an enrolled CLI changes its conversation and a browser refreshes the terminal-session view
- **THEN** the view reflects the owner snapshot without creating or switching a server-side session runtime

#### Scenario: UnreachableOwner
- **WHEN** the owner cannot be reached
- **THEN** the view reports uncertain activity and disables input instead of opening the stored session file

### Requirement: GrantedIdleInput

Remote plain text SHALL require CLI permission. Busy, stale-generation and invalid duplicate requests SHALL be refused. Submission SHALL reserve input synchronously and deduplicate request IDs. Acknowledgments SHALL say submitted, not accepted or completed: terminal extensions may transform or reject input. Remote commands, arbitrary tools and terminal-dialog answers are unsupported.

#### Scenario: GrantAndSubmit
- **GIVEN** a CLI operator has explicitly granted web input and the owner is idle
- **WHEN** an authorized browser submits plain text for the current generation
- **THEN** the text is submitted to the existing owner only once and the browser reports submission rather than completion

#### Scenario: RefuseUnsafeInput
- **WHEN** remote input is ungranted, busy, stale, command-shaped, or oversized
- **THEN** the owner refuses it without creating an agent or appending directly to its session file

### Requirement: ProtectEnrolledSessionFiles

Web saved-session switch, rename and delete operations SHALL refuse files claimed by an enrolled bridge, including an unreachable owner whose claim has not been released. Normal shutdown SHALL remove that process's registration. A stale claim SHALL require operator investigation rather than being treated as permission to write. This cooperative protection SHALL NOT be advertised as a universal lock against unmodified external CLI writers.

#### Scenario: ClaimedHistoryCannotBeMutated
- **GIVEN** a bridge registration claims a saved session file
- **WHEN** web requests switch, rename or delete for that file
- **THEN** the operation is refused even if the bridge endpoint is unreachable
