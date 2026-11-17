# local-tls-ca delta

## ADDED Requirements

### Requirement: LocalCaIssuance

The CLI SHALL provide `pi-outpost tls init` that creates, under `<userConfigDir>/tls/` (mode
`0700`), a 10-year local CA and a 1-year `serverAuth` server certificate signed by it, with private
keys in mode `0600`, and SHALL write `server.tls.{certFile,keyFile,caFile}` into the loaded
configuration. Server SANs SHALL be the `--ip` addresses (default: the configured literal host,
else the default route's source address), `127.0.0.1`, `localhost`, the host name and `--dns`
values only.

#### Scenario: InitCreatesCaAndServerCertificate
- **GIVEN** no `<userConfigDir>/tls/ca.key` exists and the configured host is `0.0.0.0` on a machine with address `<HOST_IP>`
- **WHEN** `pi-outpost tls init` runs
- **THEN** `ca.key`, `ca.crt`, `server.key` and `server.crt` exist, both keys with mode `0600`
- **AND** `server.crt` is signed by `ca.crt`, expires in 365 days and lists `IP:<HOST_IP>`, `IP:127.0.0.1`, `DNS:localhost` and the host name
- **AND** the configuration's `server.tls` names the three public/serving files and never `ca.key`

#### Scenario: OpensslMissing
- **GIVEN** no `openssl` executable is on PATH
- **WHEN** `pi-outpost tls init` runs
- **THEN** it exits non-zero naming `openssl` and the option to configure existing PEM files

### Requirement: ExistingCaIsReused

`pi-outpost tls init` SHALL be idempotent: an existing CA SHALL be reused and never regenerated,
and a server certificate signed by it with more than 30 days left SHALL be kept. It MUST NOT
replace an existing CA unless `--new-ca` is given, which SHALL warn that every device must trust
the new CA again and SHALL move the old CA aside rather than delete it.

#### Scenario: InitReusesExistingCa
- **GIVEN** a CA and a valid server certificate created by `tls init`
- **WHEN** `pi-outpost tls init` runs again
- **THEN** it exits zero, says the existing CA was reused, and every file in `<userConfigDir>/tls/` is byte-for-byte unchanged
- **AND** when the server certificate is missing it is issued from the same, unchanged CA

#### Scenario: InitNewCaRequiresFlag
- **GIVEN** a CA created by `tls init`
- **WHEN** `pi-outpost tls init --new-ca` runs
- **THEN** a new CA is created, the output warns that every device must install and trust the new CA again, and the previous CA files are kept in a `replaced-<time>` directory

#### Scenario: InitHalfCaRefused
- **GIVEN** `ca.crt` exists without `ca.key`
- **WHEN** `pi-outpost tls init` runs without `--new-ca`
- **THEN** it exits non-zero, names the missing file and `--new-ca`, and changes nothing

### Requirement: ServerCertificateRenewal

The CLI SHALL provide `pi-outpost tls renew` that issues a new server key and 1-year certificate
from the existing CA with the same rules as `init`, leaves the CA key and certificate unchanged, and
states that a restart is required. The server SHALL log the days until its certificate expires at
startup, SHALL warn when fewer than 30 days remain, and SHALL report the days left to signed-in
clients so Settings shows the same notice. The server SHALL NOT renew by itself (it never opens
the CA key).

#### Scenario: RenewKeepsCa
- **GIVEN** a CA created by `tls init`
- **WHEN** `pi-outpost tls renew` runs
- **THEN** `server.crt` is replaced with a certificate valid for 365 days from now, signed by the unchanged `ca.crt`
- **AND** the SHA-256 fingerprint of `ca.crt` is unchanged

#### Scenario: ExpiryWarning
- **GIVEN** a server certificate expiring in 20 days
- **WHEN** the server starts
- **THEN** the startup output warns that the certificate expires in 20 days and names `pi-outpost tls renew`
- **AND** `GET /api/session` reports 20 days left and Settings, Security shows the notice

### Requirement: CaFileValidation

The configuration SHALL accept an optional `server.tls.caFile`, resolved like `certFile`. When set,
startup MUST fail closed unless the file parses as an X.509 certificate marked as a CA and contains
no private key material. The server process SHALL NOT open the CA private key.

#### Scenario: CaFileWithPrivateKeyRefused
- **GIVEN** `server.tls.caFile` names a PEM file that also contains a `PRIVATE KEY` block
- **WHEN** the server starts
- **THEN** startup fails with a message naming `server.tls.caFile` and without printing the key
- **AND** no listener is opened

#### Scenario: NonCaCertificateRefused
- **GIVEN** `server.tls.caFile` names a leaf certificate without the CA basic constraint
- **WHEN** the server starts
- **THEN** startup fails naming `server.tls.caFile`

### Requirement: PublicCaDownload

When `server.tls.caFile` is configured the server SHALL serve, without authentication on the HTTPS
listener, `GET /ca` (script-free page with the SHA-256 fingerprint and iOS, macOS, Windows and
Android install steps), `GET /ca.crt` (DER) and `GET /ca.mobileconfig` (iOS profile). These routes
MUST serve only `caFile` contents and MUST NOT serve any private key. Without `caFile` they SHALL
answer 404.

#### Scenario: CaPageIsPublic
- **GIVEN** a token-protected server with `caFile` configured
- **WHEN** a client without cookie or token requests `/ca`, `/ca.crt` and `/ca.mobileconfig`
- **THEN** each answers 200 with the documented content type
- **AND** the fingerprint on `/ca` equals the SHA-256 of the DER bytes served by `/ca.crt`

#### Scenario: CaPrivateKeyNeverServed
- **GIVEN** `ca.key` exists next to `ca.crt` in `<userConfigDir>/tls/`
- **WHEN** a client requests `/ca`, `/ca.crt`, `/ca.mobileconfig`, `/ca.key`, `/ca/../ca.key` and `/tls/ca.key`
- **THEN** no response body contains `PRIVATE KEY` or the key's bytes
- **AND** the server process never opened `ca.key`

#### Scenario: CaRoutesAbsentWithoutCaFile
- **GIVEN** `server.tls` without `caFile`
- **WHEN** a client requests `/ca.crt`
- **THEN** the server answers 404

#### Scenario: CaLinkedFromSignInAndSettings
- **GIVEN** a server with `caFile` configured
- **WHEN** the sign-in screen is shown, and when a signed-in user opens Settings
- **THEN** the sign-in screen links to `/ca`
- **AND** Settings shows the CA fingerprint and a QR code encoding `https://<current host>/ca`

### Requirement: PlainHttpOnTlsPort

When native TLS is active, a connection to the TLS port whose first byte is not a TLS handshake
SHALL receive one fixed plaintext HTTP response and be closed: `301` with
`Location: https://<Host>/` when the request `Host` is an allowed host, otherwise `400`. The
response MUST NOT include the request path or query, and the server MUST NOT log them. No other
route SHALL be reachable over plaintext.

#### Scenario: HttpRedirectsToHttpsRoot
- **GIVEN** TLS is active on port 3141 and `<HOST_IP>` is an allowed host
- **WHEN** a plain HTTP request `GET /?token=secret HTTP/1.1` with `Host: <HOST_IP>:3141` arrives on port 3141
- **THEN** the response is `301` with `Location: https://<HOST_IP>:3141/`
- **AND** neither the response nor the server log contains `secret`

#### Scenario: HttpForeignHostRefused
- **WHEN** a plain HTTP request with `Host: evil.example` arrives on the TLS port
- **THEN** the response is `400` with no `Location` header

#### Scenario: HttpCannotReachApi
- **WHEN** a plain HTTP `POST /api/login` arrives on the TLS port
- **THEN** the login handler does not run and the connection receives only the fixed response

### Requirement: TlsMaterialOutsideRepository

CA and server keys and certificates and `sessions.json` SHALL live only in the user config
directory, outside the repository and outside `.local/native-releases/`, so a re-pull, re-clone,
rebuild or redeploy keeps them. The repository SHALL ignore `ca.key`, `server.key`,
`sessions.json` and any `pi-outpost/tls/` directory. The deploy preflight SHALL refuse TLS paths
inside the repository.

#### Scenario: TlsInsideRepositoryRefused
- **WHEN** `server.tls.certFile` names a path inside the repository
- **THEN** the deploy preflight exits non-zero naming `server.tls.certFile` and the repository

### Requirement: DeploymentPreservesTls

The native updater and `scripts/deploy-custom-native.mjs` SHALL only read TLS files and SHALL
preserve `server.tls` in the configuration. The deploy preflight SHALL refuse a server
certificate that does not chain to `caFile` or has expired. The live deploy check SHALL talk
HTTPS trusting `caFile` only when `server.tls` is set, and plain HTTP otherwise.

#### Scenario: DeployLeavesTlsDirUntouched
- **GIVEN** a configuration with `server.tls` from `tls init`
- **WHEN** `scripts/deploy-custom-native.mjs <config> --check` runs
- **THEN** it passes and every file in the TLS directory keeps its bytes, mode and mtime, and the configuration file is unchanged

#### Scenario: MismatchedCertificateRefused
- **WHEN** `server.tls.certFile` is not signed by `server.tls.caFile`
- **THEN** the deploy preflight exits non-zero naming `pi-outpost tls renew` before any restart

#### Scenario: HttpsCutoverDeploy
- **GIVEN** a running plain-HTTP service, and its configuration changed by `tls init` and `token rotate`
- **WHEN** the deployment runs with `--previous-config` naming the file the running service used
- **THEN** it captures sessions over HTTP with the old token, restarts, verifies over HTTPS trusting `caFile` with the new token, and leaves no browser session behind
