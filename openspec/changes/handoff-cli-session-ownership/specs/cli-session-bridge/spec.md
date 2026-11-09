## MODIFIED Requirements

### Requirement: ExplicitEnrollmentAndOwnership

A CLI bridge SHALL be enabled explicitly by loading the bridge extension. The CLI
SHALL remain the sole agent and session writer until an explicitly confirmed
handoff is acquired after the original process exits. Closing a browser SHALL NOT
stop the CLI. The bridge SHALL publish an authenticated loopback endpoint in a
private registry. Web access SHALL be disabled when server sandbox policy does not
permit unrestricted host access. The browser SHALL never receive endpoint
credentials. Discovery SHALL not read credentials from unrelated CLI configuration.

#### Scenario: EnrolledCliDiscovery
- **GIVEN** an enrolled CLI with a reachable authenticated endpoint
- **WHEN** an authorized operator lists terminal sessions
- **THEN** web shows project, session identity and activity without starting another runtime

#### Scenario: PrivateBridgeBoundary
- **WHEN** a request has the wrong credential, untrusted endpoint, oversized payload, or invalid registry file
- **THEN** it is refused without exposing transcript or executing a command
