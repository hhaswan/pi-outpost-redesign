## 1. Implementation
- [x] 1.1 Protocol: `RecentSession`, `RECENT_SESSION_LIMIT`, `recent_sessions` request and answer.
- [x] 1.2 Server: `recentSessions()` from session stores of open main workspaces, newest first, capped at five, live status from started sessions.
- [x] 1.3 Client: start screen state for a new standalone tab, choice in flight held until it lands, nothing remembered until a choice.
- [x] 1.4 `StartScreen` component in the transcript area; composer hidden; rows and chips at least 44px.

## 2. Verification
- [x] 2.1 Server wire test `server/test/recentSessionsWire.test.mjs`.
- [x] 2.2 UI tests in `ui/src/useAgent.test.ts`, `ui/src/App.test.tsx`, `ui/src/components/StartScreen.test.tsx`.
- [x] 2.3 Built-app probe `scripts/check-start-screen.mjs` with monkey pass, phone and desktop; added to `scripts/update-custom-native.sh`.
- [x] 2.4 Existing fresh-tab probes and e2e specs leave the start screen before their own checks.
