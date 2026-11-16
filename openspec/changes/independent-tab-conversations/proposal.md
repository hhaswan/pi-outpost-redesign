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
- A tab alone on a session keeps the in-place behaviour.
- Under `workspaceLock`, where side sessions are refused, the change stays shared and the asking tab
  is told why.
- Fork, edit prompt and tree navigation continue the shared conversation and stay shared.

## Impact
`server/src/index.ts` only (side-session creation extracted into one helper). Existing per-tab
selection restore already remembers side sessions by id. No new settings or protocol messages.
