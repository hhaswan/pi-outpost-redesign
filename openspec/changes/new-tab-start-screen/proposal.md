# New tab start screen

## Why
A new browser tab binds to the server's default project and shows that project's last
conversation. It is rarely the conversation the user wants, and it makes a new tab look like it
continued someone else's work.

## What Changes
- A standalone tab with no saved per-tab selection shows a start screen in the transcript area
  instead of the default project's conversation. The composer is hidden until a choice is made.
- "Recent": the five most recently modified saved conversations across every open project, with
  project name, title, relative time and live status. A click opens it where it lives.
- "Start a new chat in": one chip per open project, last used first, plus "Open a project…".
- New request `recent_sessions`, answered only to the asking client from each project's session
  stores. A stopped project is not started to be listed.
- A tab with a saved selection (refresh) restores directly, side sessions and running turns
  included. Embedded mode and `workspaceLock` show no start screen.

## Impact
- `shared/src/protocol.ts`: `RecentSession`, `RECENT_SESSION_LIMIT`, `recent_sessions` in both directions.
- `server/src/index.ts`: `recentSessions()` over main workspaces; served while an agent starts.
- `ui/src/useAgent.ts`, `ui/src/App.tsx`, `ui/src/components/StartScreen.tsx`.
- Built-app probes that open a fresh tab leave the start screen first (`scripts/leave-start-screen.mjs`,
  `e2e/startScreen.ts`); new probe `scripts/check-start-screen.mjs` in `scripts/update-custom-native.sh`.
