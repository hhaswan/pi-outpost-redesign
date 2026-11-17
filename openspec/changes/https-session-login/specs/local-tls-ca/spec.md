# local-tls-ca delta

## ADDED Requirements

### Requirement: LocalCaIssuance

The CLI SHALL provide `pi-outpost tls init` that creates, under `<userConfigDir>/tls/` (mode
`0700`), a 10-year local CA and a 1-year `serverAuth` server certificate signed by it, with private
keys in mode `0600`. Server SANs SHALL cover the host's address(es), `127.0.0.1`, `localhost`, the
host name and any `--ip`/`--dns` values. The command SHALL write `server.tls.{certFile,keyFile,caFile}`
into the loaded configuration and MUST refuse to overwrite an existing CA key.

#### Scenario: InitCreatesCaAndServerCertificate
- **GIVEN** no `<userConfigDir>/tls/ca.key` exists and the configured host is `0.0.0.0` on a machine with address `10.11.3.77`
- **WHEN** `pi-outpost tls init` runs
- **THEN** `ca.key`, `ca.crt`, `server.key` and `server.crt` exist, both keys with mode `0600`
- **AND** `server.crt` is signed by `ca.crt`, expires in 365 days and lists `IP:10.11.3.77`, `IP:127.0.0.1`, `DNS:localhost` and the host name
- **AND** the configuration's `server.tls` names the three public/serving files and never `ca.key`

#### Scenario: InitRefusesExistingCa
- **GIVEN** `<userConfigDir>/tls/ca.key` exists
- **WHEN** `pi-outpost tls init` runs
- **THEN** it exits non-zero without modifying any file and names `pi-outpost tls renew`

#### Scenario: OpensslMissing
- **GIVEN** no `openssl` executable is on PATH
- **WHEN** `pi-outpost tls init` runs
- **THEN** it exits non-zero naming `openssl` and the option to configure existing PEM files

### Requirement: ServerCertificateRenewal

The CLI SHALL provide `pi-outpost tls renew` that issues a new server key and 1-year certificate
from the existing CA with the same rules as `init`, leaves the CA key and certificate unchanged, and
states that a restart is required. The server SHALL log the days until its certificate expires at
startup and SHALL warn when fewer than 30 days remain.

#### Scenario: RenewKeepsCa
- **GIVEN** a CA created by `tls init`
- **WHEN** `pi-outpost tls renew` runs
- **THEN** `server.crt` is replaced with a certificate valid for 365 days from now, signed by the unchanged `ca.crt`
- **AND** the SHA-256 fingerprint of `ca.crt` is unchanged

#### Scenario: ExpiryWarning
- **GIVEN** a server certificate expiring in 20 days
- **WHEN** the server starts
- **THEN** the startup output warns that the certificate expires in 20 days and names `pi-outpost tls renew`

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
- **GIVEN** TLS is active on port 3141 and `10.11.3.77` is an allowed host
- **WHEN** a plain HTTP request `GET /?token=secret HTTP/1.1` with `Host: 10.11.3.77:3141` arrives on port 3141
- **THEN** the response is `301` with `Location: https://10.11.3.77:3141/`
- **AND** neither the response nor the server log contains `secret`

#### Scenario: HttpForeignHostRefused
- **WHEN** a plain HTTP request with `Host: evil.example` arrives on the TLS port
- **THEN** the response is `400` with no `Location` header

#### Scenario: HttpCannotReachApi
- **WHEN** a plain HTTP `POST /api/login` arrives on the TLS port
- **THEN** the login handler does not run and the connection receives only the fixed response
