# Compact header and controls

## Intent

Give the conversation more of the screen on desktops and iPads by keeping the header to one
row and every secondary control in one grouped menu, at every width. Approved layout:

- Header left: project, a π mark (the branded title becomes its name and tooltip), the session
  title in full (smaller; cut only when the row truly lacks room), files.
- Header right: "+ new", sessions, the Work Plan chip, and `⋯` (More controls).
- More controls, grouped: Conversation (tree, Outcome, export HTML), Tools (Agents, Terminal
  sessions, terminal, git), View (filter, theme), Status (extension statuses), Settings. A
  popover on a wide screen; the phone's Controls sheet, as equal tiles of at least 44 px.
- The π mark pulses while the agent works (not under reduced motion) and grows on hover.
- Banners: one line at most. A newer release outranks the news of the last one, and that news
  is shown once per version in a browser.
- Model bar: one row — model, thinking, the shell's lock as an icon badge, context %, cost; the
  token breakdown stays behind the click.

## Evidence

`scripts/check-responsive.mjs` INFO lines, transcript share of the viewport, before and after
(same fixture, Work Plan drawer open): 1280x800 79.0% to 80.8%, 1133x744 (touch) 74.1% to
74.6%, 1440x900 81.3% to 82.9%, 768x1024 77.1% to 82.8%. Header 37 px (fine pointer) and 49 px
(touch) at every wide width.

## Impact

`ui/src/components/Header.tsx`, `ModelBar.tsx`, `ModelPicker.tsx`, `SettingsMenu.tsx`,
`TreeMenu.tsx`, `ChangesNotice.tsx`, `ui/src/App.tsx`. Probes open More first through
`scripts/open-more.mjs` (`e2e/openMore.ts` for the Playwright specs). Accessible names are
unchanged. No server or protocol change.
