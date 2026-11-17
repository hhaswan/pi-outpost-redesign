## ADDED Requirements

### Requirement: HeaderControlsAreOneHeight

`Header` SHALL keep the controls of its row one height, none of them wrapping its label.
A label the user does not choose SHALL be cut rather than wrapped, its full text available
on hover. The extensions' statuses SHALL be listed in full in the More menu, not in the row.

#### Scenario: EveryControlIsOneHeight
- **WHEN** the header shows a project, a title, statuses and every optional control
- **THEN** every control in the bar has the same height and a label that does not wrap

#### Scenario: ALongLabelIsCutNotWrapped
- **WHEN** the project's name or the branch is too long for the room left
- **THEN** it is cut with an ellipsis, and its full name is the control's title

## REMOVED Requirements

### Requirement: HeaderControlsShareOneRow
**Reason**: The statuses no longer sit in the header row, so they never fold or unfold there; they
are listed in full in the More menu (compact-header-controls, MoreControlsMenu).
**Migration**: The one-height and cut-label rules continue as HeaderControlsAreOneHeight.
