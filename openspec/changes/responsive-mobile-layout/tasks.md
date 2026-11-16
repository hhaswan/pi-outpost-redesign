# Tasks

## 1. Foundations
- [x] 1.1 `useViewport()` hook (phone/tablet/desktop, coarse pointer) with unit tests; replace private narrow checks.
- [x] 1.2 `Sheet` component (full and bottom), focus trap, Escape/back close, scroll lock, tests.
- [x] 1.3 Viewport meta, `100dvh` shell, safe-area padding utilities.
- [x] 1.4 Built-app Playwright gate `scripts/check-responsive.mjs` at 360, 390, 768, 1280: no document overflow, no element beyond viewport, no overlapping controls at button centres, hit areas ≥ 44 px on phones, no hover-only controls, no page errors. Isolate the bridge registry (`PI_OUTPOST_BRIDGE_DIR`) in the fixture. Added to `update-custom-native.sh` with `--strict-touch`.

## 2. Phone shell
- [x] 2.1 One-row header with overflow menu; move secondary controls into it.
- [ ] 2.2 Bottom navigation (Chat, Files, Sessions, Plan, Terminal) with active state and badges (Plan progress, terminal activity). (Nav, active state and Plan badge done; terminal activity badge not done: the terminal state exposes no cheap activity signal.)
- [x] 2.3 Sidebar and file viewer as full-screen sheets; viewer pushes over tree; back returns.
- [x] 2.4 Terminal as sheet sized by flex inside the shell.
- [x] 2.5 Remove floating Plan chip and Terminal sessions button on phones (moved to nav/menu).

## 3. Menus and panels
- [x] 3.1 Settings, Tree, WorkspaceRoot, Git, Theme, Notifications as bottom sheets on phones. (Settings, Tree, Git, Theme and Filter open in place inside the Controls bottom sheet; WorkspaceRoot, the project menu and notifications are clamped to `100vw - 1rem`; each checked inside the viewport at 360.)
- [x] 3.2 Session analysis, Outcome, Work Plan: confirm full-width sheets, close button ≥ 44 px, nothing overlaps. (Work Plan is a `Sheet` on phones; analysis and Outcome remain full-width drawers.)
- [x] 3.3 Tablet: sidebar as overlay drawer (backdrop and Escape close it; opening a file steps it aside).

## 4. Touch and content
- [x] 4.1 44 px hit areas under coarse pointer or phone width (Send, Attach, viewer close/modes, message actions, Settings buttons, tree, Plan, menus) — `ui/src/touch.ts`.
- [x] 4.2 Gate all hover reveals with `@media (hover: hover)`; list them with `rg 'group-hover:opacity'` and cover each (static test in `ui/src/touch.test.ts`, built-app hover-only check).
- [x] 4.3 File viewer toolbar scrolls or collapses; user bubbles break long words.
- [x] 4.4 Composer sticky above keyboard (`visualViewport`); model bar collapses to one row with a truncating model chip.

## 4b. Image lightbox
- [x] 4b.1 `react-zoom-pan-pinch` lightbox component (pinch, wheel, double tap/click, pan, keys, prev/next, swipe down, focus return).
- [x] 4b.2 Wire into user attachments, assistant/tool images, markdown images and file viewer images.
- [x] 4b.3 Tests: unit + built-app Playwright at 390 and 1280.

## 5. Verification
- [x] 5.1 Scenario-to-test matrix in `scenario-coverage.md`.
- [ ] 5.2 Monkey pass: rotate, resize across breakpoints with sheets open, open/close sheets rapidly, switch project/session with a sheet open, send while keyboard open. (Done in emulation; sending with a real keyboard open needs a device.)
- [ ] 5.3 Real device check on iOS Safari and Android Chrome (keyboard, safe areas, back gesture).
- [ ] 5.4 Full UI suite, custom-build gate, deploy through the custom updater.
