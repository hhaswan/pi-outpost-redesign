# Auth delta

## MODIFIED Requirements

### Requirement: ProtectedSurfaces

When a token is configured, the system SHALL require either a valid session cookie (see
`browser-session-auth`) or `Authorization: Bearer <token>` on the WebSocket, `/branding`,
`/files/raw`, `/files/download`, `/files/docx-template` and every authenticated `/api/*` route,
comparing tokens timing-safely. A `token` URL query parameter MUST NOT
authenticate and SHALL cause rejection. Static assets, `/health`, the CA download routes,
`/api/login` and `/api/pair` stay public; `/health` MUST NOT expose the session id while auth is
enabled. The WS handshake completes before an auth failure closes the socket with code 4401, so the
client can distinguish bad credentials from an unreachable server.

#### Scenario: WsWithValidToken
- **WHEN** a WS connection presents a valid session cookie from the server's own origin, or a valid Bearer token in the `Authorization` header
- **THEN** the connection proceeds normally (Origin allowlist still applies)

#### Scenario: WsWithBadToken
- **WHEN** a WS connection has a missing, wrong or expired credential, or a `token` query parameter
- **THEN** the handshake completes and the socket closes immediately with code 4401
- **AND** no snapshot or agent data is sent

#### Scenario: BrandingRequiresBearer
- **WHEN** GET /branding has neither a valid session cookie nor a valid Authorization: Bearer header
- **THEN** 401 is returned

#### Scenario: HealthRedacted
- **WHEN** GET /health is called while auth is enabled
- **THEN** 200 with ok status but without the session id

### Requirement: BrowserTokenFlow

The standalone frontend SHALL NOT persist the token. On load it SHALL delete any legacy
`localStorage["pi-outpost:token"]`, strip a `token` URL parameter without using it, and ask
`GET /api/session` whether it is signed in. When not signed in, or on a 4401 close, it SHALL stop
reconnecting and show a sign-in screen offering the token (posted to `/api/login`), a pairing code
(posted to `/api/pair`) and a link to `/ca`. A successful sign-in reconnects using the session
cookie. The embed widget SHALL send the token its host supplies only as a Bearer header on its
HTTP requests and SHALL NOT put it in any URL; a cross-origin widget therefore cannot open a
token-protected WebSocket (no header-based WebSocket transport is provided: no widget is in use).

#### Scenario: LegacyStoredTokenRemoved
- **GIVEN** `localStorage["pi-outpost:token"]` holds a value from an earlier version
- **WHEN** the app loads
- **THEN** the key is deleted and is not sent anywhere

#### Scenario: TokenInUrl
- **WHEN** the app loads with `?token=<value>` in its address
- **THEN** the parameter is stripped from the address bar, is not stored, and is not sent to the server

#### Scenario: SignInWithToken
- **WHEN** the user submits the correct token on the sign-in screen
- **THEN** the browser receives a session cookie, connects, and `localStorage` contains no token

#### Scenario: BadStoredToken
- **WHEN** the WS closes with code 4401
- **THEN** the reconnect loop stops and the sign-in screen is shown

#### Scenario: EmbedToken
- **WHEN** the embed widget is mounted with a token option
- **THEN** that token is sent as a Bearer header on the branding request and appears in no URL, neither the WebSocket URL nor raw-file or download URLs
