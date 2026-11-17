# Tasks

## 1. Local CA and listener

- [x] 1.1 Add `server.tls.caFile` parsing and fail-closed validation (CA constraint, no private key) in `server/src/config.ts` / `serverTransport.ts`; tests for both refusals.
- [x] 1.2 Add `server/src/localCa.ts` (openssl via `execFile`, SAN default per decision 2, `0700`/`0600` modes) and CLI `pi-outpost tls init|renew` writing `server.tls` through existing config persistence; `tls init` reuses an existing CA and keeps a valid server certificate, `--new-ca` replaces the CA with a warning and moves the old one aside; tests for init, init twice (identical bytes), reissue from the same CA, `--new-ca`, half CA refused, renew-keeps-CA, missing openssl (explicit skip reason when openssl is absent).
- [x] 1.3 Add public `/ca`, `/ca.crt`, `/ca.mobileconfig` (strict CSP, no scripts, 404 without `caFile`); tests asserting fingerprint equality, profile carrying only the certificate, no private key material served, and `ca.key` never opened (Linux FIFO check).
- [x] 1.4 Add the first-byte sniffing listener with the fixed 301/400 plaintext response; tests for redirect, foreign host, no path/query echo or logging, API unreachable over plaintext, and normal HTTPS/WSS unaffected.
- [x] 1.5 Log certificate days-to-expiry at startup with a warning under 30 days; report it on `/api/session` and show it in Settings (no auto-renewal: it needs `ca.key`).
- [x] 1.6 Keep TLS material outside the repository: `.gitignore` guard; deploy preflight refuses TLS paths inside the repository and a certificate that does not chain to `caFile`; test that the preflight leaves the TLS directory untouched.

## 2. Sessions and auth helper

- [x] 2.1 Add `server/src/authSessions.ts` (`sessions.ts` was taken): hashed store, atomic `0600` writes, mtime reload, sliding renewal, 15 s sweep closing expired/revoked sockets.
- [x] 2.2 Replace per-route token checks in `server/src/index.ts` with one auth helper (URL-token rejection, Bearer header, same-origin cookie, no-token loopback; no subprotocol per decision 1); apply to `/ws`, `/branding`, `/files/raw`, `/files/download`, `/files/docx-template`; update CORS route inventory.
- [x] 2.3 Add `/api/login`, `/api/session`, `/api/logout`, `/api/sessions/revoke-all`, `/api/token/rotate`, `/api/pair/create`, `/api/pair` with rate limits and own-origin checks; serve the SPA at `/pair`.
- [x] 2.4 Add CLI `pi-outpost token rotate [--revoke-sessions]` and `pi-outpost sessions revoke-all` (refuse env-sourced token); CLI tests.
- [x] 2.5 Server tests for every `browser-session-auth` and modified `auth` scenario.

## 3. UI

- [x] 3.1 Replace the `authToken.ts` localStorage flow with legacy cleanup, `?token=` stripping and `/pair#code` capture; `TokenGate.tsx` becomes the sign-in screen (token, pairing code, `/ca` link); `useAgent.ts` drops URL tokens and calls `/api/session` on load and every 6 h.
- [x] 3.2 `util/workspacePath.ts` and `util/download.ts` stop adding `token=`. (Embed object URLs and WS subprotocol dropped, decision 1.)
- [x] 3.3 Settings Security section: CA fingerprint + QR of `/ca`, pair-a-device QR + typed code + countdown, session count, certificate expiry notice, Sign out, Sign out all devices, Rotate token (show once, copy). `qrcode-generator` 2.0.4 (MIT, no install scripts), lazy-loaded.
- [x] 3.4 UI unit tests (`authToken`, `TokenGate`, `SecuritySettings`, `useAgent`, App, URL helpers).

## 4. Scripts, tests and docs

- [x] 4.1 `scripts/deploy-custom-native.mjs`: HTTPS with CA-scoped trust, Bearer WS and Bearer Playwright (`extraHTTPHeaders`, no session left behind), https sessionStorage origin, `--previous-config` for the cutover, TLS preflight; `scripts/check-native-deploy.mjs` gains the HTTPS cutover variant; `update-custom-native.sh` passes an optional previous config and runs the new probes.
- [x] 4.2 Update `server/test/harness.mjs` (temporary `XDG_CONFIG_HOME`, `bearer()`), affected server tests, `e2e/secure-transport.spec.ts`, `e2e/embed.spec.ts` (cross-origin token socket skipped, decision 1), `scripts/check-ui-layout-copy.mjs`, bench probes' notes, `deploy/docker/*`.
- [x] 4.3 Docs: `docs/deployment.md` (local CA, backups, sign-in, cutover runbook), `docs/how-to.md`, `docs/getting-started.md`, `docs/configuration.md`, `docs/command-line.md`, `docs/docker.md`.

## 5. Verification and cutover

- [x] 5.1 Running-app Playwright over HTTPS (`scripts/check-https-login.mjs`, phone and desktop): `/ca` public, sign in, reload, QR pairing, code reuse refused, sign out all drops the other browser, http redirect; monkey: double submit, code reuse, rapid sign-out/sign-in, cookie deleted under an open tab.
- [x] 5.2 Scenario-to-test matrix (`scenario-coverage.md`), focused and full suites, `openspec validate https-session-login --strict`.
- [ ] 5.3 Live cutover per `docs/deployment.md` § HTTPS cutover runbook (operator).
