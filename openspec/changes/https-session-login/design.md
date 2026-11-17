# Design

## Context

OpenLore is not installed on this host (`openlore` not on PATH, no MCP server), so implementation
evidence comes from targeted `rg` and reads at HEAD `42b1198`:

- `server/src/config.ts` already parses `server.tls.{certFile,keyFile}` (config-relative paths,
  `PI_OUTPOST_TLS_CERT`/`_KEY` overrides), refuses remote plaintext unless
  `server.allowInsecureHttp`, and requires a token off loopback (`requireTokenOffLoopback`).
  Unknown keys inside `server.tls` are ignored, so an older build tolerates `caFile`.
- `server/src/index.ts`: `tokenValid()` compares SHA-256 digests timing-safely. Token surfaces:
  `/ws` (Bearer header or `?token=`), `/branding` (Bearer), `/files/raw` and `/files/download`
  (Bearer or `?token=`), `/files/docx-template` (Bearer). WS auth failure closes with 4401 after the
  handshake. Origin allowlist: loopback dev origins plus `server.allowedOrigins`. `hostAllowed()`
  guards DNS rebinding only when no token is set. `@fastify/rate-limit` is registered with
  per-route opt-in.
- `ui/src/authToken.ts` captures `?token=`, stores it in `localStorage["pi-outpost:token"]`;
  `useAgent.ts` puts it in the WS URL and in raw/download URLs; `TokenGate.tsx` is the token screen.
- The embed widget receives an explicit token from its host page (`embed` spec,
  `HostSuppliesItsOwnToken`); the live config allows `http://10.11.3.77` as an embed origin.
- `server/src/cliBridge.ts` and `~/.pi/agent/extensions/pi-outpost-cli-bridge.js` authenticate
  server-to-CLI calls with their own per-registration token on loopback: not affected.
- `server/src/printMode.ts` reads a token from its own local input URL and sends it as Bearer to a
  loopback pair with TLS disabled: not affected.
- Config dir convention: `userConfigDir()` = `$XDG_CONFIG_HOME/pi-outpost` or
  `~/.config/pi-outpost` (live: `/root/.config/pi-outpost`). The live config file is
  `/root/pi-outpost.config.json` (`host 0.0.0.0`, `port 3141`, token set, `allowInsecureHttp`).
- Live service: systemd `pi-outpost`, custom build pinned by `scripts/deploy-custom-native.mjs`,
  which refuses a config with `server.tls`.

## User decisions (open questions answered)

1. No embed widget is in use: the WebSocket bearer subprotocol and the embed object-URL fetches
   are dropped. Bearer headers stay for scripts and non-browser clients. The embed e2e test that
   relied on a cross-origin token socket (`e2e/embed.spec.ts`, "a token-protected backend works
   across origins") is skipped with that reason; the bench probes that pass `&token=` say so.
2. SANs: `10.11.3.77`, `127.0.0.1`, `localhost` and the host name only. The default address is the
   configured literal host, else the source address of the default route (not every interface:
   this host has many Docker bridges); `--ip` replaces it.
3. `openssl` is an accepted dependency of `tls init|renew`.
4. Plain HTTP on the TLS port keeps the fixed 301 redirect.
5. TLS material must survive re-pull, re-clone, rebuild and redeploy: `tls init` reuses an
   existing CA (only `--new-ca` replaces it, moving the old one aside, with a re-trust warning)
   and keeps a valid server certificate; the TLS directory and `sessions.json` stay in the user
   config directory; `.gitignore` guards key and session file names; the deploy preflight refuses
   TLS paths in the repository and a certificate that does not chain to `caFile`; expiry under
   30 days is logged and shown in Settings, never auto-renewed (that needs `ca.key`).

## Goals / Non-Goals

Goals: trusted HTTPS on the LAN without a public CA; no token in URLs or browser storage;
revocable, expiring browser sessions; easy enrolment of a second device; a cutover plan.

Non-goals (user decisions): per-device or per-user tokens; restricting which LAN hosts can reach
port 3141; reducing what the agent's shell can do as root; ACME/public certificates; automatic CA
installation on clients.

## Decisions

### Certificates

- `pi-outpost tls init [--ip <addr>]... [--dns <name>]...` writes to `<userConfigDir>/tls/`
  (directory `0700`): `ca.key` (`0600`), `ca.crt`, `server.key` (`0600`), `server.crt`. Default
  SANs: the configured host when it is a literal address, otherwise every non-internal IPv4 address
  of the machine; plus `127.0.0.1`, `localhost`, `os.hostname()`. Live result:
  `IP:10.11.3.77, IP:127.0.0.1, DNS:localhost, DNS:<hostname>`. Superseded by decision 2:
  the default is the configured literal host, else the default route's source address.
- Generation shells out to `openssl` with `execFile` (no shell, no new npm dependency). ECDSA P-256,
  SHA-256. CA: 3650 days, `basicConstraints=critical,CA:TRUE,pathlen:0`,
  `keyUsage=critical,keyCertSign,cRLSign`. Server: 365 days (within Apple's 825-day limit for
  user-trusted CAs), `extendedKeyUsage=serverAuth`, `keyUsage=critical,digitalSignature`, SAN as
  above. Missing `openssl` fails with a message naming it and the "bring your own PEM files" path.
- `init` reuses an existing CA (decision 5) and keeps a server certificate with more than 30
  days left; `--new-ca` replaces the CA. `renew` re-issues only the server key and
  certificate from the existing CA, so devices never reinstall anything for 10 years. Both commands
  write `server.tls.{certFile,keyFile,caFile}` into the loaded config file through the existing
  config persistence (permissions kept), and say a restart is needed.
- New optional `server.tls.caFile`. At startup it must parse as an X.509 CA certificate and must not
  contain a `PRIVATE KEY` block; otherwise startup fails (TLS config already fails closed).
  `ca.key` is never named in the config and never opened by the server process.
- Startup logs the server certificate's days to expiry and warns under 30 days. Existing behaviour
  refuses an expired certificate.

### CA download

- `GET /ca` (HTML), `/ca.crt` (`application/x-x509-ca-cert`, DER), `/ca.mobileconfig`
  (`application/x-apple-aspen-config`, unsigned profile with a `com.apple.security.root` payload,
  UUIDs derived from the fingerprint). Public, GET only, routes exist only when `caFile` is set.
  Page: fingerprint (SHA-256 of DER, colon hex), validity, per-OS steps, a "Continue to pi-outpost"
  link. Strict CSP (`default-src 'none'; style-src 'unsafe-inline'; img-src data:`), no scripts.
- First visit to `https://10.11.3.77:3141` from an untrusted device shows a browser certificate
  warning once. It cannot be avoided before the CA is trusted; the page tells users to compare the
  fingerprint shown on `/ca` with the one in Settings on an already-trusted device.

### Plain HTTP on the TLS port

Chosen: the smallest useful helper. Fastify gets a `serverFactory`: an outer `net.Server` peeks the
first byte; `0x16` (TLS handshake) goes to the HTTPS server via `emit("connection")` after
`unshift`; anything else reads at most 8 KiB of request head (5 s timeout) and gets one fixed
`301 Location: https://<Host>/` when `Host` is an allowed host (configured host, SAN host,
loopback, or an `allowedOrigins` host), else a fixed `400` plaintext "this port speaks HTTPS".
The connection then closes. Path and query are never echoed or logged. This supersedes the
`secure-remote-transport` "never redirect" line only for this credential-free fixed response; a
legacy `?token=` still arrives in cleartext from the client side, which is why cutover rotates the
token. If the factory proves fragile it can be dropped without touching anything else.

### Sessions

- Cookie `__Host-pi-outpost-session=<32 random bytes, base64url>`; `HttpOnly; Secure;
  SameSite=Strict; Path=/; Max-Age=1209600`. `Secure` is always set; browsers accept it on HTTPS
  and on `http://localhost`/`127.0.0.1`, so loopback development keeps working.
- Store `<userConfigDir>/sessions.json` (`0600`, atomic temp+rename):
  `{ version: 1, sessions: [{ id: sha256(cookie), created, lastUsed, expires, label, via }] }`.
  `label` is a short user-agent summary; `via` is `token` or `pair`. Only hashes are stored.
- Validation: unknown or expired id rejects. Sliding renewal: when an authenticated request arrives
  and more than 1 day has passed since the last extension, `expires = now + 14 days`, persisted, and
  HTTP responses re-send the cookie. The UI calls `GET /api/session` on load and every 6 hours, so a
  tab that only holds a WebSocket still renews. No absolute lifetime cap (user choice: 14-day
  sliding); revoke-all and rotate cover a lost device.
- The server reloads the store when its mtime changes (CLI edits). A sweep every 15 s closes, with
  4401, every WebSocket whose session expired or disappeared. In-app revocation closes affected
  sockets immediately.
- Auth helper (one function used by every protected route):
  1. any `token` query parameter: reject `401` (WS: 4401) and log the route without the query;
  2. `Authorization: Bearer <master token>`: accept (no subprotocol, decision 1);
  3. session cookie: accept only when `Origin` is absent or its host equals the request `Host`
     (embed origins must use Bearer); 
  4. no token configured (loopback-only server): accept, as today.
- Mutating `/api/*` routes require an `Origin` equal to the server's own origin (CSRF defence in
  addition to `SameSite=Strict`).
- Routes: `POST /api/login {token}` (10/min/IP), `GET /api/session` (whoami + renewal + session
  count), `POST /api/logout`, `POST /api/sessions/revoke-all`, `POST /api/token/rotate
  {revokeOtherSessions}`, `POST /api/pair/create` (5/min), `POST /api/pair {code}` (10/min/IP,
  30/min global). `/health` and static assets stay public.

### Token rotation

New 32-byte base64url token written to `server.token` in the loaded config file. Refused, with the
reason, when the effective token comes from `PI_OUTPOST_TOKEN` or the file is not writable. In-app
rotation swaps the in-memory digest immediately and shows the new token once (copy button);
"also sign out all other devices" defaults on and keeps the current session. CLI
`pi-outpost token rotate [--revoke-sessions]` edits files only and prints the token once; the
running server applies it after a restart (`--revoke-sessions` takes effect within 15 s). Rotation
also invalidates outstanding pairing codes.

### Pairing

Code: 10 Crockford base32 characters (50 bits) from `crypto.randomBytes`, shown as `XXXXX-XXXXX`;
the same code goes in the QR URL `https://<location.host>/pair#<code>` (fragment, so it never
reaches server logs or `Referer`). Kept in memory as hashes with a 2-minute expiry; at most 3
outstanding (oldest dropped); deleted on first successful redemption, on revoke-all, on rotation
and on restart. Redemption normalises case, dashes, spaces, `I/L`→`1`, `O`→`0`. `/pair` serves the
SPA; the client reads and immediately clears the fragment, posts it, then navigates to `/`. The
sign-in screen has a typed-code field. Rate limits make guessing hopeless (≤60 guesses per code
lifetime against 2^50). QR rendering uses `qrcode-generator` (MIT, zero dependencies),
lazy-loaded in the UI.

### UI

- Sign-in screen (replaces `TokenGate`): token field, pairing-code field, "Install certificate"
  link to `/ca`, notice when a `?token=` link was opened (the parameter is stripped from the
  address bar and never used). On load, the legacy `localStorage["pi-outpost:token"]` is deleted.
- Settings, Security section: certificate fingerprint + QR of `https://<host>/ca`; "Pair a device"
  (QR, typed code, countdown); signed-in device count; "Sign out"; "Sign out all devices";
  "Rotate token".
- Embed (cross-origin host with explicit token): dropped (decision 1). The token goes only in the
  branding request's Bearer header, never in a URL.

## Threats

Addressed: passive LAN sniffing of token, prompts and files (TLS); token leakage through URLs,
history, logs, `Referer` and screenshots (no URL token); token theft by script on the origin
(`HttpOnly`, no `localStorage`); CSRF and cross-site WebSocket hijacking (`SameSite=Strict`, own-
origin check for cookie auth); lost device (revoke-all, rotate); stale sessions (14-day expiry);
pairing-code interception after use (single use, 2 minutes).

Not addressed (by user choice or out of scope): anyone holding the single master token has full
access, there are no per-device tokens; every LAN host can still reach port 3141; the agent and the
web terminal keep root shell power, so a signed-in session can read `ca.key`, `sessions.json` and
the config — TLS protects the wire, not the host; a compromised client device; an attacker who
gets a user to accept the first-visit warning for a spoofed server before the CA is installed
(mitigated only by comparing fingerprints).

## Deploy and probe impact

Must change (HTTPS and/or cookie/Bearer):

- `scripts/deploy-custom-native.mjs`: drop the "HTTP listener only" refusal; health and WS over
  `https:`/`wss:` with `ca` read from `server.tls.caFile`; Playwright sign-in through
  `context.request.post('/api/login')` or Bearer instead of `localStorage` injection; trust only the
  local CA via `--ignore-certificate-errors-spki-list=<server key SPKI hash>`; sessionStorage key
  origin becomes `https://127.0.0.1:<port>`.
- `scripts/check-native-deploy.mjs`: add a TLS variant using a test CA; WS keeps Bearer.
- `scripts/check-ui-layout-copy.mjs`, `check-shared-session.mjs`, `check-image-prompt.mjs`,
  `check-responsive.mjs`: replace token-in-URL/`localStorage` sign-in with `/api/login`.
- `scripts/probes/*` that open `?token=` URLs (`live-turn.mjs`, `drawio-anchors-live.mjs`,
  `collection-enroll-race.mjs`, `structured-arrangement/live.mjs`, `poster-*`, `owui-*`,
  `host-questions/serve.mts`): Bearer header or `/api/login`.
- `server/test/harness.mjs` and `server/test/auth.test.mjs`, `files-raw.test.mjs`,
  `files-download.test.mjs`, `mcpManagement.test.ts`, CORS route inventory tests: URL token becomes
  a rejection case; add cookie cases.
- `e2e/global-setup.ts`, `e2e/secure-transport.spec.ts`, `e2e/embed.spec.ts`,
  `e2e/openwebui-embed.spec.ts`, other e2e specs passing tokens, `e2e/host/*`: sign-in flow and
  the cross-origin token socket test skipped (decision 1).
- `deploy/docker/browser.mjs`, `test.mjs`, `bootstrap.mjs`, `compose.yml`: container recipes keep
  the protected-hop HTTP exception; sign-in via `/api/login`.
- UI unit tests: `authToken.test.ts`, `TokenGate.test.tsx`, `workspaceSelection.test.ts`,
  `useAgent.test.ts`.
- Docs: `docs/getting-started.md`, `docs/how-to.md`, `docs/docker.md` (token links, TLS setup).

`scripts/update-custom-native.sh` gains an optional second argument, the previous configuration,
passed to the deploy as `--previous-config`: during the cutover the running server still speaks
HTTP with the old token while the configuration file already has `server.tls` and the rotated
token. The live check signs in with Bearer through Playwright `extraHTTPHeaders` (the WebSocket
included), so it creates no session and rotates nothing.

Not affected: `scripts/native-deploy-network.mjs` (port-based iptables gate), the CLI bridge
extension, print mode (it already sends Bearer).

## Cutover plan (live server)

1. Back up `/root/pi-outpost.config.json` to `.pre-https`.
2. `pi-outpost tls init` on the host (SANs as above); it writes `server.tls`. In the same edit:
   remove `server.allowInsecureHttp`, change `allowedOrigins` entries from `http://10.11.3.77:3141`
   to `https://10.11.3.77:3141` (keep the embed origin if it is still used).
3. `pi-outpost token rotate` (the old token crossed the LAN in cleartext).
4. Deploy the new build with `scripts/update-custom-native.sh <config> <config>.pre-https` (one
   restart; the second argument describes the running HTTP server). From then on
   `http://10.11.3.77:3141` only answers the redirect; old `?token=` bookmarks stop working.
5. On each device once: open `https://10.11.3.77:3141/ca`, accept the warning, install the CA
   (iOS: install profile, then Settings → General → About → Certificate Trust Settings → enable
   full trust), reload, sign in with the new token or scan a pairing QR from a signed-in device.
The operator runbook is `docs/deployment.md` § HTTPS cutover runbook.
6. Rollback: deploy the previous release and restore `.pre-https`. The previous build also serves
   HTTPS from the same `server.tls`, so a rollback that keeps TLS is also possible.

## Risks / Trade-offs

- `openssl` dependency for `tls init|renew` only; Windows hosts without it bring their own PEM
  files. Windows CI must provide `openssl` or skip only the generation tests, with the skip reason.
- Deploying cookie auth while still on plaintext would break remote sign-in (browsers drop `Secure`
  cookies on `http://10.11.3.77`); the cutover therefore enables TLS in the same restart.
- The sniffing listener adds a code path in front of Fastify; it is isolated and removable.
- CLI token rotation needs a restart; in-app rotation does not.
