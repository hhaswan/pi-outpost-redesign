## ADDED Requirements

### Requirement: ExplicitTerminalRelease

An idle enrolled CLI SHALL offer a separately confirmed terminal handoff command.
Confirmation SHALL persist a private receipt for the exact existing session file
and request graceful CLI shutdown. Decline, busy state, SDK-queued input or a dialog
SHALL NOT release ownership. Confirmation SHALL warn that unresolved submitted text
may be absent; it never marks that input accepted or resends it. Shutdown
notification alone SHALL NOT authorize web writes. The original process must exit first.

#### Scenario: ConfirmedTerminalHandoff
- **GIVEN** an idle enrolled CLI with a persisted session
- **WHEN** its operator confirms `/outpost-bridge handoff`
- **THEN** a private receipt records the original identity and PID, the CLI requests shutdown, and the session bytes are not rewritten by the bridge

#### Scenario: DeclinedOrBusyTerminalHandoff
- **WHEN** the terminal declines, is busy, has SDK-queued input or a terminal dialog, or its session changes during confirmation
- **THEN** no receipt or shutdown authorizes web continuation

#### Scenario: ShutdownEventIsNotRelease
- **GIVEN** a valid receipt exists but its original CLI process still lives
- **WHEN** web requests continuation
- **THEN** it refuses without opening the session file

### Requirement: ExclusiveSameFileAdoption

Web continuation SHALL require a validated receipt for the requesting project,
unchanged file/header identity, no unreleased CLI claim, and an exclusive durable
writer lease. It SHALL switch the existing runtime to that exact file, never a copy.
Only an idle project main workspace may adopt or restore a transferred file.
Live leases in another server/workspace SHALL block acquisition. Invalid metadata
or a stale claim mutex SHALL fail closed.

#### Scenario: ContinueExactReleasedFile
- **GIVEN** confirmed release and original process exit
- **WHEN** web continues the released session
- **THEN** the runtime reports the original session ID and exact file path, with no new session fork

#### Scenario: ConcurrentWebAcquisition
- **WHEN** two server/workspace owners acquire the same released file
- **THEN** at most one owns the writer lease and the other cannot open a second writer

#### Scenario: UnsafeOrCrossProjectReceipt
- **WHEN** a receipt is malformed, unsafe, symlinked, cross-project, or its file header identity changes
- **THEN** continuation refuses without modifying the session bytes

#### Scenario: CancelledSwitchIsNotContinuation
- **WHEN** runtime switching is cancelled or fails after lease acquisition
- **THEN** the browser is not told the original conversation was continued, and no retry resends a prompt

### Requirement: DurableHandoffDiscovery

The panel SHALL list handoff state for the current project without exposing private
owner metadata. Adopted files SHALL remain in the authorized saved-session inventory.
A server may recover a dead prior web owner's lease under the claim mutex. Enrolled
CLI startup SHALL refuse files reserved for a handoff. The extension's resume
veto SHALL apply only to TUI mode, not the authorized web RPC context.

#### Scenario: DiscoverAndContinueReleasedSession
- **WHEN** an authorized browser refreshes released sessions
- **THEN** it shows releasing versus ready state, offers continuation only for a ready current-project receipt, and reflects successful runtime adoption

#### Scenario: RecoverAfterWebRestart
- **GIVEN** a prior web owner exited after adoption
- **WHEN** another web runtime restores the saved identity
- **THEN** it recovers the lease atomically and opens the original file from the authorized inventory

#### Scenario: CliCannotReopenReservedFile
- **GIVEN** a session is reserved for a confirmed handoff
- **WHEN** another enrolled CLI starts with that file
- **THEN** it refuses normal operation instead of becoming a concurrent writer


#### Scenario: SideWorkspaceCannotAcquireTransferredFile
- **GIVEN** an adopted file whose previous main web owner exited
- **WHEN** a side workspace attempts saved-session restoration or receipt continuation
- **THEN** it is refused without taking the lease, switching the side runtime or changing the original file


#### Scenario: WebLoadedCliBridgeDoesNotVetoHandoff
- **GIVEN** the bridge extension is also loaded by the web runtime in RPC mode
- **WHEN** that runtime acquires a valid released-session lease and switches to the original file
- **THEN** the terminal-only veto does not cancel the web switch, no terminal endpoint is published by web, and TUI resume protection remains active


### Requirement: WebToCliHandoff
An idle main workspace SHALL release its saved conversation to one CLI: reserve the exact file, leave it,
mark it released, and show a copyable `pi --session` command. One bridged CLI SHALL claim it; others SHALL be
refused. No web runtime SHALL open, rename or delete it until that CLI exits, unless taken back unclaimed.

#### Scenario: WebToCliHandoff
- **GIVEN** a saved web conversation open in an idle main workspace
- **WHEN** the operator confirms Hand off to CLI and a bridged CLI opens the shown file
- **THEN** the web moves to another conversation, refuses the file while that CLI runs, a second CLI is refused, and the web reopens the same file after the CLI exits

#### Scenario: ReclaimUnclaimedCliHandoff
- **GIVEN** a released web conversation that no CLI has opened
- **WHEN** the operator takes it back
- **THEN** the reservation is removed and the same file is open in web again

#### Scenario: ConcurrentReleaseHasOneOutcome
- **GIVEN** two simultaneous hand-off requests for one conversation
- **WHEN** both are processed
- **THEN** exactly one releases the file and exactly one reservation exists

### Requirement: AdoptClosedCliSession
Terminal sessions SHALL list recent CLI history of the project that no enrolled CLI claims and SHALL let the
operator continue one in web after confirming that its CLI is closed. The server SHALL refuse while any Pi
CLI process runs in the project or names the file (Linux only; other platforms refuse), while the file
changed in the last five seconds, or while a claim, reservation or receipt names it. Adoption SHALL reuse the
receipt lease so enrolled CLIs then refuse the file.

#### Scenario: AdoptClosedCliSession
- **GIVEN** CLI history of the project whose CLI has exited
- **WHEN** the operator confirms the CLI is closed and continues it in web
- **THEN** it is refused while a Pi CLI runs in the project, then resumes the original file once none runs, and an enrolled CLI refuses it afterwards
