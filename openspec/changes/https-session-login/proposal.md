# Proposal

## Why

The live server listens on `0.0.0.0:3141` over plain HTTP with `server.allowInsecureHttp: true`.
The master token crosses the LAN in cleartext on every WebSocket open (`?token=`), every inline
image and every download (`/files/raw?token=`, `/files/download?token=`). Browsers keep it in
`localStorage` (`pi-outpost:token`), where any script on the origin can read it, and a new device
can only sign in by typing or pasting the full token. There is no way to sign one device out, to
sign every device out, or to change the token without editing the configuration by hand.

`secure-remote-transport` already gave the server native HTTPS/WSS from PEM files
(`server.tls.certFile` / `keyFile`), but nothing issues a certificate that an iPad or a laptop on
the LAN will trust, so the live deployment still runs the plaintext exception.

## What Changes

- **Local CA and server certificate.** `pi-outpost tls init` creates a private local CA (10 years)
  and a server certificate (1 year) for the host's addresses (SAN: `<HOST_IP>`, `127.0.0.1`,
  `localhost`, the host name), stores them under `<userConfigDir>/tls/` with private keys `0600`,
  and writes `server.tls` (plus the new `server.tls.caFile`) into the loaded configuration.
  `pi-outpost tls renew` re-issues the server certificate from the same CA. Same port 3141.
  `tls init` is idempotent (an existing CA is reused; only `--new-ca` replaces it, with a
  re-trust warning). The running server never reads the CA private key. The TLS directory and
  `sessions.json` live outside the repository so re-clones, rebuilds and redeploys keep them.
- **CA download page.** Public, unauthenticated `GET /ca`, `/ca.crt` and `/ca.mobileconfig` on the
  HTTPS port: SHA-256 fingerprint and per-OS install steps (iOS profile + full trust, macOS
  Keychain, Windows, Android). Linked from the sign-in screen and from Settings (with a QR code of
  the `/ca` URL). The one-time browser warning before trust is documented.
- **Plain HTTP on the TLS port** gets one fixed redirect to `https://<allowed host>/`, decided by
  sniffing the first byte; the request path and query are never echoed.
- **BREAKING: cookie sessions replace the browser token flow.** `POST /api/login` exchanges the
  master token for an `HttpOnly; Secure; SameSite=Strict` `__Host-` cookie with a 14-day sliding
  expiry, backed by a revocable server-side store (`<userConfigDir>/sessions.json`, `0600`, hashed
  ids). The browser no longer stores the token. `?token=` is rejected on every route.
  `Authorization: Bearer <master token>` stays for non-browser clients and deploy scripts. No embed
  widget is in use, so no header-based WebSocket transport is added: a cross-origin widget cannot
  open a token-protected socket (known, out of scope).
- **Sign out, sign out everywhere, rotate token** in Settings and on the CLI
  (`pi-outpost token rotate [--revoke-sessions]`, `pi-outpost sessions revoke-all`). Revocation also
  closes open WebSockets.
- **QR pairing.** A signed-in device creates a one-time pairing code (2-minute TTL, single use,
  rate-limited) shown as a QR of `https://<host>:3141/pair#<code>` and as a typed code. The new
  device redeems it for its own 14-day session.
- **Deploy and probe scripts** move to HTTPS with explicit, scoped trust of the local CA and to
  Bearer or cookie sign-in instead of injecting `localStorage`.

## Capabilities

### New Capabilities

- `local-tls-ca`: CA and server-certificate issuance and renewal, file layout and permissions,
  `server.tls.caFile`, the public CA download routes, and the plain-HTTP redirect on the TLS port.
- `browser-session-auth`: cookie sessions, login, sliding renewal, the session store, revocation,
  sign-out, token rotation, QR pairing, URL-token refusal and the CLI commands for them.

### Modified Capabilities

- `auth`: protected surfaces accept a session cookie or a Bearer token, never a URL token; the
  browser token flow becomes a sign-in screen with no token persistence.

## Impact

- **Server**: `server/src/config.ts` (`server.tls.caFile`), `server/src/index.ts` (auth helper used
  by `/ws`, `/branding`, `/files/raw`, `/files/download`, `/files/docx-template`; new `/api/*` and
  `/ca*` routes; listener factory for the HTTP sniffer), new `server/src/sessions.ts`,
  `server/src/localCa.ts`, `server/src/cli.ts` (`tls`, `token`, `sessions` commands).
- **UI**: `ui/src/authToken.ts` removed or reduced to legacy cleanup, `TokenGate.tsx` becomes the
  sign-in screen, `useAgent.ts`, `util/workspacePath.ts`, `util/download.ts`, `SettingsMenu.tsx`
  (Security section), new pairing route. One small client dependency for QR rendering.
- **Scripts/tests**: listed in design.md § Deploy and probe impact.
- **Operations**: live cutover to `https://<HOST_IP>:3141`; every device installs the CA once;
  the master token is rotated because it has crossed the LAN in cleartext.
- **Out of scope by user choice**: per-device tokens or accounts (see `multi-user-local-accounts`),
  narrowing LAN reachability, reducing the agent's root shell power.
