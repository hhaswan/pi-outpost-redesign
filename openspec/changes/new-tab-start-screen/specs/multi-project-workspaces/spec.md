## ADDED Requirements

### Requirement: NewTabStartScreen
A standalone tab with no saved per-tab selection SHALL show a start screen instead of the
conversation of the project it connected to, until the user picks. It SHALL list at most five of the
newest saved conversations across open projects, without starting a stopped project. A tab with a
saved selection, an embedded widget and a `workspaceLock` server SHALL NOT show it.

#### Scenario: NewTabShowsStartScreen
- **GIVEN** a new standalone tab with no saved selection
- **WHEN** the server's hello arrives
- **THEN** the start screen is shown, the default project's conversation and the composer are not
- **AND** nothing is remembered for the tab, so a refresh shows the start screen again

#### Scenario: RecentSessionsSpanOpenProjectsWithoutStartingThem
- **GIVEN** saved conversations in two open projects, one of them stopped
- **WHEN** a client sends `recent_sessions`
- **THEN** the answer holds the five newest across both projects, newest first, each with its project
- **AND** a conversation live in a session carries that session's id and activity
- **AND** the stopped project is still stopped

#### Scenario: OpenRecentConversation
- **GIVEN** the start screen
- **WHEN** the user clicks a recent conversation that is not live
- **THEN** the tab switches to its project, then to that conversation, and shows it
- **AND** nothing of another conversation is shown in between

#### Scenario: OpenRecentConversationLiveInASession
- **GIVEN** the start screen and a recent conversation live in a project's session
- **WHEN** the user clicks it
- **THEN** the tab switches to the session holding it, without a session switch

#### Scenario: StartNewChatInProject
- **GIVEN** the start screen
- **WHEN** the user clicks a project chip
- **THEN** the tab switches to that project and starts a new, empty conversation there
- **AND** the project's previous conversation is never shown

#### Scenario: RepeatedOrRefusedChoices
- **GIVEN** the start screen
- **WHEN** the user clicks rows or chips repeatedly, or a choice is refused by the server
- **THEN** only the first choice in flight is acted on, and a refused choice leaves the start screen shown

#### Scenario: ReloadRestoresTheChosenConversation
- **GIVEN** a tab that chose a conversation from the start screen, including one on a side session or with a running turn
- **WHEN** the tab reloads, twice
- **THEN** the same conversation is restored directly and the start screen never appears

#### Scenario: NoStartScreenWhenPinnedOrEmbedded
- **GIVEN** a server with `workspaceLock`, or an embedded widget
- **WHEN** a new tab connects
- **THEN** no start screen is shown and the current behaviour is kept

#### Scenario: StartScreenOnAPhone
- **GIVEN** a phone viewport of 390px
- **WHEN** a new tab opens
- **THEN** the start screen fills the transcript area without horizontal overflow and every row and chip is at least 44px tall
