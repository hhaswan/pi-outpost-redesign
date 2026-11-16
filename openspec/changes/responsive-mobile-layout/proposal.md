# Responsive and mobile layout

## Intent

Make pi-outpost usable on phones (360–430 px wide) and comfortable on tablets, without
changing the desktop layout at 1024 px and above. Keep the redesign's look: rounded
controls, clean typography, Tailwind only.

## Evidence

A Playwright audit of the built app (no model calls) at 360×740, 390×844, 768×1024 and
1280×800 found, ranked by impact:

1. The file sidebar keeps its ~288 px width beside the chat on phones; the chat column
   shrinks to ~70 px and the page overflows by 52–347 px (`Sidebar.tsx:132`).
2. The header wraps 11 controls onto 3–4 rows (159–209 px tall); with the composer and
   model bar only ~120 px of conversation remains at 360×740 (`Header.tsx:824`).
3. Dropdowns anchored `right-0` open off the left edge: Settings measured at -215 px
   (`SettingsMenu.tsx:344`), Tree (`TreeMenu.tsx:232`); same risk in
   `WorkspaceRootControl.tsx:121` and `ExtensionNotifications.tsx:60`.
4. Floating chips cover panel controls (Plan chip over Session analysis close).
5. The terminal (`65vh`/`85vh`, `TerminalPanel.tsx:452`) scrolls the whole page.
6. 9–15 touch targets under 44 px per phone screen (Send/Attach 32 px, viewer close 20 px).
7. Hover-only actions (`opacity-0 group-hover`) are invisible on touch: session rename and
   delete, message actions, tree, project and git menus.
8. File viewer toolbar overflows at 390 px; long words clip in user bubbles.

At 768 and 1280 there is no document overflow. Already responsive: Work Plan, Session
analysis and Outcome drawers (full width below `md`), sessions menu, model picker, CLI
sessions and MCP modals. Virtual keyboard and real touch gestures could not be tested
headless.

## Scope

- One narrow-layout breakpoint (below 768 px) from a single hook.
- Compact one-row header with an overflow menu; bottom navigation for Chat, Files,
  Sessions, Plan and Terminal.
- Panels (sidebar, file viewer, git history, terminal) as full-screen sheets on phones;
  dropdowns as bottom sheets.
- Sticky composer with safe-area insets, `dvh` sizing, `viewport-fit=cover`.
- Touch rules: 44 px hit areas under `pointer: coarse`; hover reveals gated by
  `@media (hover: hover)`.
- A built-app Playwright gate at phone, tablet and desktop widths, added to the custom
  updater.

## Non-goals

No separate mobile app or second codebase. No change to desktop layout at 1024 px and
above, except shared fixes (hover gating, word breaking). No PWA/offline work.
