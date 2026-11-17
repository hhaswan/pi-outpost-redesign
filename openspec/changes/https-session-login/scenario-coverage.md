# Scenario coverage

Enumerated with `rg '^#### Scenario:' openspec/changes/https-session-login` (55 scenarios).
OpenLore is not installed on this host; coverage was checked with `rg` and by reading assertions.
`server/test/*` run with `node --import tsx/esm --test`; `ui/src/*` with `vitest`; probes with node.

| Scenario | Status | Test |
|---|---|---|
| auth / WsWithValidToken | covered | `server/test/auth.test.mjs` "WsWithValidToken…"; cookie case in `server/test/sessionAuth.test.mjs` "a session cookie opens every protected surface…" |
| auth / WsWithBadToken | covered | `auth.test.mjs` "WsWithBadToken / TokenInWsUrlRejected…" (missing, wrong, URL token; no message received); expired cookie in `sessionAuth.test.mjs` "ExpiredCookieRejected" |
| auth / BrandingRequiresBearer | covered | `auth.test.mjs` "BrandingRequiresBearer / HealthRedacted…" |
| auth / HealthRedacted | covered | same test |
| auth / LegacyStoredTokenRemoved | covered | `ui/src/authToken.test.ts` "LegacyStoredTokenRemoved…"; hook level `ui/src/useAgent.test.ts` "LegacyStoredTokenRemoved and TokenInUrl…" (nothing sent) |
| auth / TokenInUrl | covered | `authToken.test.ts` "TokenInUrl / TokenInPageUrlIgnored…"; `useAgent.test.ts` "LegacyStoredTokenRemoved and TokenInUrl…" (no request or socket URL carries it) |
| auth / SignInWithToken | covered | `ui/src/components/TokenGate.test.tsx` "SignInWithToken…"; `useAgent.test.ts` "submitToken trades the token for a session and reconnects"; `scripts/check-https-login.mjs` (cookie HttpOnly/Secure/Strict, no token in localStorage, connected) |
| auth / BadStoredToken | covered | `useAgent.test.ts` "BadStoredToken: a 4401 close stops reconnecting…" |
| auth / EmbedToken | covered | `useAgent.test.ts` "EmbedToken: … branding gets it as Bearer"; `ui/src/util/workspacePath.test.ts`, `download.test.ts` (no token in URLs) |
| browser-session-auth / LoginSetsHardenedCookie | covered | `sessionAuth.test.mjs` "LoginSetsHardenedCookie"; browser-side attributes in `check-https-login.mjs` |
| browser-session-auth / LoginWrongToken | covered | `sessionAuth.test.mjs` "LoginWrongToken" |
| browser-session-auth / LoginRateLimited | covered | `sessionAuth.test.mjs` "LoginRateLimited and PairingRedeemRateLimited…" (11th with the right token gets 429, no cookie) |
| browser-session-auth / LoginCrossOriginRefused | covered | `sessionAuth.test.mjs` "LoginCrossOriginRefused" |
| browser-session-auth / StoreHoldsOnlyHashes | covered | `sessionAuth.test.mjs` "StoreHoldsOnlyHashes" |
| browser-session-auth / StoreSurvivesRestart | covered | `sessionAuth.test.mjs` "StoreSurvivesRestart…" (session written by an earlier run, read at startup) |
| browser-session-auth / ExpiredCookieRejected | covered | `sessionAuth.test.mjs` "ExpiredCookieRejected" (`/api/session`, `/files/raw` 401; `/ws` 4401, no message) |
| browser-session-auth / UseExtendsExpiry | covered | `sessionAuth.test.mjs` "UseExtendsExpiry"; `server/test/authSessions.test.ts` "sliding renewal…" |
| browser-session-auth / OpenSocketClosedOnExpiry | covered | `sessionAuth.test.mjs` "OpenSocketClosedOnExpiry and CliRevokeAllReachesRunningServer…" (closed under 16.5 s) |
| browser-session-auth / CrossOriginSocketWithCookieRefused | covered | `sessionAuth.test.mjs` "CrossOriginSocketWithCookieRefused" |
| browser-session-auth / CrossOriginLogoutRefused | covered | `sessionAuth.test.mjs` "CrossOriginLogoutRefused" |
| browser-session-auth / TokenInWsUrlRejected | covered | `auth.test.mjs` (correct URL token, with and without Bearer); `sessionAuth.test.mjs` "UrlTokenRejected…" (with cookie) |
| browser-session-auth / TokenInRawUrlRejected | covered | `server/test/files-raw.test.mjs` "with a token configured…"; `sessionAuth.test.mjs` "UrlTokenRejected…" (every route, cookie and Bearer present) |
| browser-session-auth / TokenInPageUrlIgnored | covered | `authToken.test.ts` "TokenInUrl / TokenInPageUrlIgnored…"; `TokenGate.test.tsx` notice; `e2e/secure-transport.spec.ts` (not run here, see below) |
| browser-session-auth / DeployScriptBearer | covered | `sessionAuth.test.mjs` "DeployScriptBearer" (sessions.json byte-identical); `scripts/check-native-deploy.mjs` "HttpsCutover…" (no session left) |
| browser-session-auth / RevokedSessionRejectedOnOpenSocket | covered | `sessionAuth.test.mjs` "RevokedSessionRejectedOnOpenSocket"; browser: `check-https-login.mjs` (sign out all from B shows sign-in in A without reload) |
| browser-session-auth / LogoutOnlyThisBrowser | covered | `sessionAuth.test.mjs` "LogoutOnlyThisBrowser" |
| browser-session-auth / CliRevokeAllReachesRunningServer | covered | `sessionAuth.test.mjs` "OpenSocketClosedOnExpiry and CliRevokeAllReachesRunningServer…" (real CLI process) |
| browser-session-auth / OldTokenRejectedAfterInAppRotation | covered | `sessionAuth.test.mjs` "OldTokenRejectedAfterInAppRotation" |
| browser-session-auth / RotationRefusedForEnvToken | covered | `sessionAuth.test.mjs` "RotationRefusedForEnvToken" (in-app 409 and CLI exit 1, file unchanged) |
| browser-session-auth / PairingCreatesIndependentSession | covered | `sessionAuth.test.mjs` "PairingCreatesIndependentSession and PairingCodeReuseRejected"; browser: `check-https-login.mjs` (QR link in a second context) |
| browser-session-auth / PairingCodeReuseRejected | covered | same server test; `authSessions.test.ts`; browser: `check-https-login.mjs` (third context refused) |
| browser-session-auth / PairingCodeExpires | covered | `server/test/pairingExpiry.test.mjs` (real 2-minute wait, 401 and no cookie); `authSessions.test.ts` (clock) |
| browser-session-auth / PairingRequiresSignedInCreator | covered | `sessionAuth.test.mjs` "PairingRequiresSignedInCreator" |
| browser-session-auth / PairingRedeemRateLimited | covered | `sessionAuth.test.mjs` "LoginRateLimited and PairingRedeemRateLimited…" |
| browser-session-auth / PairingCodeStaysOutOfRequests | covered | `useAgent.test.ts` "PairingCodeStaysOutOfRequests…" (code only in the POST body, fragment cleared, socket waits); browser: `check-https-login.mjs` (no request URL or Referer carries the code, hash empty) |
| local-tls-ca / InitCreatesCaAndServerCertificate | covered | `server/test/localCa.test.mjs` "InitCreatesCaAndServerCertificate" (modes, chain, 365 days, exactly 4 SANs, config never names ca.key) |
| local-tls-ca / OpensslMissing | covered | `localCa.test.mjs` "OpensslMissing" |
| local-tls-ca / InitReusesExistingCa | covered | `localCa.test.mjs` "InitReusesExistingCa: init twice keeps … byte for byte" and "… a missing server certificate is reissued from the same CA" |
| local-tls-ca / InitNewCaRequiresFlag | covered | `localCa.test.mjs` "InitNewCaRequiresFlag…" |
| local-tls-ca / InitHalfCaRefused | covered | `localCa.test.mjs` "InitHalfCaRefused…" |
| local-tls-ca / RenewKeepsCa | covered | `localCa.test.mjs` "RenewKeepsCa" |
| local-tls-ca / ExpiryWarning | covered | `localCa.test.mjs` "ExpiryWarning and CaRoutesAbsentWithoutCaFile" (log + `/api/session` 20 days); `ui/src/components/SecuritySettings.test.tsx` "ExpiryWarning…" |
| local-tls-ca / CaFileWithPrivateKeyRefused | covered | `localCa.test.mjs` "CaFileWithPrivateKeyRefused and NonCaCertificateRefused" |
| local-tls-ca / NonCaCertificateRefused | covered | same test |
| local-tls-ca / CaPageIsPublic | covered | `localCa.test.mjs` "CaPageIsPublic, CaPrivateKeyNeverServed and plain HTTP…"; browser: `check-https-login.mjs` |
| local-tls-ca / CaPrivateKeyNeverServed | covered | same test (bodies, plus Linux FIFO proof that ca.key was never opened) |
| local-tls-ca / CaRoutesAbsentWithoutCaFile | covered | `localCa.test.mjs` "ExpiryWarning and CaRoutesAbsentWithoutCaFile" |
| local-tls-ca / CaLinkedFromSignInAndSettings | covered | `TokenGate.test.tsx` "CaLinkedFromSignInAndSettings…"; `SecuritySettings.test.tsx` "CaLinkedFromSignInAndSettings…"; browser: `check-https-login.mjs` |
| local-tls-ca / HttpRedirectsToHttpsRoot | covered | `localCa.test.mjs` (raw socket, Location, no `secret` in answer or log); `server/test/serverTransport.test.mjs` "NoPlaintextFallback…"; browser and real service: `check-https-login.mjs`, `check-native-deploy.mjs` |
| local-tls-ca / HttpForeignHostRefused | covered | `localCa.test.mjs` |
| local-tls-ca / HttpCannotReachApi | covered | `localCa.test.mjs` (no sessions.json created) |
| local-tls-ca / TlsInsideRepositoryRefused | covered | `scripts/deploy-tls-preflight.test.mjs` |
| local-tls-ca / DeployLeavesTlsDirUntouched | covered | `scripts/deploy-tls-preflight.test.mjs` (bytes, mode, mtime, config unchanged); updater/deploy source never write TLS files (same file, static) |
| local-tls-ca / MismatchedCertificateRefused | covered | `scripts/deploy-tls-preflight.test.mjs` |
| local-tls-ca / HttpsCutoverDeploy | covered | `scripts/check-native-deploy.mjs` "HttpsCutoverWithPreviousConfiguration" (real disposable systemd service) |

Not run in this environment: the Playwright e2e suite (`e2e/`), because its global setup needs
`embed/dist`, and `npm run build --workspace @pi-outpost/embed` fails at HEAD `bce1b88` already
(`Cannot apply unknown utility class bg-slate-50` from `web/src/index.css`). `e2e/secure-transport.spec.ts`
was updated to the sign-in flow; the browser scenarios it covers are also covered by
`scripts/check-https-login.mjs`, which ran. `e2e/embed.spec.ts` "a token-protected backend works
across origins" is skipped: it needs the dropped cross-origin WebSocket transport (decision 1).
