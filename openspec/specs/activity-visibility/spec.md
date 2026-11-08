# Activity Visibility Specification

## Purpose

Keep current session activity and other server-managed workspace activity visible while the reader scrolls through a conversation. This complements ReportWorkspaceActivity in the multi-project-workspaces specification; it does not add subagent telemetry.

## Requirements

### Requirement: Persistent activity surface

The client SHALL render a compact activity strip outside the transcript scroll container. It SHALL identify the viewed project and session, expose readable activity through a polite status region, and wrap within a 320px viewport without horizontal overflow.

#### Scenario: Activity remains visible while reading history
- **GIVEN** a running session with a long transcript
- **WHEN** the reader scrolls to earlier messages
- **THEN** the activity strip remains visible outside the transcript scroll container
- **AND** the project, session, and readable activity remain available at a 320px viewport

### Requirement: Live state precedence

The strip SHALL derive activity from transport, lifecycle, dialogs, prompts, streaming and workspace state. Precedence SHALL be: authentication/disconnection; switching/startup; waiting; working; review-ready/stopped/idle. Missing session and workspace activity SHALL mean unknown. Switching SHALL label the existing context as last viewed, not as the destination.

#### Scenario: Live transitions follow precedence
- **GIVEN** a connected idle session
- **WHEN** a prompt becomes pending, streaming starts, a dialog appears, startup is reported, and a switch begins
- **THEN** each state is rendered using the documented precedence
- **AND** clearing the live activity returns the strip to authoritative idle state

#### Scenario: Authoritative workspace activity
- **GIVEN** a connected workspace with no higher-priority local state
- **WHEN** the server reports starting, working, waiting, ready for review, or stopped
- **THEN** the strip displays the corresponding readable activity

#### Scenario: Disconnected and authentication states never claim idle or live background work
- **GIVEN** cached current and background workspace activity
- **WHEN** the connection is lost or authentication is required
- **THEN** activity is explicitly unknown, not idle
- **AND** cached background activity is not presented as live

#### Scenario: Historical errors do not replace current activity
- **GIVEN** an error retained from an earlier operation
- **WHEN** the current session works or becomes idle
- **THEN** its live activity remains working or idle
- **AND** the retained error is qualified as the last error, not a current failure

### Requirement: Other workspace activity uses workspace identity

The strip SHALL display other server-managed workspaces that are starting, working, waiting, or ready for review. It SHALL distinguish workspace identity from project root so side sessions remain distinct. When workspace switching is permitted, selecting a displayed workspace SHALL invoke the existing switch operation with its identity. It SHALL NOT infer background subagent counts or activity from transcript content, XML, or extension status text.

#### Scenario: Other workspace identity remains distinct for same-root side sessions
- **GIVEN** the current workspace and another active side session share a project root
- **WHEN** the strip renders other workspace activity
- **THEN** it excludes only the current workspace identity and includes the side session label
- **AND** selecting the side session switches using its identity, not the shared root
- **AND** switching controls are disabled during a switch and absent when switching is not permitted

#### Scenario: Context falls back to side-session label then session identity
- **GIVEN** the server provides no session display name
- **WHEN** the strip renders the current context
- **THEN** it uses the side-session label if available, otherwise the session identity
- **AND** absent session identity is explicitly described as not yet available

### Requirement: ScopedDetachedAgentTelemetry

Embedded runtimes SHALL observe detached top-level Agent lifecycle events on their session-specific bus. Observed running/queued children SHALL keep the workspace working after parent settlement and prevent idle retirement. Reconnect snapshots SHALL retain counts. Ambiguous or malformed evidence SHALL be labeled uncertain. Nested/workflow agents and external OS processes are outside this ledger.

#### Scenario: DetachedChildOutlivesParentTurn
- **GIVEN** an observed detached Agent is running
- **WHEN** its parent model turn settles and the browser reconnects
- **THEN** the workspace remains working and the observed child count remains visible until a terminal child event

#### Scenario: IsolateChildTelemetry
- **WHEN** two SDK sessions emit child events or an old activation emits after replacement
- **THEN** each workspace only reports its own current activation's children

#### Scenario: AmbiguousChildLifecycle
- **WHEN** a late created event, reused ID, or malformed lifecycle event makes the ledger uncertain
- **THEN** the UI labels uncertainty and does not claim authoritative all-agent completion
