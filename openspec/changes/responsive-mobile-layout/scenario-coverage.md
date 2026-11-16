# Scenario coverage

Every `#### Scenario:` in this change (`rg '^#### Scenario:' openspec/changes/responsive-mobile-layout`
lists six), mapped to the tests whose assertions would fail if its GIVEN/WHEN/THEN broke.
Built-app checks run against `cli/dist` in Chromium; phone contexts emulate touch, so
`(hover: none)` and `(pointer: coarse)` match there.

| Scenario | Status | Tests |
|---|---|---|
| PhoneShellHasNoOverflow | covered | `scripts/check-responsive.mjs` at 360×740 and 390×844 with a loaded session and a Work Plan: checks `chat`, `files`, `file viewer`, `sessions sheet`, `plan`, `terminal`, `chat after surfaces` — document width, every visible control inside the viewport, and the element at each button's centre being that button. `shell` checks: one 44 px header row, one-row model bar, one-line activity strip. `ui/src/App.test.tsx` › Phone shell › "switches surfaces one at a time…" |
| PanelsOpenAsSheets | covered | `scripts/check-responsive.mjs`: `files` / `file viewer` / `file viewer back` (push and back), `sessions sheet`, `plan` / `plan closed` (sheet, its 44 px close, Escape), `terminal` (sheet sized inside the shell, no page scroll), `overflow menu: <each menu>` (every menu opened in place in the bottom sheet and closed again), `project menu`; hit areas under `--strict-touch` include every sheet close. `ui/src/components/Sheet.test.tsx` (modal, 44 px close, Escape and back, focus return, Tab trap, scroll lock). `ui/src/App.test.tsx` › Phone shell › "opens the Work Plan in a sheet with one touch-sized close, and Escape closes it", "traps focus in the terminal sheet, leaves Escape to the shell, and returns focus on close", "overlays the file sidebar as a drawer on a tablet…". `scripts/check-ui-layout-copy.mjs` › "width 390: … Plan in the nav opens a sheet". |
| TouchTargetsAndNoHoverOnlyActions | covered (emulated); partial on real devices | `scripts/check-responsive.mjs --strict-touch` at 360 and 390: every visible button ≥ 44×44 on chat (message, copy, composer), Files (tree rows, `@`, `⋯`, create, refresh), viewer toolbar (scrolled to its end), Sessions (rename, delete), Plan (close, rows), overflow menus and Settings with its folded sections opened; `hover-only` violation for any transparent control under `(hover: none)`; self-test proves the hover-only detector fires; 1280 `desktop hover reveal` proves the desktop still hides until hover. `ui/src/touch.test.ts` › "leave no ungated hover-only reveal in any component". `ui/src/components/UserMessage.test.tsx` › "hides its actions until hover only where there is hover…". `ui/src/components/WorkPlanPanel.test.tsx` touch tests. Real-device check (task 5.3) not done. |
| DesktopRegressionGate | covered | `scripts/check-responsive.mjs` at 1280×800: `desktop shell` (one-row header, its controls, no bottom navigation, no compact header), `desktop hover reveal`, `plan closed`, `sessions`. `npm run check:custom-build`, `scripts/check-ui-layout-copy.mjs` › "width 1280", full `ui` suite. |
| ImageOpensAndZooms | covered | `scripts/check-image-lightbox.mjs` › "desktop: open, wheel zoom, ArrowRight 2 / 2 with reset, + / 0, Escape and focus return". `ui/src/components/ImageLightbox.test.tsx` › "walks the conversation's images…", "closes on Escape and returns focus to the image that opened it". |
| LightboxOnPhone | covered (emulated); partial on real devices | `scripts/check-image-lightbox.mjs` › "phone: fills 390x844, no overflow, close 44px+, double tap zooms, …", "phone: close button closes, rapid tap open/close, no errors". Real pinch and swipe on a device not checked. |

## Supporting checks (not scenarios)

- Keyboard: `ui/src/useKeyboardInset.test.ts` (visual-viewport inset, pinch-zoom ignored, no
  listener on desktop). The iOS keyboard itself needs a real device (task 5.3).
- Monkey pass: `.local/mobile-polish/monkey.mjs` (360/390: rapid menu and surface spam,
  composer draft across sheets, rotation with each surface open, breakpoint crossings
  767/768/1023/1024 with the drawer open, terminal Escape and focus return). Its "shell
  output survives close and reopen" probe is environment-blocked here (node-pty prebuild
  missing), so shell survival across close is asserted only through the mounted panel.
