## ADDED Requirements

### Requirement: ConversationChangesStayInTheAskingTab
A conversation change (new or switched session) asked by one tab on a session other connected tabs
watch SHALL move only the asking tab onto a new side session of the project, and apply there. Other
tabs SHALL keep their conversation. Viewing alone SHALL NOT split tabs. A lone tab SHALL change in place.

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
- **GIVEN** one tab alone on a project
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
