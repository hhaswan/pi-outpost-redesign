## MODIFIED Requirements

### Requirement: ExplicitEnrollmentAndOwnership

A CLI bridge SHALL be enabled explicitly by loading the bridge extension. The bridge
SHALL NOT create another agent. Web and CLI MAY both write the CLI's session file, as
the shared-cli-web-sessions capability describes. Closing a browser SHALL NOT stop
the CLI. The bridge SHALL publish an authenticated loopback endpoint in a private
registry. Web access SHALL be disabled when server sandbox policy does not permit
unrestricted host access. The browser SHALL never receive the endpoint credential.
Discovery SHALL not read credentials from unrelated CLI configuration.

#### Scenario: EnrolledCliDiscovery
- **GIVEN** an enrolled CLI with a reachable authenticated endpoint
- **WHEN** an authorized operator lists terminal sessions
- **THEN** the web shows its project, session identity and reported activity without starting another runtime

#### Scenario: PrivateBridgeBoundary
- **WHEN** a request has the wrong credential, untrusted endpoint, oversized payload, or invalid registry file
- **THEN** it is refused without exposing transcript or executing a command

### Requirement: ProtectEnrolledSessionFiles

Web saved-session delete SHALL refuse a file claimed by an enrolled bridge, including
an unreachable owner whose claim has not been released, because a running writer
would lose what it appends next. Switch and rename SHALL be allowed. Normal shutdown
SHALL remove that process's registration. A stale claim SHALL require operator
investigation.

#### Scenario: ClaimedHistoryCannotBeMutated
- **GIVEN** a bridge registration claims a saved session file
- **WHEN** web requests delete for that file
- **THEN** the deletion is refused and the file is unchanged, even if the bridge endpoint is unreachable
- **AND** a rename of the same file goes through

### Requirement: GrantedIdleInput

Remote plain text SHALL be granted by default when the bridge loads, and the terminal
SHALL show once: "Outpost web can send messages to this CLI. /outpost-bridge revoke to
stop." `/outpost-bridge revoke` SHALL stop web input and web Stop for that CLI process;
`/outpost-bridge allow` SHALL restore it. No terminal confirmation SHALL be asked.
A working owner SHALL take the text as a follow-up. Open terminal dialogs, a
submission made while idle and not yet started, stale-generation and invalid
duplicate requests SHALL be refused. Submission SHALL deduplicate request IDs.
Acknowledgments SHALL say submitted, not accepted or completed: terminal extensions
may transform or reject input. Remote commands, arbitrary tools and terminal-dialog
answers are unsupported.

#### Scenario: GrantAndSubmit
- **GIVEN** a CLI has loaded the bridge and its operator has not revoked input
- **WHEN** an authorized browser submits plain text for the current generation
- **THEN** the text is submitted to the existing owner only once and the browser reports submission rather than completion

#### Scenario: WebInputGrantedByDefault
- **GIVEN** a CLI starts with the bridge loaded
- **WHEN** the operator does nothing, then runs `/outpost-bridge revoke`
- **THEN** the terminal shows the default-grant notice, web input is accepted without a confirmation, and after the revoke web input and Stop are refused for that process, across conversation changes

#### Scenario: SubmitWhileOwnerRefreshes
- **GIVEN** an operator has typed a draft and the browser is checking the current CLI owner
- **WHEN** the operator presses Submit before the check completes
- **THEN** the browser shows an inline explanation and preserves the draft without sending input or silently discarding the click

#### Scenario: RefuseUnsafeInput
- **WHEN** remote input is revoked, waiting on a terminal dialog, stale, command-shaped, or oversized
- **THEN** the owner refuses it without creating an agent or appending directly to its session file
