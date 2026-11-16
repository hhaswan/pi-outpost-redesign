## ADDED Requirements

### Requirement: SharedSessionFile

Outpost web and the Pi CLI SHALL be able to keep the same session file open and write
to it at the same time, without a handoff, lock or reservation. Before each prompt,
each side SHALL re-read entries the other side appended, so its next entry chains
after the other writer's last entry and its next model request includes them. This
SHALL hold for the RPC agent runtime too, whose child process reloads the same file.

#### Scenario: WebPromptChainsAfterCliEntries
- **GIVEN** the CLI appended entries to the shared file
- **WHEN** the user sends a prompt from web
- **THEN** the model request includes the CLI's messages and the web's new entry has the CLI's last entry as parent

#### Scenario: RpcRuntimeReloadsTheSharedFile
- **GIVEN** the web runs the RPC agent runtime and another writer appended to its session file
- **WHEN** the runtime is idle and the next prompt is prepared
- **THEN** the RPC child switches to the same file before the prompt, and does not while a turn runs

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

#### Scenario: OtherWritersBranchIsFollowed
- **GIVEN** the web is at the tip of a conversation
- **WHEN** another writer appends an entry whose parent is an older entry
- **THEN** the file parses, the web re-reads it, the conversation tree lists both branches, and the next web prompt chains after the file's last entry

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

### Requirement: WebPromptsDriveLiveCli

When a live bridged CLI has the web conversation's session file open (compared
canonically) and the web runtime is idle, a plain-text web prompt SHALL be sent to
that CLI, not the web runtime. The CLI SHALL be the only writer of that turn; while it
works, the text SHALL wait there as a follow-up. The web SHALL show the user's message
at once. Images, `/` commands, `!` input and text over 8000 characters stay with the
web runtime.

#### Scenario: WebPromptRunsInLiveCli
- **GIVEN** a bridged CLI has the web conversation's session file open and both are idle
- **WHEN** the user sends a message from the web composer
- **THEN** the CLI process makes the one model request for it, the file holds one user and one assistant entry for the turn chained after the previous last entry, and the web shows the user message and the answer

#### Scenario: BusyCliQueuesWebPromptAsFollowUp
- **GIVEN** the bridged CLI is running a turn
- **WHEN** the user sends a message from the web composer
- **THEN** the CLI takes it as a follow-up and answers it after the running turn, with that turn in its request

### Requirement: RouteFallsBackOnlyWhenNotDelivered

A routed prompt SHALL fall back to the web runtime only when the CLI provably did not
receive it: no live registration, unreachable before sending, or input revoked. When
the outcome is unknown, the web SHALL show an error and SHALL NOT send the prompt again.

#### Scenario: RefusedRouteFallsBackToWeb
- **GIVEN** the bridged CLI has closed, is unreachable before sending, or has revoked input
- **WHEN** the user sends a message from the web composer
- **THEN** the web runtime answers it, exactly once

#### Scenario: UnknownRouteOutcomeIsNotResent
- **GIVEN** the CLI may have received the message but its acknowledgement is lost or uncertain
- **WHEN** the route ends
- **THEN** the web shows an error and neither the web runtime nor the CLI is sent the message again

### Requirement: CliTurnStreamsToWeb

A bridged CLI SHALL stream its turn events over its authenticated private endpoint.
The server SHALL forward them to the clients of the workspace showing that session
file as the wire messages the web runtime emits for its own turns, and SHALL re-read
the file when the turn ends. Events SHALL NOT reach a workspace that moved to another
conversation.

#### Scenario: CliTurnStreamsToWeb
- **GIVEN** a web prompt runs in a live bridged CLI
- **WHEN** the CLI's model streams its reply
- **THEN** the web shows the partial reply before the CLI wrote it to the file, shows Stop while it runs, and shows the persisted reply when the turn ends

### Requirement: WebStopAbortsCliTurn

Web Stop during a CLI turn streaming to the web SHALL abort that turn in the CLI.

#### Scenario: WebStopAbortsCliTurn
- **GIVEN** a CLI turn is streaming to the web
- **WHEN** the user presses Stop in the web
- **THEN** the CLI's turn is aborted, its model request is cancelled, and the web leaves the running state
