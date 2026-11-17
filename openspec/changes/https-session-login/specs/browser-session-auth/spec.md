# browser-session-auth delta

## ADDED Requirements

### Requirement: TokenLoginIssuesSessionCookie

When a token is configured, `POST /api/login` with body `{ "token": <master token> }` SHALL,
on a timing-safe match, create a session and answer with a cookie
`__Host-pi-outpost-session` that is `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` and expires in
14 days. A wrong or missing token SHALL answer 401 without a cookie. The route SHALL be
rate-limited per client address and SHALL require an `Origin` equal to the server's own origin.

#### Scenario: LoginSetsHardenedCookie
- **WHEN** a same-origin client posts the correct token to `/api/login`
- **THEN** the response sets `__Host-pi-outpost-session` with `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/` and `Max-Age=1209600`
- **AND** the response body does not contain the token or the cookie value

#### Scenario: LoginWrongToken
- **WHEN** a client posts a wrong token to `/api/login`
- **THEN** the response is 401 and sets no cookie

#### Scenario: LoginRateLimited
- **WHEN** one address posts more than 10 login attempts within a minute
- **THEN** further attempts answer 429 without checking the token

#### Scenario: LoginCrossOriginRefused
- **WHEN** a request to `/api/login` carries an `Origin` that is not the server's own origin
- **THEN** the response is 403 and sets no cookie

### Requirement: RevocableSessionStore

Sessions SHALL be persisted in `<userConfigDir>/sessions.json` with mode `0600`, written atomically,
storing only a SHA-256 hash of each cookie value together with creation, last-use and expiry times,
a short client label and how the session was created (`token` or `pair`). The server SHALL reload
the store when the file changes on disk.

#### Scenario: StoreHoldsOnlyHashes
- **GIVEN** a session created by login
- **WHEN** `sessions.json` is read
- **THEN** its mode is `0600` and it contains the SHA-256 of the cookie value but not the cookie value itself

#### Scenario: StoreSurvivesRestart
- **GIVEN** a valid session cookie
- **WHEN** the server restarts
- **THEN** the same cookie still authenticates

### Requirement: SessionExpiryAndSlidingRenewal

A session SHALL expire 14 days after its last extension. An authenticated request made more than
one day after the last extension SHALL extend the expiry to 14 days from now, and HTTP responses to
such requests SHALL re-send the cookie with the new lifetime. `GET /api/session` SHALL report
whether the caller is signed in and renew as above; the browser client SHALL call it on load and
at least every 6 hours while open. Expired sessions MUST be rejected.

#### Scenario: ExpiredCookieRejected
- **GIVEN** a session whose expiry is in the past
- **WHEN** its cookie is sent to `/api/session`, `/files/raw` or `/ws`
- **THEN** HTTP routes answer 401 and the WebSocket closes with 4401 before any snapshot is sent

#### Scenario: UseExtendsExpiry
- **GIVEN** a session last extended 3 days ago
- **WHEN** its cookie is sent to `/api/session`
- **THEN** the stored expiry becomes 14 days from now and the response re-sends the cookie

#### Scenario: OpenSocketClosedOnExpiry
- **GIVEN** an open WebSocket authenticated by a session cookie
- **WHEN** that session's expiry passes without renewal
- **THEN** the server closes the socket with 4401 within 15 seconds

### Requirement: CookieAuthIsSameOriginOnly

A session cookie SHALL authenticate a request only when the request has no `Origin` header or its
`Origin` host equals the request `Host`. Embedding pages on other allowed origins SHALL
authenticate with the Bearer token. Mutating `/api/*` routes SHALL require an `Origin` equal to the
server's own origin.

#### Scenario: CrossOriginSocketWithCookieRefused
- **GIVEN** `https://other.example` is listed in `server.allowedOrigins`
- **WHEN** a WebSocket from that origin presents only a valid session cookie
- **THEN** the socket closes with 4401

#### Scenario: CrossOriginLogoutRefused
- **WHEN** `POST /api/logout` arrives with a valid cookie and a foreign `Origin`
- **THEN** the response is 403 and the session remains valid

### Requirement: UrlTokenRejected

The server SHALL reject any request to a protected route that carries a `token` query parameter,
with 401 for HTTP routes and close code 4401 for the WebSocket, regardless of the parameter's
value and of any other credential presented. The browser client SHALL strip a `token` parameter
from its own address bar without storing or using it.

#### Scenario: TokenInWsUrlRejected
- **WHEN** a WebSocket opens `/ws?token=<correct token>`
- **THEN** the socket closes with 4401 and no snapshot is sent

#### Scenario: TokenInRawUrlRejected
- **WHEN** `/files/raw?path=a.png&token=<correct token>` is requested, with or without a valid cookie
- **THEN** the response is 401

#### Scenario: TokenInPageUrlIgnored
- **WHEN** the browser opens `/?token=<correct token>` with no session
- **THEN** the address bar no longer contains `token`, nothing is written to `localStorage`, and the sign-in screen is shown

### Requirement: BearerTokenForNonBrowserClients

Protected routes, the WebSocket included, SHALL accept `Authorization: Bearer <master token>`.
Bearer authentication SHALL NOT create a session.

#### Scenario: DeployScriptBearer
- **WHEN** a client without cookie opens `/ws` with `Authorization: Bearer <master token>`
- **THEN** the connection proceeds and `sessions.json` is unchanged

### Requirement: SignOutAndRevocation

`POST /api/logout` SHALL delete the caller's session and clear its cookie; `POST
/api/sessions/revoke-all` and `pi-outpost sessions revoke-all` SHALL delete every session and
pairing code. Open WebSockets of removed sessions SHALL close with 4401, immediately for in-app
revocation and within 15 seconds for CLI changes. Settings SHALL offer "Sign out", "Sign out all
devices" and the signed-in session count.

#### Scenario: RevokedSessionRejectedOnOpenSocket
- **GIVEN** two browsers with open WebSockets on separate sessions
- **WHEN** one of them uses "Sign out all devices"
- **THEN** both sockets close with 4401 and both browsers show the sign-in screen
- **AND** the old cookies are rejected by `/api/session`

#### Scenario: LogoutOnlyThisBrowser
- **GIVEN** two signed-in browsers
- **WHEN** one uses "Sign out"
- **THEN** only that browser's session is removed and the other stays connected

#### Scenario: CliRevokeAllReachesRunningServer
- **GIVEN** an open WebSocket authenticated by a session cookie
- **WHEN** `pi-outpost sessions revoke-all` runs on the host
- **THEN** `sessions.json` holds no sessions and the socket closes with 4401 within 15 seconds

### Requirement: TokenRotation

Settings and `pi-outpost token rotate` SHALL write a new random token of at least 32 bytes to
`server.token` in the loaded configuration and show it once. Rotation SHALL be refused when the
token comes from `PI_OUTPOST_TOKEN` or the file is not writable. In-app rotation SHALL apply
immediately and by default revoke all other sessions; CLI rotation applies at restart and
`--revoke-sessions` revokes all sessions. Rotation SHALL invalidate pairing codes.

#### Scenario: OldTokenRejectedAfterInAppRotation
- **WHEN** a signed-in user rotates the token in Settings
- **THEN** `Authorization: Bearer <old token>` and `POST /api/login` with the old token are rejected and the new token is accepted
- **AND** the rotating browser stays signed in and other sessions are revoked

#### Scenario: RotationRefusedForEnvToken
- **GIVEN** the effective token comes from `PI_OUTPOST_TOKEN`
- **WHEN** rotation is requested from Settings or the CLI
- **THEN** it is refused with a message naming `PI_OUTPOST_TOKEN` and the configuration file is unchanged

### Requirement: QrPairing

A signed-in client SHALL obtain a pairing code from `POST /api/pair/create`: at least 50 random
bits, valid 2 minutes, single use, rate-limited on creation and redemption, shown as a QR of
`https://<current host>/pair#<code>` and as text. Opening `/pair#<code>`, or typing the code on the
sign-in screen, SHALL redeem it via `POST /api/pair` for a new independent 14-day session.

#### Scenario: PairingCreatesIndependentSession
- **GIVEN** a signed-in device that created a pairing code
- **WHEN** a second device opens `/pair#<code>` within 2 minutes
- **THEN** the second device receives its own session cookie and connects
- **AND** signing out the first device does not sign out the second

#### Scenario: PairingCodeReuseRejected
- **GIVEN** a pairing code already redeemed once
- **WHEN** it is posted to `/api/pair` again
- **THEN** the response is 401 and sets no cookie

#### Scenario: PairingCodeExpires
- **GIVEN** a pairing code created more than 2 minutes ago and never redeemed
- **WHEN** it is posted to `/api/pair`
- **THEN** the response is 401 and sets no cookie

#### Scenario: PairingRequiresSignedInCreator
- **WHEN** `POST /api/pair/create` arrives without a valid session or Bearer token
- **THEN** the response is 401

#### Scenario: PairingRedeemRateLimited
- **WHEN** one address posts more than 10 redemption attempts within a minute
- **THEN** further attempts answer 429 without checking the code

#### Scenario: PairingCodeStaysOutOfRequests
- **WHEN** the QR URL `https://<host>/pair#<code>` is opened
- **THEN** no request line or `Referer` sent by the browser contains the code
- **AND** the address bar no longer shows the fragment after redemption
