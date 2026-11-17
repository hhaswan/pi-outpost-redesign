# Deployment and updates

[Home](../README.md) · [How-to](how-to.md)

- [Staying up to date](#staying-up-to-date)
- [Running it as a service](#running-it-as-a-service)
- [Remote transport: HTTPS or SSH](#remote-transport-https-or-ssh)
- [A local CA for the LAN](#a-local-ca-for-the-lan)
- [Browser sign-in, sessions and the token](#browser-sign-in-sessions-and-the-token)
- [HTTPS cutover runbook (this native deployment)](#https-cutover-runbook-this-native-deployment)
- [Docker with Python](docker.md)
- [Installing it as an app](#installing-it-as-an-app)

## Remote transport: HTTPS or SSH

Local HTTP on `127.0.0.1` remains the default. A listener bound off loopback needs a
shared token **and** HTTPS/WSS; a token alone does not encrypt traffic. Existing remote
HTTP configurations now refuse startup until you choose one of these deployments:

- **Native HTTPS:** set `server.tls.certFile` and `server.tls.keyFile` to matching PEM
  files, and add the exact public HTTPS origin to `server.allowedOrigins`. See the
  [complete example](how-to.md#reach-it-from-your-phone-or-another-machine). TLS 1.2 is
  the minimum. Use a certificate trusted by your clients with the correct DNS/IP SAN;
  provide the full chain and an unencrypted key readable only by the service account.
  Use your own certificates, or let `pi-outpost tls init` issue them from a
  [local CA](#a-local-ca-for-the-lan). Restart after renewal. Startup rejects
  unreadable, malformed, mismatched, expired or not-yet-valid material, with no HTTP fallback.
- **SSH:** leave `server.host` at `127.0.0.1` on the remote machine, then run this on
  your client (OpenSSH on Windows, Linux or macOS):

  ```sh
  ssh -N -L 127.0.0.1:3141:127.0.0.1:3141 user@server.example.com
  ```

  Open `http://127.0.0.1:3141` locally. SSH encrypts the network transit; the HTTP/WS
  endpoints stay on loopback at each end. No plaintext exception is needed. Keep a
  token on shared machines and verify the SSH host key. Choose another local port
  if 3141 is occupied.
- **TLS reverse proxy:** keep pi-outpost on loopback and terminate HTTPS at the proxy,
  including WebSocket upgrade forwarding. Allow the exact public HTTPS origin and
  keep the token enabled. If a container/private-network hop requires a non-loopback
  listener, explicitly set `server.allowInsecureHttp: true` (or
  `PI_OUTPOST_ALLOW_INSECURE_HTTP=1`) and prevent clients from reaching that listener
  directly. This emits a warning and leaves that hop unencrypted. Forwarded headers
  never opt into plaintext automatically; TLS errors never fall back to HTTP.

The [Docker template](docker.md) explicitly permits its host-local container hop;
persisted configurations are not silently rewritten. These settings apply to the
pi-outpost listener, not a separately deployed Open WebUI service or provider endpoints.

## A local CA for the LAN

For a server reached by a LAN address (no public DNS name, no public CA), pi-outpost can
issue its own certificates. It needs `openssl` on the host.

```bash
pi-outpost tls init --ip <HOST_IP>          # the address devices type; repeat --ip/--dns to add names
```

This writes, under `<user config dir>/tls/` (`~/.config/pi-outpost/tls/`, directory `0700`):

| File | What | Mode |
|---|---|---|
| `ca.key` | CA private key. The server never reads it; only `tls init`/`renew` do. | `0600` |
| `ca.crt` | CA certificate (10 years). Devices install this once. | |
| `server.key` | Server private key. | `0600` |
| `server.crt` | Server certificate (1 year), SAN: the `--ip` addresses (default: the host's primary address), `127.0.0.1`, `localhost` and the host name. | |

and sets `server.tls.certFile`, `keyFile` and `caFile` in the configuration file in force
(its permissions are kept). `ca.key` is never named in the configuration. Restart to use it.

- **`tls init` is idempotent.** When a CA exists it is reused, never regenerated, so no
  device has to trust anything again; a still-valid server certificate (more than 30 days
  left) is kept, otherwise a new one is issued from the same CA. Run it again after a
  re-clone, a rebuild or a redeploy: it only rewrites `server.tls`.
- **`tls renew`** issues a new server key and certificate from the existing CA, any time.
  The CA is unchanged. Restart afterwards.
- **`tls init --new-ca`** replaces the CA. It prints a warning: every device must install
  and trust the new CA again. The old CA files are moved to `tls/replaced-<time>/`, not
  deleted. Without the flag an existing CA is never overwritten; a `ca.crt` without its
  `ca.key` (or the reverse) is refused, so restore the missing file from your backup.
- **Expiry.** At startup the server logs the days left on its certificate and warns under
  30 days, naming `pi-outpost tls renew`. Settings, Security shows the same notice. The
  server never renews by itself: renewing needs `ca.key`, which it never opens.
- **Public CA pages.** With `caFile` set, `https://<host>:<port>/ca` (install steps per OS
  and the SHA-256 fingerprint), `/ca.crt` and `/ca.mobileconfig` (iOS profile) are served
  without signing in. They serve `ca.crt` only. Without `caFile` they answer 404.
- **Plain HTTP on the TLS port** gets one fixed `301` to `https://<host>/` (path and query
  dropped, never logged) for a host the server answers to, else `400`. No route runs over
  plaintext.

### Where the TLS material lives, and backups

Everything that must survive a re-pull, a re-clone, a rebuild or a redeploy lives in the
user config directory, never in the repository or in `.local/native-releases/`:

- `~/.config/pi-outpost/tls/` (the four files above);
- `~/.config/pi-outpost/sessions.json` (browser sessions, hashed; `0600`);
- the configuration file (`server.tls`, `server.token`).

`.gitignore` refuses `ca.key`, `server.key`, `sessions.json` and any `pi-outpost/tls/`
directory, should one ever land in a checkout. The native updater and
`scripts/deploy-custom-native.mjs` only read the TLS files: the deploy preflight refuses TLS
paths inside the repository, checks that `server.crt` chains to `ca.crt` and is in date,
and the live check talks HTTPS trusting `caFile` only (Node `ca` option, Chromium pinned to
the server key). With plain HTTP it works as before.

Back up the TLS directory (it holds private keys: keep the archive private):

```bash
umask 077
tar -C ~/.config/pi-outpost -czf ~/pi-outpost-tls-$(date +%F).tgz tls
cp /root/pi-outpost.config.json ~/pi-outpost.config.backup.json
```

Restore on a new machine or after a fresh clone, as the same service user:

```bash
install -d -m 700 ~/.config/pi-outpost
tar -C ~/.config/pi-outpost -xzf pi-outpost-tls-<date>.tgz
chmod 700 ~/.config/pi-outpost/tls && chmod 600 ~/.config/pi-outpost/tls/*.key
cp ~/pi-outpost.config.backup.json /root/pi-outpost.config.json   # or run: pi-outpost tls init (reuses the restored CA)
```

Devices keep trusting the restored CA. If the machine's address changed, run
`pi-outpost tls renew --ip <new address>`: still no device re-trust. Losing `ca.key` means
`tls init --new-ca` and re-trust on every device. `sessions.json` is optional: without it,
browsers sign in again.

## Browser sign-in, sessions and the token

Browsers never keep the token. The sign-in screen posts it once to `POST /api/login`, which
sets the cookie `__Host-pi-outpost-session` (`HttpOnly; Secure; SameSite=Strict; Path=/`,
14 days, renewed on use once a day; the app checks `/api/session` on load and every 6 hours).
A server without TLS (loopback, or `allowInsecureHttp` before the HTTPS cutover) sets
`pi-outpost-session` instead, the same but without `Secure`, because browsers drop `Secure`
cookies on `http://`. The cookie then crosses the network unencrypted: the server logs a
warning at startup and Settings, Security shows "Not encrypted". The server reads either
name, so a browser stays signed in across the cutover.
Sessions are kept hashed in `~/.config/pi-outpost/sessions.json`. A `?token=` in any URL is
refused (401, WebSocket close 4401); old `?token=` bookmarks no longer sign in.
`Authorization: Bearer <token>` keeps working for scripts and non-browser clients and creates
no session. The embed widget's token is sent as a Bearer header on HTTP requests only; a
cross-origin widget cannot open a token-protected WebSocket (out of scope; no widget is in use).

| Action | In Settings, Security | On the host |
|---|---|---|
| Sign this browser out | **Sign out** | |
| Sign every browser out (open sockets close at once in-app, within 15 s from the CLI) | **Sign out all devices** | `pi-outpost sessions revoke-all` |
| New token (old one refused at once in-app; at restart from the CLI) | **Rotate token** (shown once; other devices signed out by default) | `pi-outpost token rotate [--revoke-sessions]` |
| Pair another device | **Pair a device**: QR of `<this page's origin>/pair#<code>` and the typed code (10 characters, 2 minutes, single use) | |

Rotation is refused when the token comes from `PI_OUTPOST_TOKEN`. Login and pairing are
rate-limited (10 attempts a minute per address).

## HTTPS cutover runbook (this native deployment)

Replace `<HOST_IP>` with the LAN address devices use to reach the server.

For `/root/pi-outpost.config.json` (host `0.0.0.0`, port 3141), run as root, after this change
is committed (the updater refuses a dirty checkout):

```bash
cd /root/pi-outpost-redesign
export PATH=/root/.nvm/versions/node/v24.14.0/bin:$PATH
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
cli="node cli/dist/pi-outpost.mjs --config /root/pi-outpost.config.json"
node cli/scripts/build.mjs                                    # 0. the build the commands below come from

# 1. Back up the configuration the running service uses: the deploy talks to it with this file.
cp -p /root/pi-outpost.config.json /root/pi-outpost.config.json.pre-https

# 2. Local CA and server certificate; writes server.tls into the configuration.
$cli tls init --ip <HOST_IP>                                 # SAN: <HOST_IP>, 127.0.0.1, localhost, host name

# 3. Edit /root/pi-outpost.config.json: remove "allowInsecureHttp", and change the
#    allowedOrigins entry "http://<HOST_IP>:3141" to "https://<HOST_IP>:3141"
#    (keep the other entries only if still used).

# 4. New token: the old one crossed the LAN in cleartext. Shown once; store it.
$cli token rotate

# 5. Deploy (one restart). The second argument describes the still-running HTTP server.
bash scripts/update-custom-native.sh /root/pi-outpost.config.json /root/pi-outpost.config.json.pre-https
cat .local/deploy-result.json                                 # expect "status": "deployed", "Playwright over https"
```

6. **On each device, once:** open `https://<HOST_IP>:3141/ca`. The browser warns once (the CA
   is not trusted yet): compare the fingerprint with the one `openssl x509 -in
   ~/.config/pi-outpost/tls/ca.crt -noout -fingerprint -sha256` prints on the host, then
   install the CA following the page (iPhone/iPad: install the profile, then **Settings,
   General, About, Certificate Trust Settings**, full trust).
7. **Sign in:** open `https://<HOST_IP>:3141` and paste the new token, or, on a signed-in
   device, **Settings, Security, Pair a device** and scan the QR (or type the code on the new
   device's sign-in screen).

Check: `http://<HOST_IP>:3141` redirects to `https://<HOST_IP>:3141/`, and the address bar
shows a trusted lock. Later updates need no second argument:
`bash scripts/update-custom-native.sh /root/pi-outpost.config.json`.

Rollback: deploy the previous release and restore `/root/pi-outpost.config.json.pre-https`
(the previous token). The previous build also serves HTTPS from the same `server.tls`, so a
rollback that keeps TLS works too; it still accepts `?token=` links, so rotate again once
back on this build. Back up `~/.config/pi-outpost/tls` now (see above).

## Staying up to date

The server checks once a day whether a newer version has been published, and says so in one
line if there is — in the terminal, and in the standalone interface as a notice with the
command to copy and a link to the new version's release notes, which can be dismissed for
that version. **It never installs pi-outpost on its own** — `pi-outpost update` is the only
thing that installs it, and only when you run it without `--check`.

After an update, the standalone interface says which version you moved from and, on
**What's changed**, shows the [changelog](../CHANGELOG.md) sections in between. The changelog
ships inside the package and the executables, so this needs no network and works with
update checks turned off. It is shown for as long as the new version runs, until you dismiss
it in that browser; a first install shows nothing, and `changelogNotice: false` turns it off.

**pi packages** — extensions installed with `pi install npm:…`, such as
`@gotgenes/pi-permission-system` or `openlore` — are listed in Settings with the version
installed and, once checked, whether a newer one is published; a check that fails says why.
**Update** installs the newer version after a confirmation naming both versions. A running
server cannot load an extension's new code, so the package then shows *restart to use it*,
and **Restart pi-outpost** stops and starts the server again in the same terminal: every
open window reconnects by itself and conversations are kept. Restarting is refused while an
agent is running a turn, and is never offered in an embedded widget; `extensionLock` forbids
updating. A version changed from a terminal (`pi update`) is marked the same way.

**Add a package** installs one without a terminal: type its npm name (`openlore`,
`@scope/name`, or `name@1.2.3` to pin that version) and choose *all projects* (the agent's
settings, the default) or *this project only* (the project's `.pi/settings.json`, which lives
in the repository). The name is looked up on the registry your npm configuration names first;
a name it does not know, or a package already there, is refused in place. A confirmation
names the version and where it goes, and the package runs once pi-outpost restarts.
**Remove** takes a package out of its settings and uninstalls it, after a confirmation. The
agent keeps running it until the restart, so it stays listed, struck through, with **Undo**,
which puts it back as it was. The restart notice names each package once, by its latest
change, and drops one that is back to what runs. Adding and removing are refused while a
session that loads the package is running a turn, and under `extensionLock`.

From a terminal, `pi-outpost update --extensions` does the same for every npm pi package at
once — the agent directory's, the one the server uses (`agentDir`, `--agent-dir`), and the
current directory's project — and `pi-outpost update --all` updates pi-outpost first, then
them. It works however pi-outpost was installed, the standalone executable included.
`--check` reports and installs nothing; pinned packages are left as they are; a failed
lookup, an install that installed nothing or an unreadable `settings.json` exits non-zero;
`extensionLock` refuses; git and local packages are named and left to `pi update`. The new
versions run once pi-outpost restarts. A plain `pi-outpost update` ends by naming the
packages that have a newer version.

What `update` does depends on how this copy was installed, which it works out rather than
asking:

| How you run it | What `update` does |
|------|------|
| Global npm install | Prints `npm install -g --allow-scripts=node-pty,koffi pi-outpost@latest`, runs it, reports the version it moved to |
| Source checkout | Refuses, and tells you to `git pull` — installing would put a *second* copy elsewhere and leave the one you are running untouched |
| `npx --allow-scripts=node-pty,koffi pi-outpost` | Explains that your next `npx` already fetches the newest version |
| Standalone executable | Refuses to overwrite itself, and points at the [releases](https://github.com/laurentftech/pi-outpost/releases) |
| Anything it cannot recognise | Refuses rather than guessing, and prints what it compared: the entry it runs from, npm's global `node_modules` (or that `npm root -g` gave no answer), and the runtime |

A check that fails is never reported as "up to date": `update --check` says it could not
check, and why, and exits non-zero.

| Key | Effect |
|------|------|
| `updateCheck` | `false` disables checking entirely. `true` enables it **even under `offline`**. Unset, `offline` decides |
| `updateRegistry` | Optional registry override, when npm's own configuration does not name the right one |
| `changelogNotice` | `false` hides what an update changed. The running version is still recorded, so turning it back on does not announce a past update |

Version checks normally run through `npm view`, so an existing `.npmrc` remains the source
of truth for an internal registry, authentication, CA certificates and proxies. No duplicate
pi-outpost setting is required for a Nexus setup that already works with npm.

`offline` means "remote model catalogs are unreachable", which is not the same network as a
package registry — a host air-gapped from the former can still reach an internal npm proxy,
and that is exactly the deployment where knowing a release exists matters. So `offline` is a
default for update checking, not a veto.

## Running it as a service

```bash
npm run start
```

Builds the interface once and starts **one** Node process serving the app, `/ws`,
`/branding` and `/health` together on `server.port` — nothing else to run or keep track of.
Point a process manager (systemd, pm2, Docker `CMD`, …) at that one command.

### Updating this customized native deployment

Do not replace this fork with `npm install -g pi-outpost@latest`. First merge the
upstream release into the custom repository and commit the integrated source.
The following command deploys the current committed custom source; it does not
merge upstream automatically:

```bash
cd /root/pi-outpost-redesign
export PATH=/root/.nvm/versions/node/v24.14.0/bin:$PATH
export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
bash scripts/update-custom-native.sh /root/pi-outpost.config.json
```

This host-specific flow requires Linux, root, systemd, an IPv4 HTTP or HTTPS listener on an explicit
configured port, iptables/ip6tables, python3, and Playwright Chromium. It refuses a dirty
checkout, installs from the lockfile with npm 12.2.2, builds the embedded custom UI,
and runs the artifact gate, an image decode/resize check and a real browser image-prompt
probe, a built-app responsive layout gate at phone, tablet and desktop widths (strict
44 px touch targets and no hover-only controls on phones), an image lightbox probe,
a real CLI PTY/browser shared-session probe, an HTTPS sign-in probe
(`scripts/check-https-login.mjs`: temporary CA, `/ca`, token sign-in, QR pairing, sign out all,
plain-HTTP redirect), the TLS preflight test, a disposable
native-service deployment probe, and focused update and shared-session tests. It does not restart the live service during these checks.

Deployment then runs in `pi-outpost-custom-deploy.service`, outside the live
service's process group. It waits up to 15 minutes for workspaces and known
background agents to become idle. Idle side sessions do not block a deploy: they live only
in memory, so their conversations (already on disk) are listed in the result file and a tab that
was on one returns to its project with a notice; reopen the conversation from Sessions. The worker temporarily rejects client connections
to the application port, while its private loopback connection captures and
restores saved sessions. Normal clients cannot submit during that interval.
The temporary rules are removed on completion and by the updater's systemd
`ExecStopPost` cleanup if the worker is terminated.

A systemd drop-in pins `pi-outpost.service` to an immutable copy under
`.local/native-releases/`, not the global npm installation. Installing a stock
package globally therefore no longer changes the live service's selected UI.
Keep the repository and its pinned dependencies available: the copied bundle
resolves its external dependencies from this repository's `node_modules`.
The build, preflight and staged release refuse a Photon WebAssembly file that does
not compile. Without that guard the SDK reports every image as
`Image omitted: could not be resized below the inline image size limit`, even a
small one. Restore the locked dependency; raising image limits does not fix it.

The worker backs up the previous drop-in and CLI bridge, verifies restored saved
session IDs through fresh connections, and checks the authenticated mobile UI.
Empty, never-persisted sessions have no history to restore; the result explicitly
records their replacement with new empty session IDs. On failure it restores the
previous configuration only when no new work would be interrupted. It never
claims a successful deployment merely because systemd started the process.

Inspect the result without exposing configuration credentials:

```bash
systemctl status pi-outpost-custom-deploy.service
cat /root/pi-outpost-redesign/.local/deploy-result.json
```

The transient updater disappears after completion; the result file remains.
`deployed` is the success state. `waiting-for-idle` is not a completed deployment.
Do not manually stop the updater during restart or restoration. If the worker is
forcibly terminated, ingress cleanup alone does not prove session restoration;
inspect service health and saved identities before claiming success.
If cleanup is interrupted, inspect the recorded status and lock owner before
retrying; do not remove a live updater's lock. The explicit recovery command for
a stranded ingress gate is `node scripts/native-deploy-network.mjs unlock <port>`.

The independent native proof is `node scripts/check-native-deploy.mjs`. It uses a
new disposable systemd service and a temporary port, never `pi-outpost.service`.

For a complete Docker/Compose recipe with Python, the integrated terminal and landstrip confinement,
see [Docker with Python](docker.md). It runs the full app; the Open WebUI tool-server image is separate.

It reads *your* configuration (`./pi-outpost.config.json`, or any of the locations above);
with none, it refuses to start and says so. There is no hot reload here: rebuild
(`npm run build --workspace web`) and restart after a UI change.

To distribute a version that needs no Node.js at all — a Windows `.exe` for non-technical
users, say — see [`docs/sea-packaging.md`](sea-packaging.md).

## Installing it as an app

The standalone interface declares itself to the browser, so it can be installed from the
address bar and opened from the desktop or taskbar: its own window, its own name and icon,
no tabs.

It is the same interface, on the same server, with the same sessions — installation changes
where it runs, never what it is. It also caches nothing of itself: with the server down, an
installed app says it cannot reach it rather than showing a stale copy of a previous build.

A mounted widget claims nothing on its host page: no manifest, no icon, no change to whether
the host page itself is installable.
