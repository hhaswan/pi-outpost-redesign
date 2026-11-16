## REMOVED Requirements

### Requirement: ExplicitTerminalRelease

**Reason**: Superseded by shared-cli-web-sessions. The user dropped exclusive ownership; a terminal no longer releases a session before web continues it.
**Migration**: Open the same session in web at any time; it re-reads what the CLI appended.

### Requirement: ExclusiveSameFileAdoption

**Reason**: Superseded by shared-cli-web-sessions. There is no writer lease; web and CLI write one file at once.
**Migration**: None needed. Existing receipt and lease files are no longer read and can be deleted.

### Requirement: DurableHandoffDiscovery

**Reason**: Superseded by shared-cli-web-sessions. Without handoffs there is nothing to discover.
**Migration**: The project's CLI history is listed in the session menu.

### Requirement: WebToCliHandoff

**Reason**: Superseded by shared-cli-web-sessions. New web sessions are saved where `pi -c` and `/resume` find them.
**Migration**: Run `pi -c` or `/resume` in the project directory.

### Requirement: AdoptClosedCliSession

**Reason**: Superseded by shared-cli-web-sessions. CLI history opens from the session menu like any session.
**Migration**: Open it from the session menu.
