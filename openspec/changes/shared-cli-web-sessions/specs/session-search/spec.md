## REMOVED Requirements

### Requirement: Read-only Pi CLI history

**Reason**: Web and the Pi CLI now share session files; CLI history is no longer read-only in web.
**Migration**: CLI history is listed by the requirement "Pi CLI history in the session menu".

## ADDED Requirements

### Requirement: Pi CLI history in the session menu

The session menu SHALL list bounded metadata from the Pi CLI's per-cwd directory under
the configured agent root, alongside the flat directory's sessions. These sessions
SHALL be openable, renamable and deletable like any session. Search SHALL use their
available titles and opening messages, not whole transcripts. An unverified old title
SHALL NOT be shown as current.

#### Scenario: CliHistoryIsSelectable
- **GIVEN** a Pi CLI session saved for the active project in its per-cwd directory
- **WHEN** the user renames it and opens it from the session menu
- **THEN** the new name is listed and the conversation opens with its transcript

#### Scenario: CliHistorySearchAndProjectIsolation
- **GIVEN** saved CLI sessions in two different project directories
- **WHEN** the user searches the first project's session menu by name or opening message
- **THEN** matching CLI history appears without any session from the other project
