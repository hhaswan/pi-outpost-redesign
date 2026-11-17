# Tasks

## 1. Implementation
- [x] 1.1 One-row wide header: project, π mark, session title, files; "+ new", sessions, Plan chip, More.
- [x] 1.2 More menu with Conversation, Tools, View, Status and Settings groups; popover on wide screens, tiles in the phone sheet.
- [x] 1.3 π mark: branded title as name and tooltip, pulse while working, reduced motion respected.
- [x] 1.4 One banner line: the update notice outranks the changes notice; the news is shown once per version.
- [x] 1.5 Model bar one row: lock as an icon badge, cost alone in the usage figure.

## 2. Verification
- [x] 2.1 `ui/src/components/Header.test.tsx`, `ModelBar.test.tsx`, `ui/src/App.test.tsx`.
- [x] 2.2 `scripts/check-responsive.mjs --strict-touch`: one header row of at most 60 px and a one-row model bar at every wide width, More and every menu in it inspected.
- [x] 2.3 Probes and e2e specs open More first (`scripts/open-more.mjs`, `e2e/openMore.ts`).
