## ADDED Requirements

### Requirement: SharedSessionFile

Outpost web and the Pi CLI SHALL be able to keep the same session file open and write
to it at the same time, without a handoff, lock or reservation. Before each prompt,
each side SHALL re-read entries the other side appended, so its next entry chains
after the other writer's last entry and its next model request includes them.

#### Scenario: WebPromptChainsAfterCliEntries
- **GIVEN** the CLI appended entries to the shared file
- **WHEN** the user sends a prompt from web
- **THEN** the model request includes the CLI's messages and the web's new entry has the CLI's last entry as parent

#### Scenario: CliPromptChainsAfterWebEntries
- **GIVEN** the web appended entries to the shared file
- **WHEN** the user submits a prompt in the CLI
- **THEN** the CLI's model request includes the web's messages, its next entry has the web's last entry as parent, and the terminal shows a sync notice

### Requirement: SyncBetweenTurns

While idle, each side SHALL also re-read the file when it changes. The web SHALL show
the change in place, keeping the session id and open views. Neither side SHALL re-read
during a running turn. A simultaneous turn on both sides MAY branch the conversation
tree; the file SHALL stay valid and both sides SHALL keep working.

#### Scenario: CliTurnAppearsInWebWithoutRefresh
- **GIVEN** a web client shows a conversation that a Pi CLI also has open
- **WHEN** the CLI completes a turn while the web runtime is idle
- **THEN** the web conversation shows the CLI's messages without a reload or session change

#### Scenario: NoSyncDuringATurn
- **GIVEN** a turn is running on one side
- **WHEN** the other side appends to the file
- **THEN** the running side does not re-read the file until its turn has ended

#### Scenario: SimultaneousTurnsMayBranch
- **WHEN** web and CLI send prompts at nearly the same moment
- **THEN** every line of the file still parses and both sides answer later prompts

### Requirement: WebSessionsInCliDirectory

New web conversations SHALL be written to the Pi CLI's per-project session directory
under the configured agent directory, so the CLI's continue and resume list them.
Web sessions already saved in the flat session directory SHALL stay listed and
openable where they are.

#### Scenario: NewWebSessionsLandInTheCliDirectory
- **WHEN** a web conversation is saved for the first time
- **THEN** its file is in the agent directory's `sessions/--<cwd>--/` directory

#### Scenario: OlderFlatWebSessionsStayReadable
- **GIVEN** a web session saved earlier in the flat session directory
- **WHEN** the user opens it from the session menu
- **THEN** it opens with its transcript
