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

### Requirement: InteractiveImageLightbox
Conversation and file-viewer images SHALL open in a full-screen lightbox with zoom (pinch, double
tap/click, mouse wheel, keys), panning, previous/next, and closing by Escape, button, backdrop or
swipe down. Focus SHALL return to the opening image.

#### Scenario: ImageOpensAndZooms
- **GIVEN** a conversation with two images
- **WHEN** the first image is clicked and the wheel is scrolled up over it
- **THEN** a lightbox dialog shows that image enlarged, ArrowRight shows the second image, and Escape closes it and returns focus to the first image

#### Scenario: LightboxOnPhone
- **GIVEN** a 390 px viewport
- **WHEN** an image is opened, double-tapped, and closed
- **THEN** the image fills the viewport without document overflow, double tap zooms in, and the close control is at least 44 px
