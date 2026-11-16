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
