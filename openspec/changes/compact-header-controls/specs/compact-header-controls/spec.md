## ADDED Requirements

### Requirement: OneRowHeader
At every width of 768 px and more the header SHALL be one row of at most 60 px holding the project,
the π mark, the session title, files, "+ new", sessions, the Work Plan chip and More controls.

#### Scenario: TheHeaderIsOneRow
- **GIVEN** the standalone app at 768, 1133 (touch), 1280 or 1440 px wide, with a conversation and a Work Plan
- **WHEN** the conversation is shown
- **THEN** the header is one row at most 60 px tall holding files, "+ new", sessions and More controls
- **AND** tree, Agents, Terminal sessions and Settings are not in that row

#### Scenario: TheSessionTitleIsShownInFull
- **GIVEN** a session with a long name
- **WHEN** the header shows it
- **THEN** it is shown whole in a small font, cut with an ellipsis only when the row has no room, its full text the title

### Requirement: PiMark
The branded title SHALL be the accessible name and tooltip of a π mark that takes its place in the
row. The mark SHALL move while the agent works, except under reduced motion.

#### Scenario: ThePiMarkShowsTheAgentWorking
- **GIVEN** the header's π mark
- **WHEN** a turn runs, or the project reports itself working
- **THEN** the mark pulses, and does not under `prefers-reduced-motion`; it stops once the agent is idle

### Requirement: MoreControlsMenu
Every control the header does not keep in its row SHALL be in the More menu, grouped as
Conversation, Tools, View, Status and Settings: a popover on a wide screen, the Controls sheet on a phone.

#### Scenario: EverythingElseIsInTheMoreMenu
- **WHEN** More controls is opened
- **THEN** it shows Conversation (tree, Outcome, export), Tools (Agents, Terminal sessions, terminal, branch), View (filter, theme), Status (the extension statuses, in full) and Settings
- **AND** every menu in it opens in place inside the viewport, and on a phone every tile is at least 44 px

#### Scenario: TheMoreMenuClosesLikeAMenu
- **GIVEN** the More menu open
- **WHEN** the user presses Escape, clicks outside, or picks a control that opens something over the conversation
- **THEN** the menu closes, while Escape inside one of its own menus closes only that menu

### Requirement: OneBannerLine
The banners above the header SHALL take one line at most.

#### Scenario: OneBannerLineAtMost
- **GIVEN** a newer release available and news of the last update
- **WHEN** the standalone app opens
- **THEN** only the update notice is shown; without it the news is shown, and a browser that showed it does not show it again for that version

### Requirement: OneRowModelBar
The model bar SHALL be one row: model, thinking, the shell's lock as an icon badge with its
description as tooltip and screen-reader text, context and the session's cost.

#### Scenario: TheModelBarIsOneRow
- **GIVEN** a long model name, a shell confinement verdict and a priced session
- **WHEN** the model bar is shown at any width
- **THEN** it does not wrap, the lock shows its icon only with its words for screen readers, and the usage figure is the cost, its token breakdown in the tooltip and behind the click
