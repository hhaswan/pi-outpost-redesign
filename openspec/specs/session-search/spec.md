# Session Search Specification

## Purpose

Finding a saved session by its name, its first message, or anything ever said in it. Matching runs
server-side over the full transcript; each result carries the excerpt that explains why it matched.

## Requirements

### Requirement: SessionSearch

The session menu SHALL offer a search field, like the conversation tree's. A query SHALL match a session on its name, its first message, or anywhere in its transcript, case-insensitively. Matching SHALL happen server-side; full transcripts SHALL NOT be sent to the client. Results SHALL be the matching sessions, most recently modified first, capped at the same limit as the plain session list.

#### Scenario: FindByWordSaidMidConversation
- **GIVEN** a saved session whose only mention of "reconnect" is in a message halfway through
- **WHEN** the user searches for "reconnect" in the session menu
- **THEN** that session is listed among the results

#### Scenario: FindByName
- **GIVEN** a session named "Fix WebSocket reconnect loop"
- **WHEN** the user searches for "websocket"
- **THEN** the session is listed, regardless of what its first message says

#### Scenario: NoMatches
- **WHEN** the query matches no session
- **THEN** the menu shows an explicit "no matches" state, not an empty dropdown

#### Scenario: EmptyQueryRestoresList
- **GIVEN** an active search
- **WHEN** the user clears the query
- **THEN** the menu shows the full session list again

### Requirement: SearchResultSnippet

Each search result SHALL carry a short excerpt of the transcript around the first occurrence of the query (whitespace-collapsed, ellipsized), and the menu SHALL display it under the session's name, so the user sees why the session matched.

#### Scenario: SnippetShowsMatch
- **GIVEN** a query that matches a message in the middle of a session
- **WHEN** the results are displayed
- **THEN** the row shows an excerpt containing the matched text

### Requirement: StaleSearchResultsDiscarded

Search requests SHALL be correlated by request id, and the client SHALL ignore any result whose id is not that of the latest request, so results arriving out of order while the user types never overwrite newer ones.

#### Scenario: OutOfOrderResponses
- **GIVEN** the user types quickly and two searches are in flight
- **WHEN** the answer to the earlier one arrives last
- **THEN** the menu still shows the results of the latest query

### Requirement: Read-only Pi CLI history

The session menu SHALL list bounded metadata from Pi CLI's per-cwd directory under the configured agent root. CLI entries SHALL be marked read-only, without switch, rename or delete actions. Search SHALL use available titles and opening messages, not whole transcripts. An unverified old title SHALL NOT be shown as current.

#### Scenario: CliHistoryVisibleWithoutSecondWriter
- **GIVEN** Pi CLI saved sessions for the active project in its per-cwd session directory
- **WHEN** the Outpost session menu opens
- **THEN** those sessions appear with a read-only CLI label and no switch, rename, or delete action
- **AND** a forged mutation against such a file is rejected by the server

#### Scenario: CliHistorySearchAndProjectIsolation
- **GIVEN** saved CLI sessions in two different project directories
- **WHEN** the user searches the first project's session menu by name or opening message
- **THEN** matching CLI history appears without any session from the other project

### Requirement: ParentChildSessionTree

Session summaries SHALL expose the SDK's parent session path as optional `parentSession`, resolved to an absolute filesystem path. The saved-session menu SHALL nest sessions beneath their listed parents, not group them only by date. Each parent SHALL have a separate accessible expand/collapse control. Session selection, rename, delete, current markers, and search snippets SHALL retain their existing behavior.

#### Scenario: NestedSessionSelection
- **GIVEN** a parent, child, and grandchild with different modification dates
- **WHEN** the user opens the session menu
- **THEN** descendants appear beneath their respective parents
- **AND** collapsing a parent hides its descendants without selecting a session
- **AND** selecting a child switches to that child's exact path and closes the menu

#### Scenario: MissingOrCyclicParents
- **GIVEN** missing parent paths, self references, or cyclic parent paths
- **WHEN** the session menu renders
- **THEN** every listed session remains reachable exactly once without recursive cycles

#### Scenario: FilteredSessionTree
- **GIVEN** a matching child whose parent does not match the search
- **WHEN** the search results render
- **THEN** the child appears as a root with its snippet, without adding the unmatched parent
- **AND** clearing the query restores the full parent-child tree

#### Scenario: NestedSessionActions
- **GIVEN** nested sessions including the current session
- **WHEN** the user renames or deletes a non-current child
- **THEN** the action targets that child's exact path
- **AND** the current marker remains visible on the current descendant
- **AND** removing a parent from the list leaves its children reachable

#### Scenario: ParentMetadataFromSdk
- **GIVEN** session files whose JSONL headers contain a parent session path
- **WHEN** the SDK lists the files and the server converts list or search results
- **THEN** both summaries expose that path as absolute `parentSession`
- **AND** sessions without a parent omit `parentSession`

### Requirement: DistinctCurrentSession

The saved-session menu SHALL distinguish the current session with a persistent contrasting background and outline in both themes, an accessible current marker, and text. Hovering another session SHALL NOT reproduce the current-session treatment.

#### Scenario: CurrentSessionContrast
- **WHEN** the saved-session menu opens
- **THEN** only the current session has `aria-current="true"`, a contrasting selected background and outline, and the current text marker
- **AND** other sessions retain their unselected hover treatment
