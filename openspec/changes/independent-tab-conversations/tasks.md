## 1. Implementation
- [x] 1.1 Extract side-session creation from `handleOpenSideSession` into `createSideSession`.
- [x] 1.2 Route `new_session` and `switch_session` from a shared session through a side session for the asking tab.
- [x] 1.3 Keep in-place replacement for a lone tab and under `workspaceLock` (with a notice).
- [x] 1.4 Split a lone tab too when its session is working (turn, sub-agents, compaction); refuse reopening the working conversation itself.
- [x] 1.5 Announce workspace activity once a prompt's run settles, so an unwatched project turns idle.
- [x] 1.6 "+ new" asks for confirmation before leaving a non-empty conversation; one new chat per burst.
- [x] 1.7 Refuse `fork_session` while the session is working; disable the tree's fork control meanwhile.
- [x] 1.8 One shared `ConfirmDialog` for switch, fork, tree navigation, edit and compact; the double click that opens it cannot dismiss it.

## 2. Verification
- [x] 2.1 Server wire tests `server/test/tabConversations.test.mjs`.
- [x] 2.2 Built-app Playwright probe `scripts/check-tab-sessions.mjs`, including a monkey pass.
- [x] 2.3 Probe added to `scripts/update-custom-native.sh`.
- [x] 2.4 Busy-split wire tests in `server/test/tabConversations.test.mjs`; `ui/src/App.test.tsx` "NewChatAsksFirst".
- [x] 2.5 Built-app probe `scripts/check-new-chat-confirm.mjs` (desktop and phone, monkey pass), added to `scripts/update-custom-native.sh`.
- [x] 2.6 Fork refusal wire test; `ui/src/App.test.tsx` "ConversationChangesAskFirst"; `scripts/check-new-chat-confirm.mjs` covers every confirm path.
