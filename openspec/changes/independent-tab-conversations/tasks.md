## 1. Implementation
- [x] 1.1 Extract side-session creation from `handleOpenSideSession` into `createSideSession`.
- [x] 1.2 Route `new_session` and `switch_session` from a shared session through a side session for the asking tab.
- [x] 1.3 Keep in-place replacement for a lone tab and under `workspaceLock` (with a notice).

## 2. Verification
- [x] 2.1 Server wire tests `server/test/tabConversations.test.mjs`.
- [x] 2.2 Built-app Playwright probe `scripts/check-tab-sessions.mjs`, including a monkey pass.
- [x] 2.3 Probe added to `scripts/update-custom-native.sh`.
