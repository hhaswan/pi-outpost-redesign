## ADDED Requirements

### Requirement: ConversationChangesStayInTheAskingTab
A conversation change (new or switched session) asked by one tab on a session other connected tabs
watch SHALL move only the asking tab onto a new side session of the project, and apply there. Other
tabs SHALL keep their conversation. Viewing alone SHALL NOT split tabs. A lone tab on an idle session
SHALL change in place.

#### Scenario: NewConversationInOneTabStaysInThatTab
- **GIVEN** two tabs on the same project showing the same conversation
- **WHEN** the second tab starts a new conversation
- **THEN** the second tab is moved to a side session of that project with an empty, new conversation
- **AND** the first tab receives no session replacement and keeps its conversation

#### Scenario: SwitchingConversationInOneTabStaysInThatTab
- **GIVEN** two tabs on the same project showing the same conversation, and another saved conversation
- **WHEN** the second tab switches to the saved conversation
- **THEN** the second tab shows the saved conversation on its own side session
- **AND** the first tab receives no session replacement and cannot open the same file a second time

#### Scenario: ALoneTabChangesConversationInPlace
- **GIVEN** one tab alone on a project whose agent is idle
- **WHEN** it starts a new conversation or switches to a saved one
- **THEN** the project's main session changes in place and no side session is created

#### Scenario: LockedServerKeepsConversationShared
- **GIVEN** a server with `workspaceLock` and two tabs on its project
- **WHEN** one tab starts a new conversation
- **THEN** that tab is told the change applies to every tab, and the other tab follows the change

#### Scenario: ASplitSideSessionLivesWhileWatched
- **GIVEN** a tab moved onto its own side session by a conversation change, and a short idle timeout
- **WHEN** idle sweeps run while the tab is connected, and then the tab closes
- **THEN** the side session stays open while watched and is closed once idle and unwatched

#### Scenario: ATabRestoresItsOwnConversationAfterReload
- **GIVEN** a tab moved onto its own side session, and another tab on the project's main session
- **WHEN** the moved tab reloads
- **THEN** it returns to its side session and conversation, and the other tab is unchanged

### Requirement: ConversationChangesDoNotStopRunningWork
A conversation change asked on a working session (a turn and any question it waits on, background
sub-agents, compaction) SHALL move the asking tab onto a new side session, even when the tab is alone. The running work SHALL
continue and be saved in the original session. Under `workspaceLock` the change SHALL stay in place
with a warning. Reopening the working conversation itself SHALL be refused.

#### Scenario: BusyConversationChangeSplits
- **GIVEN** one tab alone on a project, with a turn running in the project's main session
- **WHEN** the tab starts a new conversation, or switches to a saved one
- **THEN** the tab is moved to a side session showing the new or saved conversation
- **AND** the main session is not replaced, its turn continues, completes without abort, and its
  session file holds the completed answer
- **AND** reopening the running conversation itself is refused with an error, and under
  `workspaceLock` the change stays in place with a warning that the running work stops

### Requirement: NewChatAsksFirst
The "+ new" control (desktop header and the phone "More controls" sheet) SHALL ask for confirmation
before leaving a conversation that has items. The question SHALL say that the agent keeps running
in its own session when it is working. Cancel, Escape and the backdrop SHALL change nothing. An
empty conversation and the start screen SHALL NOT ask. Rapid presses SHALL start one new chat.

#### Scenario: NewChatAsksFirst
- **GIVEN** a tab showing a conversation with items
- **WHEN** the user presses "+ new"
- **THEN** a dialog asks "Start a new chat? The current conversation stays in Sessions.", or, while
  the agent works, "The agent is still working. It keeps running in its own session; this tab
  starts a new chat."
- **AND** Cancel, Escape or the backdrop keep the conversation and send nothing; the second click of a double click
  on "+ new", landing on the backdrop, does not dismiss the dialog
- **AND** "Start new chat", even double-clicked, sends one `new_session`
- **AND** with an empty conversation "+ new" starts the new chat without asking
- **AND** the dialog closes without sending anything when the tab moves to another conversation

### Requirement: ForkDoesNotStopRunningWork
A fork replaces the session in place, so it SHALL be refused while the session is working (a turn,
background sub-agents or a compaction), as tree navigation and prompt editing already are. The
interface SHALL NOT offer a fork while the agent runs.

#### Scenario: BusyForkIsRefused
- **GIVEN** one tab alone on a project, with a turn running in the project's main session
- **WHEN** the tab asks to fork from a turn of that conversation
- **THEN** the server refuses with "Cannot fork while the agent is working" and replaces nothing
- **AND** the running turn completes without abort, and the tree's fork control is disabled meanwhile

### Requirement: ConversationChangesAskFirst
Switching to another saved conversation, forking, going back in the tree, resending an edited
prompt and compacting SHALL ask first, in the dialog "+ new" uses, when the conversation has items.
Cancel, Escape and the backdrop SHALL change nothing. Confirming SHALL send the action once.

#### Scenario: SwitchingConversationAsksFirst
- **GIVEN** a tab showing a conversation with items, from the sessions menu or the phone's Sessions sheet
- **WHEN** the user opens another saved conversation
- **THEN** a dialog asks "Open this conversation? The current one stays in Sessions.", followed while
  the agent works by "The agent is still working; it keeps running in its own session."
- **AND** Cancel, Escape and the backdrop send nothing; "Open", double-clicked, sends one `switch_session`
- **AND** reopening the conversation already shown does not ask

#### Scenario: ForkAndTreeNavigationAskFirst
- **GIVEN** a tab showing a conversation with items
- **WHEN** the user forks from a turn, or goes back to a turn, in the conversation tree
- **THEN** a dialog asks "Fork from this point? A new conversation starts from here; the current one
  stays in Sessions." or "Go back to this point? Later messages stay in the tree."
- **AND** cancelling sends nothing; confirming sends one `fork_session` or `navigate_tree`

#### Scenario: EditingAPromptAsksFirst
- **GIVEN** an edited past prompt, with the agent idle (editing is not offered while it runs)
- **WHEN** the user sends the edit
- **THEN** a dialog asks "Resend this edited prompt? Messages after it move to a branch."
- **AND** Cancel keeps the edit open with its text; "Resend", double-clicked, sends one `edit_prompt`
- **AND** another action confirmed right after, such as a fork, is still sent

#### Scenario: CompactingAsksFirst
- **GIVEN** a conversation with items and an idle agent
- **WHEN** the user presses the context control in the model bar
- **THEN** a dialog asks "Compact this conversation? Older messages are summarized to free context;
  the full history stays in the session file."
- **AND** cancelling starts no compaction; confirming sends one `compact`
