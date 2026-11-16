## ADDED Requirements

### Requirement: PhoneLayoutFitsTheViewport
Below 768 px the app SHALL show one primary surface at a time with a one-row header and a
bottom navigation, without horizontal document overflow, and no control SHALL extend
beyond the viewport or be covered by another control.

#### Scenario: PhoneShellHasNoOverflow
- **GIVEN** a 360×740 viewport with a loaded session and a Work Plan
- **WHEN** the app renders and each of Files, Sessions, Plan and Terminal is opened
- **THEN** the document does not scroll horizontally, every visible control is inside the viewport, and the control at each button's centre is that button

#### Scenario: PanelsOpenAsSheets
- **GIVEN** a phone viewport
- **WHEN** the file sidebar, file viewer, terminal or a dropdown menu is opened
- **THEN** it opens as a full-screen or bottom sheet with a close control of at least 44 px, and closing returns to the previous surface

### Requirement: TouchFriendlyControls
On coarse pointers every interactive control SHALL have a hit area of at least 44×44 px,
and no action SHALL be reachable only by hovering.

#### Scenario: TouchTargetsAndNoHoverOnlyActions
- **GIVEN** a phone viewport with a coarse pointer
- **WHEN** session, message, tree and file actions are inspected
- **THEN** each is visible without hover and has a hit area of at least 44×44 px

### Requirement: DesktopLayoutUnchanged
At 1024 px and above the layout SHALL remain as before this change.

#### Scenario: DesktopRegressionGate
- **GIVEN** a 1280×800 viewport
- **WHEN** the existing custom-build and layout gates run
- **THEN** they pass unchanged and the header stays on one row
