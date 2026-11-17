# Tasks

## 1. Local CA and listener

- [ ] 1.1 Add `server.tls.caFile` parsing and fail-closed validation (CA constraint, no private key) in `server/src/config.ts`; config tests for both refusals.
- [ ] 1.2 Add `server/src/localCa.ts` (openssl via `execFile`, SAN discovery, `0700`/`0600` modes) and CLI `pi-outpost tls init|renew` writing `server.tls` through existing config persistence; tests for init, refuse-existing, renew-keeps-CA, missing openssl (Windows: path-safe assertions, explicit skip reason when openssl absent).
- [ ] 1.3 Add public `/ca`, `/ca.crt`, `/ca.mobileconfig` (strict CSP, no scripts, 404 without `caFile`); tests asserting fingerprint equality and that no response contains private key material and `ca.key` is never opened.
- [ ] 1.4 Add the first-byte sniffing `serverFactory` with the fixed 301/400 plaintext response; tests for redirect, foreign host, no path/query echo or logging, API unreachable over plaintext, and normal HTTPS/WSS unaffected.
- [ ] 1.5 Log certificate days-to-expiry at startup with a warning under 30 days.

## 2. Sessions and auth helper

- [ ] 2.1 Add `server/src/sessions.ts`: hashed store, atomic `0600` writes, mtime reload, sliding renewal, 15 s sweep closing expired/revoked sockets.
- [ ] 2.2 Replace per-route token checks in `server/src/index.ts` with one auth helper (URL-token rejection, Bearer header, WS bearer subprotocol, same-origin cookie, no-token loopback); apply to `/ws`, `/branding`, `/files/raw`, `/files/download`, `/files/docx-template`; update CORS route inventory.
- [ ] 2.3 Add `/api/login`, `/api/session`, `/api/logout`, `/api/sessions/revoke-all`, `/api/token/rotate`, `/api/pair/create`, `/api/pair` with rate limits and own-origin checks; serve the SPA at `/pair`.
- [ ] 2.4 Add CLI `pi-outpost token rotate [--revoke-sessions]` and `pi-outpost sessions revoke-all` (refuse env-sourced token); CLI tests.
- [ ] 2.5 Server tests for every `browser-session-auth` and modified `auth` scenario, including expired cookie, revoked session on an open socket (in-app and CLI), pairing reuse/expiry/rate limit, token in URL on each route, cross-origin cookie refusal.

## 3. UI

- [ ] 3.1 Replace `authToken.ts` localStorage flow with legacy cleanup and `?token=` stripping; `TokenGate.tsx` becomes the sign-in screen (token, pairing code, `/ca` link); `useAgent.ts` drops URL tokens and calls `/api/session` on load and every 6 h.
- [ ] 3.2 `util/workspacePath.ts` and `util/download.ts` stop adding `token=`; embed mode fetches raw/download with `Authorization` and uses object URLs; WS uses the bearer subprotocol in embed mode.
- [ ] 3.3 Settings Security section: CA fingerprint + QR of `/ca`, pair-a-device QR + typed code + countdown, session count, Sign out, Sign out all devices, Rotate token (show once, copy). Add `qrcode-generator` (lazy-loaded) following the npm install-security policy.
- [ ] 3.4 UI unit tests (`authToken`, `TokenGate`, `workspaceSelection`, `useAgent`, Settings).

## 4. Scripts, tests and docs

- [ ] 4.1 Update `scripts/deploy-custom-native.mjs` and `scripts/check-native-deploy.mjs` for HTTPS with CA-scoped trust, Bearer WS, `/api/login` sign-in in Playwright, https sessionStorage origin; add a TLS variant of the check.
- [ ] 4.2 Update `server/test/harness.mjs`, affected server tests, `e2e/*` (global setup, secure-transport, embed, openwebui-embed, host pages), `scripts/check-*.mjs`, `scripts/probes/*` and `deploy/docker/*` listed in design.md.
- [ ] 4.3 Update `docs/getting-started.md`, `docs/how-to.md`, `docs/docker.md`: TLS init/renew, CA install per OS with the first-visit warning, sign-in, pairing, rotation, no more `?token=` links.

## 5. Verification and cutover

- [ ] 5.1 Running-app Playwright over HTTPS: sign in, pair a second context by QR URL and by typed code, sign out, sign out all (both sockets drop), rotate token, `/ca` download; then a monkey pass (double submit, expired code, revoke while a turn streams, reload mid-pairing, cookie deleted under an open tab). Read back DOM, cookies, `sessions.json`.
- [ ] 5.2 Scenario-to-test matrix for all scenarios in this change (`rg '^#### Scenario:' openspec/changes/https-session-login`), focused and full suites, Windows CI, `openspec validate https-session-login --strict`.
- [ ] 5.3 Live cutover per design.md (backup config, `tls init`, origins, `token rotate`, deploy, enrol iPad and other devices), then verify `http://10.11.3.77:3141` redirects and `https://` serves with a trusted chain.
