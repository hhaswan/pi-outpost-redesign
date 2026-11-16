# Design

## Breakpoints

- `phone`: below 768 px (`md`). One primary surface at a time.
- `tablet`: 768–1023 px. Sidebar overlays the chat as a drawer instead of pushing it.
- `desktop`: 1024 px and above. Unchanged.

A single `useViewport()` hook (extending `isNarrowViewport`) returns the class and whether
the pointer is coarse. Components read it instead of private `matchMedia` calls, so the
layout cannot disagree with itself (one panel thinks it is narrow, another does not).

## Shell on phones

```
┌──────────────────────────────┐  safe-area top
│ ◉ project ▾  Session title ⋯ │  44 px header, one row
├──────────────────────────────┤
│                              │
│   conversation (scrolls)     │  flex-1, the only scroller
│                              │
├──────────────────────────────┤
│ composer (sticky)            │  model bar collapses to one chip
├──────────────────────────────┤
│ Chat  Files  Sessions Plan ⌨ │  56 px bottom nav + safe-area bottom
└──────────────────────────────┘
```

- The header overflow menu (`⋯`) holds Filter, export, theme, Outcome, tree and Settings.
- The bottom nav switches the primary surface. Files, Sessions, Plan and Terminal open as
  full-screen sheets with a 44 px bar (back, title, close). Opening the file viewer from
  Files pushes a second sheet; back returns to the tree.
- The Work Plan chip and "Terminal sessions" move into the nav and the overflow menu, so
  nothing floats over content on phones.

## Sheets

One `Sheet` component: `fixed inset-0` (full) or `inset-x-0 bottom-0 max-h-[85dvh]`
(bottom sheet), rounded top `rounded-t-2xl`, focus trap, Escape and back gesture close,
body scroll locked. Settings, Tree, WorkspaceRoot, Git, Theme and Notifications use the
bottom sheet on phones and keep their dropdown on desktop.

## Sizing

- Shell height `100dvh`, not `height: 100%` (`web/src/index.css:60`).
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`.
- Padding with `env(safe-area-inset-*)` on header, composer and nav.
- Terminal sheet sized inside the shell (flex), never `vh` on top of it.
- `visualViewport` resize keeps the composer above the keyboard on iOS, where
  `interactive-widget` is ignored.

## Touch

- `pointer: coarse`: minimum 44×44 hit area for every button (extend `HEADER_CONTROL`;
  icon buttons get padding, not larger glyphs).
- Replace `opacity-0 group-hover:opacity-100` with
  `[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100`
  (the pattern `FileTree.tsx:32` already uses).
- File viewer toolbar: horizontal scroll with snap on phones; secondary modes in a menu.
- User bubbles: `break-words` / `[overflow-wrap:anywhere]`.

## Risks

- `App.tsx` is large; the shell change touches many conditionals. Mitigation: introduce
  the hook and sheets first, behind the phone class, then move one surface at a time.
- Existing desktop tests assume header buttons are visible. Keep desktop markup; phone
  markup renders only under the phone class.
- Virtual keyboard behaviour differs between iOS Safari and Android Chrome; needs a real
  device check before calling it done.
