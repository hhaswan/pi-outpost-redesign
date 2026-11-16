# Scenario coverage

| Scenario | Status | Test and assertions |
| --- | --- | --- |
| NewConversationInOneTabStaysInThatTab | covered | `server/test/tabConversations.test.mjs`, "a new conversation in one tab leaves the other tab's conversation alone": asking tab gets `workspace_switched` to a side id on the same root with a new `sessionId` and no items; the other tab gets no `session_replaced` and no `workspace_switched`. `scripts/check-tab-sessions.mjs`: tab 4 clicks "+ new" (spammed six times) while sharing Alpha with tab 2; tab 4 empties onto a side, tab 2 still shows Alpha on the main session, spam builds one side only. |
| SwitchingConversationInOneTabStaysInThatTab | covered | `server/test/tabConversations.test.mjs`, "switching conversation in one tab ...": asking tab shows the saved transcript on a side session; the other tab gets no `session_replaced` and is refused when opening the same file. `scripts/check-tab-sessions.mjs`: tab 3 opens Beta from the sessions drawer, tab 2 keeps Alpha; concurrent switch of both tabs to Gamma leaves exactly one tab on Gamma, the other on Alpha with a visible refusal. |
| ALoneTabChangesConversationInPlace | covered | `server/test/tabConversations.test.mjs`, "a tab alone on a project changes conversation in place": `session_replaced` on the main id for new and switch, no `workspace_switched`, no side listed. `scripts/check-tab-sessions.mjs`: tab 2 alone switches to Alpha and its stored selection stays the main id. |
| LockedServerKeepsConversationShared | covered | `server/test/tabConversations.test.mjs`, "under a workspace lock ...": asking tab gets the "pinned to one project" notice; the other tab receives `session_replaced`. |
| ASplitSideSessionLivesWhileWatched | covered | `server/test/tabConversations.test.mjs`, "a tab's own side session lives while the tab watches it ...": with a 2 s idle timeout the side survives 5 s while watched and is closed after the tab disconnects. |
| ATabRestoresItsOwnConversationAfterReload | covered | `scripts/check-tab-sessions.mjs`: tab 3 reloads, its sessionStorage selection equals its side id and Beta is shown; tab 2 still shows Alpha. Fallback when the side is gone stays covered by the existing restore notice in `ui/src/useAgent.ts` tests. |

Fork, edit prompt and tree navigation intentionally stay shared (proposal, What Changes).
