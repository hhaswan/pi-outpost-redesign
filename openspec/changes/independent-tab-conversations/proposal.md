# Independent tab conversations

## Why
A project has one main runtime, and every browser tab on that project is bound to it. When one
tab starts a new conversation or switches to a saved one, the shared runtime is replaced and every
other tab on the project follows. Two tabs on the same project cannot hold different conversations.

## What Changes
- A conversation change (new session, switch session) asked by one tab on a session other tabs are
  watching moves only that tab onto its own side session, then makes the change there.
- Tabs viewing the same conversation stay mirrored until one of them changes conversation; nothing
  splits on connect.
- A tab alone on an idle session keeps the in-place behaviour. A tab alone on a working session
  (turn, sub-agents, compaction) moves onto a side session too, so the running
  work is never aborted by a conversation change.
- "+ new" asks for confirmation before leaving a conversation with items, and says the agent keeps
  working when it is busy. Switching conversation, fork, tree navigation, resending an edited prompt
  and compacting ask too, in the same dialog.
- A fork, which replaces the session in place, is refused while the agent works.
- Under `workspaceLock`, where side sessions are refused, the change stays shared and the asking tab
  is told why.
- Fork, edit prompt and tree navigation continue the shared conversation and stay shared.

## Impact
`server/src/index.ts`, `server/src/workspace.ts` (compaction flag), `ui/src/App.tsx` and
`ui/src/components/ConfirmDialog.tsx`, `ui/src/components/UserMessage.tsx`, `ui/src/components/TreeMenu.tsx`. Existing per-tab
selection restore already remembers side sessions by id. No new settings or protocol messages.
