# How-to

Short recipes for the things people actually set out to do. Each one is
self-contained: the configuration it needs, the command that proves it works, and the
caution that goes with it. The [configuration reference](configuration.md) covers every key; the
[command-line reference](command-line.md) covers every flag.

- [Let the agent write in one folder only](#let-the-agent-write-in-one-folder-only)
- [Give the agent a shell](#give-the-agent-a-shell)
- [Work on several projects at once](#work-on-several-projects-at-once)
- [Use a local or self-hosted model](#use-a-local-or-self-hosted-model)
- [Reach it from your phone or another machine](#reach-it-from-your-phone-or-another-machine)
- [Run it permanently on a Linux server](#run-it-permanently-on-a-linux-server)
- [Keep several setups side by side](#keep-several-setups-side-by-side)
- [Hand it to someone who has no Node](#hand-it-to-someone-who-has-no-node)
- [Teach the agent something](#teach-the-agent-something)
- [Restrict which models can be picked](#restrict-which-models-can-be-picked)
- [Let the agent read a big PDF, Word, Excel or PowerPoint file](#let-the-agent-read-a-big-pdf-word-excel-or-powerpoint-file)
- [Make a PowerPoint deck from a template](#make-a-powerpoint-deck-from-a-template)
- [Search the project's files](#search-the-projects-files)
- [Ask a side question while the agent works](#ask-a-side-question-while-the-agent-works)
- [Lock down a shared deployment](#lock-down-a-shared-deployment)
- [Put it inside your own web app](#put-it-inside-your-own-web-app)
- [Use an existing pi installation](#use-an-existing-pi-installation)
- [When something does not work](#when-something-does-not-work)

## Let the agent write in one folder only

The most common shape: it reads your whole project, and may only change one part of
it.

```json
{
  "cwd": "/home/me/projects/site",
  "sandbox": {
    "root": "/home/me/projects/site",
    "allowWrite": true,
    "writableRoot": "/home/me/projects/site/src",
    "allowBash": false
  }
}
```

`root` is what it can read (symlinks resolved, nothing above it reachable);
`writableRoot` is the only place `edit` and `write` may touch. In the file browser,
everything outside the writable zone is dimmed, so you can see the boundary rather
than discover it.

Check it took effect: `pi-outpost config` prints the sandbox it resolved, and every
start logs it too.

## Give the agent a shell

```json
{ "sandbox": { "root": "/home/me/projects/site", "allowWrite": true, "allowBash": true } }
```

Without a `sandbox` section the agent already has a confined shell: see
[the default](sandboxing.md#the-default). In a section you write, be deliberate about this one.
**Bash cannot be path-confined**: `allowBash` without a runner gives the
agent everything the account running the server can do, inside the sandbox or not.
Where that matters, run pi-outpost as a dedicated user, or in a container, and treat
the sandbox as being that boundary rather than the `sandbox` key.

To confine it, run `pi-outpost config --confine`, or name a sandbox runner in `sandbox.bashRunner`: pi-outpost's own `bash` then runs every
command inside it, reading the root, writing the writable zone, with no key in reach — landstrip on
Linux (Docker included), MXC with Windows PowerShell on Windows 11. A sandboxing extension such as pi-landstrip
is the alternative, but only if you also name it in `sandbox.bashFrom`: installed alone, its confined
`bash` is shadowed by pi-outpost's and nothing changes. See the
[recommended setup for each platform](sandboxing.md#recommended-setup), which also points to a recipe
for WSL on a managed Windows machine.

To grant it for yourself while preventing anyone from turning it on from the browser:

```json
{ "sandboxLocks": { "allowBash": true } }
```

A lock is refused by the server, not merely hidden by the interface.

## Work on several projects at once

Nothing to configure. The project control in the header opens one: browse the
server's directories, pick it, and it is usable immediately — the set survives
restarts.

Each project gets its own agent, sandbox, file tree and session history. Its sandbox
is its own directory, with the permissions of the configured `sandbox` — write, bash —
but not its `root` or `writableRoot`, which belong to the `cwd` project. With several
projects open, Settings accordingly shows **Agent permissions** and the folder the
project is confined to, not a root to edit; a permission applied there takes effect in
that project at once and in projects opened after. Switching
never disturbs the others: a turn you leave running finishes, and its result is
waiting when you come back. The selector distinguishes stopped, starting, idle,
working, waiting for you, and ready for review. Waiting means the agent needs an
answer. Ready for review is derived from its persisted Work Plan: every task is done
or awaiting review, and at least one awaits review. It is not inferred merely because
a turn ended.

Both actionable states raise the existing attention count. If the browser tab is in
the background, the notification names the project and whether it needs an answer or
is ready for review, but never includes plan or workspace content. Switching to the
project does not clear the state; acknowledge the result in the conversation, or ask
for meaningful follow-up work.

For a small side action while a long task runs — a question about the code, a quick
fix — use the **+** on the project's row to start a **side session**: a second agent on
the same project, in a fresh conversation on the model the project is using, working at
the same time. It sits under its
project in the selector and is closed the same way. It shares the project's directory,
sandbox and resources, like a second terminal on the same repository: nothing keeps the
two agents' edits apart, so give them separate files. A conversation can be open in only
one session at a time — the session list says where it is — and a side session nobody has
used for the idle period is closed rather than retired, its conversation kept. Settings
applied from any session reach every session of the project, and wait while another of
them is running a turn.

Use **Outcome** in the header to review the selected project's recorded result without
reconstructing it from the conversation. It shows Work Plan progress, explicit evidence, and
changed files for that project only. A partial repository read or missing verification stays
visible as partial, unavailable, or not recorded; it is never upgraded to success. Task and file
entries open their existing detail views. Switching projects closes the drawer and discards the
old project's response; reopening Outcome asks the project now selected.

Two knobs, if the defaults do not suit:

```json
{
  "workspaceIdleTimeoutMs": 1800000,
  "workspaceLock": false
}
```

`workspaceIdleTimeoutMs` is how long an unused project stays alive before it is
retired and rebuilt on next use (`0` never retires; a project running a turn is never
retired). Coming back to a retired project shows its files at once and restarts its agent
behind them; set a longer timeout where agents start slowly and memory is not the constraint. Waiting and ready-for-review projects are retained too. `workspaceLock: true`
pins the server to one project and removes the controls entirely. Use it for a deployment,
embedded or standalone, whose project root must not change.

## Use a local or self-hosted model

Ollama, LM Studio, vLLM, SGLang, a corporate gateway — anything speaking the OpenAI
API.

**If pi-outpost has no usable model yet** (a fresh `agentDir`, no provider environment
variable), it shows the setup screen: pick the *OpenAI-compatible endpoint* tab and
fill in a name, the base URL, a key and one model id.

| Server | Base URL | Key |
|---|---|---|
| Ollama | `http://127.0.0.1:11434/v1` | anything non-empty |
| LM Studio | `http://127.0.0.1:1234/v1` | anything non-empty |
| vLLM / SGLang | `http://host:8000/v1` | whatever it was started with |

If every turn then fails with an error that names nothing useful, untick the two
**compatibility** boxes: many such servers reject the `developer` role and the
`reasoning_effort` field pi sends to reasoning-capable models.

**If you already have a working provider**, the setup screen does not come back — it
only appears when no model can answer. Write the endpoint into
`<agentDir>/models.json` yourself, which is the same file the screen writes:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "compat": { "supportsDeveloperRole": false, "supportsReasoningEffort": false },
      "models": [{ "id": "qwen3:14b" }]
    }
  }
}
```

That file holds a key: keep it readable by you alone (`chmod 600`). Restart, and the
model appears in the switcher.

On a machine that cannot reach the public model catalogs, add `"offline": true` —
otherwise every credential change waits 20 s for a fetch that will never arrive.
Locally declared models are unaffected.

## Reach it from your phone or another machine

Configure a certificate trusted by your clients for the hostname you use, a token and the
exact browser origin. Remote listeners refuse plaintext HTTP by default:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3141,
    "token": "a-long-random-secret",
    "tls": { "certFile": "/etc/pi-outpost/fullchain.pem", "keyFile": "/etc/pi-outpost/privkey.pem" },
    "allowedOrigins": ["https://outpost.example.com:3141"]
  }
}
```

1. **`host`** off `127.0.0.1`, and **`port`** names the port used below. `3141` is the
   default, but spelling it out keeps the listen address and browser origin visibly aligned.
   The server refuses to bind off loopback without a
   token and encrypted transport, so this alone will not start.
2. **`token`** — a long random secret, `openssl rand -hex 32`. Prefer the
   `PI_OUTPOST_TOKEN` environment variable, which overrides the file and keeps the
   secret out of it. There is no `--token` flag on purpose: argv is readable by anyone
   who can list processes.
3. **`allowedOrigins`** with the exact origin *you will type in the browser*. Only
   `localhost` and `127.0.0.1` are trusted automatically, so a connection from
   `https://outpost.example.com:3141` is rejected as a forbidden origin until you list it.

Then open `https://outpost.example.com:3141` and paste the token on the sign-in screen. The
browser receives a session cookie and never stores the token; links with `?token=` no longer
sign in. No certificate for a LAN address? See [Use HTTPS on your LAN](#use-https-on-your-lan-with-a-local-ca).

The certificate must match the hostname (or IP address) in that URL. Protect the private
key with service-account file permissions and restart after renewing it. You can also use
an [SSH tunnel or TLS reverse proxy](deployment.md#remote-transport-https-or-ssh). Remember what
you are exposing — an agent that can read your files, and write or run commands if you
granted it that.

## Use HTTPS on your LAN with a local CA

On the host (needs `openssl`):

```bash
pi-outpost tls init --ip 192.168.1.20    # the address your devices type
```

It creates a private CA and a server certificate in `~/.config/pi-outpost/tls/` and writes
`server.tls` into your configuration. Add `https://192.168.1.20:3141` to
`server.allowedOrigins`, remove `server.allowInsecureHttp` if set, and restart. Running it
again reuses the same CA, so devices never need to trust a new one; `pi-outpost tls renew`
issues a new server certificate from it (yearly; Settings warns 30 days ahead). Back up
`~/.config/pi-outpost/tls` — see [backups](deployment.md#where-the-tls-material-lives-and-backups).

On each device, once:

1. Open `https://192.168.1.20:3141/ca`. The browser warns this one time, because it does not
   trust the CA yet. Compare the fingerprint on the page with the one in **Settings,
   Security, Server certificate** on a device that already trusts the server (or with
   `openssl x509 -in ~/.config/pi-outpost/tls/ca.crt -noout -fingerprint -sha256` on the host).
2. Install the certificate as the page says for your system. On an iPhone or iPad: tap
   **iPhone / iPad profile**, install it in Settings, then turn on full trust in **Settings,
   General, About, Certificate Trust Settings**.
3. Reload. The address bar shows a trusted connection.

Settings, Security also shows a QR code of the `/ca` page, to open it on a phone.

## Sign in, pair a device, sign out

- **Sign in:** paste the token on the sign-in screen. The browser stays signed in for 14 days
  after its last use; the token itself is not stored in the browser.
- **Pair a device without typing the token:** on a signed-in device open **Settings,
  Security, Pair a device**. Scan the QR code with the new device, or type the 10-character
  code on its sign-in screen (**Pairing code**). A code works once, for 2 minutes. The new
  device gets its own sign-in.
- **Sign out:** **Settings, Security, Sign out** signs this browser out. **Sign out all
  devices** signs every browser out at once (open tabs return to the sign-in screen). On
  the host: `pi-outpost sessions revoke-all`.
- **Lost a device, or shared the token by mistake:** **Rotate token** shows a new token once
  (copy it) and, by default, signs every other device out. On the host:
  `pi-outpost token rotate` (applies at the next restart; `--revoke-sessions` signs everyone
  out). Rotation is refused when the token comes from `PI_OUTPOST_TOKEN`.

Scripts keep using `Authorization: Bearer <token>`; they create no sign-in session.

## Run it permanently on a Linux server

Install the package, locate the installed binary, and create a dedicated identity and
directories. The paths below are examples; use the home and binary paths chosen by your
distribution and npm installation.

```bash
npm install -g --allow-scripts=node-pty,koffi pi-outpost
command -v pi-outpost             # use this exact path in ExecStart below
sudo useradd --system --create-home --shell /usr/sbin/nologin pi-outpost
sudo install -d -o pi-outpost -g pi-outpost /etc/pi-outpost
sudo install -d -o pi-outpost -g pi-outpost /var/lib/pi-outpost/agent
sudo install -d -o pi-outpost -g pi-outpost /srv/pi-outpost/workspace
```

Create `/etc/pi-outpost/config.json`, owned by `pi-outpost`, so the setup commands and the
service deliberately use the same configuration and agent directory:

```json
{
  "cwd": "/srv/pi-outpost/workspace",
  "agentDir": "/var/lib/pi-outpost/agent",
  "sandbox": {
    "root": "/srv/pi-outpost/workspace",
    "allowWrite": false,
    "allowBash": false
  },
  "server": { "host": "127.0.0.1", "port": 3141 }
}
```

Then apply the promised ownership and permissions:

```bash
sudo chown pi-outpost:pi-outpost /etc/pi-outpost/config.json
sudo chmod 600 /etc/pi-outpost/config.json
```

Store the model credential as the service identity. Use the provider's account sign-in when
available, or enter an API key. Replace `/usr/local/bin/pi-outpost` with the path printed by
`command -v`:

```bash
sudo -u pi-outpost env PI_OUTPOST_CONFIG=/etc/pi-outpost/config.json \
  /usr/local/bin/pi-outpost login --provider anthropic
```

Generate a token with `openssl rand -hex 32`. Create `/etc/pi-outpost/environment`, put a
single `PI_OUTPOST_TOKEN=<paste the generated hex value>` line in it, and make it readable
only by root:

```bash
openssl rand -hex 32
sudo touch /etc/pi-outpost/environment
sudo chown root:root /etc/pi-outpost/environment
sudo chmod 600 /etc/pi-outpost/environment
sudoedit /etc/pi-outpost/environment
```

Then create `/etc/systemd/system/pi-outpost.service`:

```ini
[Unit]
Description=pi-outpost
After=network-online.target

[Service]
User=pi-outpost
Environment=PI_OUTPOST_CONFIG=/etc/pi-outpost/config.json
EnvironmentFile=/etc/pi-outpost/environment
ExecStart=/usr/local/bin/pi-outpost --no-open
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

The system manager reads the environment file, so it can remain owned by root with mode
`0600`; do not put the token directly in the world-readable unit. A headless host opens no
browser anyway — pi-outpost only opens one where a desktop session exists — but `--no-open`
says so explicitly.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pi-outpost
sudo systemctl status pi-outpost
```

From a checkout rather than a package, `npm run start` is the equivalent single
command: it builds the interface once and serves everything from one process.

## Keep several setups side by side

A profile is an ordinary configuration file living in
`~/.config/pi-outpost/profiles/`:

```bash
mkdir -p ~/.config/pi-outpost/profiles
cp pi-outpost.config.json ~/.config/pi-outpost/profiles/work.json
pi-outpost --profile work     # from anywhere
```

`$PI_OUTPOST_PROFILE` does the same without the flag. Give each profile its own
`server.port` if you want two running at once, and its own `agentDir` if their
sessions and credentials should not mix.

## Hand it to someone who has no Node

Download the executable for their platform from
[Releases](https://github.com/laurentftech/pi-outpost/releases) — server and interface
are inside it, nothing to install. On macOS and Linux it needs `chmod +x` first, since a
release download carries no execute bit. It is unsigned, so macOS blocks a fresh download
outright and Windows SmartScreen warns on first launch;
[`sea-packaging.md`](sea-packaging.md) covers clearing both, and building one yourself
with `pi-outpost build-exe`.

Ship a configuration file beside it (`pi-outpost.config.json` in the directory they
launch from) so they never see a start that refuses. Double-clicked, it opens the
interface in a window of its own; if it fails before listening, the window waits for a
keypress instead of vanishing with the message.

Tell them to install it from the browser too: the interface declares itself as an app,
so it lands in the dock or taskbar with its own icon and opens without an address bar.

## Teach the agent something

| What | Where | Loaded from |
|---|---|---|
| Skills | `skillPaths`, or the Settings menu | Files or directories; `skillPaths` loads even under `noSkills` |
| Prompt templates | `promptPaths`, plus what is auto-discovered from `agentDir` and the project's `cwd/.pi/prompts` | Available as `/` commands in the composer |
| Extensions | `extensionPaths`, `extensionScripts`, or the Settings menu | A directory is enough — its extensions are discovered |

```json
{
  "skillPaths": ["/srv/shared/skills/house-style"],
  "promptPaths": ["./my-prompts"]
}
```

Paths are resolved against the configuration file's directory, and are automatically
made readable to the agent even when they sit outside the sandbox root.

Open **Settings → Manage agent resources** to add either a local folder or a Git
repository. A local folder writes to `userSkillPaths` or `userExtensionPaths`, and loads
everything in it. For Git, enter the clone address and confirm or edit the suggested local
folder. Managed suggestions live under `<user config dir>/resource-repositories/`.

A Git repository is added as a **skill collection**: the preview lists every `SKILL.md` in
it, grouped by the folders the repository keeps them in, and **every skill starts off**.
Turn on the ones you want — one switch per skill, **All on** / **All off** for the whole
repository or for one folder — then **Save** to add the repository. Later changes in the
repository's pane are staged and take effect with **Apply**; either way the session is
replaced once with exactly those skills. Nothing from the repository is loaded until a skill is turned on, and a skill
that arrives later through an update stays off. The skills that are on are listed at the top
of the repository, each with **Turn off**; **Search skills** and **Only on** narrow a large
collection, and the repository list shows how many are on. A repository is named after its
`origin`, not after the local folder it was cloned into. Copies of the same skill in different
folders are listed as the repository ships them. The selection is stored under
`userSkillCollections`. Extension roots (`extensions/`, `.pi/extensions/`,
`.agents/extensions/`) are still selected as roots. A repository added before collections
existed keeps loading everything under its skill roots.

**Remove repository** unregisters a repository as a whole — its skills, extensions and
selection — after a confirmation. For a clone pi-outpost made, or one inside the managed
folder, it also **deletes the clone from disk**, local changes included; that cannot be
undone. A repository you pointed at elsewhere is unregistered and its files are kept. A
repository that supplies a path from the configuration file cannot be removed here.

Both flows rebuild the session at once — no server restart — and never alter paths declared
by the deployment. Extension folders warn that they execute code; an extension-bearing or
mixed Git repository also requires revision-specific confirmation before updating.
`extensionLock` still permits skill-only enrollment from a mixed preview, but blocks
extension activation and updates of the mixed repository as a unit. The enrollment warning
is browser-side acknowledgement rather than access control; `extensionLock` is the
server-side boundary. Update confirmation is revision-bound and checked by the server.

The Git updater only performs a clean fast-forward to the assessed upstream revision. Fix
dirty, detached, ahead, diverged, or missing-upstream states in an external terminal, then
use **Check** again. It never commits, stashes, discards, rebases, pushes, switches branches,
runs repository hooks, or initializes/updates submodules. Clone and fetch cannot prompt in a
terminal; an HTTPS host that wants a login is named, and the dialog asks for a user name and
token, stores them on the server and retries — see
[Git credentials for Agent resources](configuration.md#git-credentials-for-agent-resources). If Git
succeeds but a workspace reload fails, the clone stays advanced and the manager reports
the partial reload instead of attempting a destructive rollback.

With the RPC runtime, missing skill source paths and the unavailable extension inventory
are shown under **Provenance unavailable**. They stay visible but cannot be grouped or
updated until the child runtime supplies filesystem provenance.

For real isolation, remember that skills also load from `~/.agents/skills` and from
`.agents/skills` walked up from `cwd`, neither of which `agentDir` scopes: that is
what `noSkills` is for.

## Restrict which models can be picked

```json
{
  "allowedModels": [
    { "provider": "anthropic", "id": "claude-sonnet-5" },
    { "provider": "ollama", "id": "qwen3:14b" }
  ]
}
```

Without it the switcher lists every built-in model whose provider has credentials —
usually far more variants than a given deployment actually serves.

With it, no turn runs on another model: a session that would start on the agent directory's
default (`settings.json`) is moved to the first listed model — for that session only, the default
is left alone — and a client asking for a model outside the list is refused.

## Let the agent read a big PDF, Word, Excel or PowerPoint file

Nothing to enable: `pdf_extract`, `docx_extract`, `xlsx_extract`, `pptx_extract` and
`mail_extract` are available wherever `read` is, need no shell and no external binary, and are
confined to the sandbox root like every other file tool. Drop the document into the
composer and it is uploaded into the workspace and attached as a path, which is what
those tools take.

When you resume a conversation, recently used document tools return with it, keeping their
inactivity counters. In the embedded runtime, the agent can also repeat a remembered extraction
call after its schema has gone idle; it does not need you to attach or name the file again.
The existing file permissions and sandbox still apply.

A picture in the document is named where it sits — `[picture 3: PNG 800×600 — "its alt
text"]` — and nothing more is spent on it unless you ask. `images: "all"` returns them
as images within a per-call budget, and `images: ["3"]` returns one by the number its
marker carries, which is also how to get one the budget held back. A picture whose bytes
cannot be shown, a metafile or a missing part, is still named with the reason: nothing
the document holds goes unmentioned.

A Word document under review reads as its accepted text — every tracked change applied —
and the answer opens by saying how many changes and comments it holds. Ask what changed, or
for an impact analysis, and the agent calls `docx_extract` with `review: true`:

```
Le délai est de {--30--}[r1]{++45++}[r2] jours, voir {==l'annexe B==}[c1].
…
- [r1] deletion — J. Martin, 2026-10-12 — Exigences > Délais
- [r2] insertion — J. Martin, 2026-10-12 — Exigences > Délais
- [c1] comment, open — P. Leroy, 2026-10-14 — Exigences > Délais: « Laquelle ? »
```

A move is marked at both ends with one `[mN]`, a table row inserted or deleted is one change,
and a comment's replies follow it in the list. Formatting changes are not reported, and the
document is never modified — accepting or rejecting changes stays in Word.

When the author sent a new version without tracking their changes, there are two files and no
trace of the edits between them. Name both and ask what changed: on Windows, with desktop
Microsoft Word installed, the agent calls `docx_compare`, and Word compares them.

```json
{ "original": "spec-v1.docx", "revised": "spec-v2.docx", "output_path": "spec-v1-v2-compared.docx" }
```

The answer is the same review reading, opened by a line naming both files and one saying whether
either version holds tracked changes or comments of its own, and closed by a line saying the list
is complete — so the agent does not read both versions again to check. Every change carries
the author `Word comparison` and the date of the comparison, not those of whoever edited the
document, and comments keep their own author. Formatting is not compared. Word works on private
copies, so neither file is modified and nothing is written beside them. With `output_path`, Word's
compared document is also saved for you to open in Word. A Word that is already open keeps its
documents: the comparison runs in a Word of its own. It is bounded by `office.renderTimeoutMs`.

On macOS, Linux or WSL the tool is not offered. Do it by hand: in Word, Review → Compare →
Compare…, choose both versions, save the result into the workspace, and ask the agent to read it;
it calls `docx_extract` with `review: true`.

There is no OCR. A scanned PDF has no text layer, and its words are not searchable — but
the page *is* an image, so `pdf_extract` returns it at the resolution the file holds and
the agent can read it by looking. For a page carrying neither text nor an image — an
export drawn as vectors, a map, a plot — `pdf_render` draws the pages as pictures.

A PDF that has been reviewed carries its review as annotations, outside the text. `pdf_extract`
lists them after each page's content under "Comments on page N": notes, highlights, suggested
deletions (a strike-out) and insertions (a caret), each with its author, its date, its remark and
the words it marks, replies under the comment they answer, and review states such as "Accepted"
on the comment they settle. A line before the first page counts them, so the agent cannot answer
from the text alone without knowing a review exists. Links and form fields are not comments. A PDF
exported from Word usually carries none of the Word document's comments.

The ceiling is 25 MB per format, raise it if your documents are bigger:

```json
{ "pdf": { "maxBytes": 52428800 }, "xlsx": { "maxBytes": 52428800 } }
```

For a long document, ask for `output_path`: the extractor writes the whole thing to a
workspace file and returns a summary, instead of spending the context on it twice.

## Read a mail someone forwarded you, and what it carried

Drop the message on the composer. An Outlook `.msg`, or a `.eml`/`.emlx` from macOS Mail,
Gmail or any webmail, is copied into the workspace and attached as a path, exactly as a PDF
is — never inlined, which for a `.eml` would spend the prompt on MIME headers and the base64
of every attachment instead of the message.

`mail_extract` then reads it: subject, sender, recipients, date, the body as markdown, and
an inventory of the attachments with an identifier, a name, a type and a size for each. Ask
for them and they become files:

```
Read Bienvenue.msg and tell me what the deck says
```

The tool writes the attachments you asked for — `attachments: "all"`, or the identifiers
from the inventory — into a directory beside the message, `Bienvenue.msg.attachments/`, and
returns their paths. They are ordinary workspace files from that point on, so the deck is
read by `pptx_extract`, the contract by `docx_extract`, the report by `pdf_extract`, at a
path. The reader for whatever was written is offered to the agent in the same turn, so it
does not have to ask you to name a file it just unpacked.

What the tool will not do: return an attachment's content alongside its path (that would
spend the context twice), overwrite a file that is already there, write anywhere outside the
writable zone, or use an attachment's own file name as a path — a name arriving from a
stranger is reduced to a single component first, with its extension kept so the right reader
is still chosen. In a read-only sandbox, unpacking is refused and the message is still read.

A message is content someone else wrote, and every extraction says so before the body: its
text, its addresses and its attachment names are data, not instructions. Nothing in it is
fetched or executed — a remote image in the body is reported as the reference it is, never
loaded. An encrypted message (S/MIME or PGP) says it is encrypted rather than handing over
ciphertext; a signed one is read from the content the signature covers and reported as
unverified, because nothing here verifies one.

The ceiling is 25 MB, as for the other formats:

```json
{ "mail": { "maxBytes": 52428800 } }
```

One limitation worth knowing before you blame the feature: dragging a message **straight out
of the Outlook desktop app** into a browser may hand it nothing at all, depending on the
version — Outlook offers its own clipboard format rather than a file. Drag the message to a
folder first, or use the composer's attach button. Dragging from macOS Mail gives a `.eml`
and always works.

## Make a PowerPoint deck from a template

Name the template in your prompt — `Make the steering-committee deck from brand.potx, using
report.docx` — or load the skill with `/skill:pptx-from-template`. Either one gives the agent four
tools and the bundled skill tells it how to use them:

1. `pptx_layouts` lists the template's layouts (a `.potx`, or a `.pptx` whose design you want).
2. `pptx_create` writes a new `.pptx`: each slide takes a layout, and its title, subtitle,
   bullets and picture go into that layout's placeholders, so the template styles them. A slide
   can carry a native table (in the template's table style) or a native chart — column, bar,
   line or pie, in the theme's colours, with its data in an embedded workbook so PowerPoint's
   *Edit Data* works. The template's own sample slides are left out. Pictures can be PNG, JPEG,
   GIF or SVG.
3. `pptx_update` changes an existing deck: replace a slide's content, insert a slide after one,
   delete or move one — slides named by number or by title. Every slide it does not touch stays
   exactly as it was, and what a deleted slide alone used (its pictures, charts, notes) leaves
   with it. It writes to a new file unless you ask it to overwrite the original.
4. `pptx_render` has an office application draw the deck and hands the agent a picture of every
   slide — or only the ones it asks for, such as the slides an update changed — plus a list of the
   text that is on a slide but not visible (overflow, clipping). The agent fixes what it sees and
   rebuilds, before telling you the deck is done. Ask for a PDF and it saves the rendering too.

Rendering needs one of these installed where the server runs:

- **PowerPoint**, on Windows — used first, through COM automation. It is the reference: what
  your audience will open the deck with. PowerPoint is never closed under you if you had a deck
  open in it.
- **LibreOffice**, anywhere — found in its standard location or on `PATH`.
- **ONLYOFFICE Document Builder** (`docbuilder`).

To force one, or to point at an executable installed elsewhere:

```json
{ "office": { "renderer": "libreoffice", "libreofficePath": "C:/Tools/LibreOffice/program/soffice.com" } }
```

These keys were `pptx.renderer`, `pptx.libreofficePath`, `pptx.onlyofficePath` and
`pptx.renderTimeoutMs` in 0.29: they still work, and the server names each one at startup with its
`office` replacement. The same settings draw Word documents.

LibreOffice and ONLYOFFICE substitute fonts they do not have, so their line breaks can differ a
little from PowerPoint's; the agent is told to leave room rather than trust a render that only just
fits. Building needs a writable workspace: in a read-only sandbox `pptx_create` and `pptx_update`
are not offered.
Speaker notes are not written yet, and charts are limited to those four types — the agent says so
rather than faking them.

## Write a Word document from a template

Name the template in your prompt — `Write the quarterly report from house.dotx` — or load the skill
with `/skill:docx-from-template`. Naming a `.docx` brings the same tools, with `docx_extract` to read
it. The bundled skill teaches the agent the loop:

1. `docx_styles` reads the template (`.dotx`, or a `.docx` whose look you want): which of its styles
   the headings, paragraphs, lists and tables will wear, whether it numbers its headings, and
   whether it has a cover page, a header and footer, and a table of contents.
2. `docx_create` writes Markdown into it. `#` becomes the template's first heading level, `##` the
   second, and so on, found by style name — so a template saved by a French Word, whose heading
   styles have the ids `Titre1`, `Titre2`…, works as one saved by an English Word. Lists, tables, pictures from the workspace, links and LaTeX equations (as native
   Word equations) come along; the template's styles, numbering, margins, header, footer and theme
   apply to all of it. The template's sample text is left out; its cover page and table of
   contents are kept when asked, and Word refreshes the table of contents on opening. Where the
   template numbers a heading level, a number typed in front of the heading (`## 2.1 Scope`) is
   removed, so the heading is not numbered twice; `docx_update` does the same.
3. `docx_update` changes an existing document, one section at a time, sections named by their
   heading (`"Scope"`, or `"Scope > Out of scope"` when a name repeats): replace a section's body,
   insert a section after one, append, or delete. The changes are **tracked** by default, in the
   name of pi-outpost, so whoever owns the document accepts or rejects them in Word;
   `track_changes: false` writes them directly. Everything outside the edited sections is left
   byte for byte as it was, and a section holding changes nobody has accepted yet is refused.
4. `docx_restyle` brings an existing document into a template: the template's styles, theme and
   heading numbering replace the document's (matched by name), and the fonts, sizes and colours
   someone set by hand are removed so the text takes its style's — what makes a pasted paragraph
   look different from its neighbours. Bold, italic, spacing, lists, tables and pictures stay, and
   the tool checks that not a character of the text changed. The removals are tracked changes the
   owner accepts in Word; the replaced style definitions cannot be, so the result goes to a new
   file. `include: ["page"]` also takes the template's page size and margins (each section keeps
   its orientation), `["headers"]` its headers and footers. Styles the template does not have are
   kept and listed.
5. `docx_render` has an office application draw the document and returns the pages as pictures,
   the chapters as the PDF's bookmarks — the headings as Word sees them, with their numbers when
   the template numbers them — and any body paragraph that reached no page.

Rendering uses the same applications and settings as decks, with **Word** first on Windows: it
opens a read-only copy of the document, invisibly, and never closes a document you have open in
it. Creating, updating and restyling need a writable workspace: in a read-only sandbox
`docx_create`, `docx_update` and `docx_restyle` are not offered.

Footnotes, comments, text boxes and section changes (landscape pages, columns) are not written; the
agent says what is missing rather than faking it. A ` ```mermaid ` fence is drawn as a picture in
its place, sharp in Word (an SVG, with a PNG behind it for other readers). One Mermaid cannot parse is
written as its source, and the answer names it. The single-file executable cannot draw Mermaid and
writes the source, saying so.

### Export from the viewer into your template

Point `docx.template` at the template everyone should use:

```json
{ "docx": { "template": "templates/house.dotx" } }
```

The path is relative to the configuration file. The viewer's Word export then offers a second
button, **⤓ word · template**, that writes the open document into it. The document is built in
the browser as before, diagrams included, and the server carries it into the template. The plain
export stays beside it: a template that is missing or cannot be used is reported on its own
button, and never blocks the other. Each browser may export into the template 30 times a minute; past that,
the button says when to try again.

## Search the project's files

Click the magnifying glass in the **Files** header (**Search in files**), type the text and press
Enter. The search runs on the server, over the project the file tree shows.

- It is case-insensitive and literal: `user.name` finds `User.Name`, and characters such as `.`
  or `*` have no special meaning.
- Text files are searched up to 1 MB each. PDFs are searched page by page, through their text
  layer, up to 50 MB each. A scanned page holds no text and gives no match. A PDF that cannot be
  read (encrypted, damaged, or slower than 5 seconds) is skipped, and the results say how many
  were.
- It skips what the file-name search skips: symbolic links, files and folders whose name starts
  with a dot, and `node_modules`, `dist`, `build`, `.next`, `.turbo` and `__pycache__`. Other
  binary files are skipped too. Nothing outside the project's root is read.
- Hits are grouped by file. A text hit shows its line number, a PDF hit its page. Clicking one
  opens the file in the viewer with find already on the query: a text file opens in its source,
  on that line, and a PDF opens on that page, with the match highlighted. Enter in the find bar
  steps to the next match, as Ctrl+F does.
- The search stops at 500 hits, at 20 hits per file, and after 15 seconds. When it stops early,
  the results say they are partial. Narrow the query to see everything.
- Escape or **×** goes back to the tree. The query and the results are kept until you switch to
  another project, which drops them.

## Ask a side question while the agent works

A long turn leaves you waiting. Typing "where are you at?" in the composer steers the agent: the
question lands in its next request, can turn it from what it was doing, and stays in the
conversation for good. Ask it with `/btw` instead:

```
/btw where are you at?
/btw which files have you changed so far?
/btw what did we decide about the date format?
```

- It is answered from what the conversation holds when you ask: your messages, the agent's
  replies, the tools it called and what they returned. The reply still being written is not
  included yet.
- It is answered by the model the session is on, with no tools. It cannot read a file or run a
  command, so it says when the conversation does not show the answer.
- The running turn is not interrupted, steered or slowed down. The agent never sees the question
  or the answer, and neither is saved in the session. Reloading the conversation does not bring
  them back.
- The question and its answer appear in a side note above the composer, marked as not part of
  the conversation. A new `/btw` replaces the question shown, and cancels it if it is still
  waiting. A failure, such as a model with no credentials or a provider error, is written in the
  note.
- While the note is open, the next `/btw` can follow up: "/btw and the second one?" is asked with
  the earlier side questions and their answers. They stay in the note above the latest one. A
  question that failed or was replaced before its answer is not kept.
- Only messages that start with `/btw` are side questions. Anything else you type goes to the
  agent as usual, even while the note is open.
- The note keeps a small height and scrolls inside. Each new answer is shown from its question;
  scroll up, or click the note and press ↑, to go back to the earlier ones.
- **×** on the note, or `/btw` with nothing after it, closes the note in every open tab, cancels a
  question still waiting, and forgets the side questions. Starting or opening another
  conversation does the same.
- Each question costs one model request. Only the most recent part of a long conversation is sent
  (about 60,000 characters), and the request says that earlier messages were left out.

`/btw` works under both agent runtimes, and also with `noExtensions`, because it ships with
pi-outpost. Like any slash command, `blockedCommands: ["btw"]` withholds it. An extension of your
own that registers `btw` replaces it in the embedded runtime.

## Read a long conversation back, and send it to someone

A conversation the agent has worked in for a while runs out of context window. When that happens
the agent *compacts* it: the older exchange is replaced, in the model's context, by a summary it
writes, and work carries on from there. Nothing is deleted — the session file keeps every message
— but until now the interface only ever showed what the model could still see, so scrolling up
stopped at a message that was not the first one, with nothing above it and nothing saying why.

Two things address that:

- The transcript marks the cut. **Conversation compacted here** sits where compaction happened,
  and unfolding it shows the summary the agent was left with — which is what it now remembers of
  everything above.
- **Load earlier messages**, at the top of the transcript, brings those messages back, fifty at a
  time, from the session's own record. Your reading position does not move: the messages appear
  above what you were reading. They come back read-only, because their turns are no longer in the
  model's context — the ✎ and the fork are offered again if you navigate back to them through the
  conversation tree.

To keep a conversation or send it to someone who does not run pi-outpost, use **↓ html** in the
header. It saves the whole exchange — everything above the compaction point included, whatever the
transcript happens to have loaded and whatever the conversation filters hide — as one file:

- It opens from a disk, with no network, no application and no JavaScript. Workspace images travel
  inside it, diagrams as vector graphics, equations as MathML, tool calls as sections the reader
  unfolds.
- It is named after the session and the day, so several exports do not collide in a downloads
  folder.
- Either it holds the whole conversation or you get no file at all. A partial archive cannot be
  told from a complete one once it has been sent, so a conversation whose earlier half cannot be
  read back is refused with the reason instead.
- Nothing is written into the workspace; it is a download, like the Word export.

Reading back needs the session record the embedded agent runtime keeps. Under the Pi RPC runtime
(`agentRuntime.mode: "rpc"`) there is no command for it: no **Load earlier messages** appears, and a
compacted conversation cannot be exported in full — it says so rather than handing over the visible
tail.

## Lock down a shared deployment

For a server other people connect to, decide what the browser may change:

```json
{
  "sandboxLocks": { "root": true, "writableRoot": true, "allowWrite": true, "allowBash": true },
  "extensionLock": true,
  "workspaceLock": true,
  "blockedCommands": ["setup*", "config-*"],
  "noSkills": false
}
```

- `sandboxLocks` freezes the sandbox fields, individually
- `extensionLock` forbids adding extension directories — that is loading *code*, which
  is why it is separate from skill paths, and why skill paths stay editable under it
- `workspaceLock` pins the server to one project
- `blockedCommands` keeps an extension's operator commands — reconfigure its credentials,
  change what it captures — out of the users' composer, and refuses them if typed; the
  extension itself keeps running. `allowedCommands` does the reverse: only the commands it
  names are offered

All of it is enforced by the server: a client that sends the request anyway is
refused, nothing is persisted and no session is rebuilt. Add `server.token`, and read
the [security note](getting-started.md#why-it-insists-on-a-configuration-file) before binding off loopback.

## Put it inside your own web app

```bash
npm install @pi-outpost/embed
```

```js
import { mount } from "@pi-outpost/embed";

const widget = mount(document.getElementById("assistant"), {
  serverUrl: "https://outpost.internal",
  token: currentUser.outpostToken,   // no token screen for your users
  workspace: "/srv/projects/acme",   // which project this widget shows
  theme: "dark",
});
```

Server side, two settings decide what the widget is:

```json
{
  "server": { "allowedOrigins": ["https://your-app.example.com"] },
  "embed": { "workspaceControls": "settings" },
  "workspaceLock": true
}
```

`allowedOrigins` must list your host page's origin — the widget's WebSocket carries
*that* origin, not pi-outpost's, and the same list now grants CORS on the HTTP routes,
so a cross-origin widget works without a proxy in front.
`embed.workspaceControls` chooses what it offers around the project: `settings` (one
project, root editable through Settings only), `root` (a compact root chooser) or
`projects` (the full open/switch/close controls).

## Use an existing pi installation

```json
{ "agentRuntime": { "mode": "rpc", "executable": "pi", "args": [] } }
```

pi-outpost then supervises a `pi --mode rpc` child instead of running the SDK
in-process — to match an installation you already maintain, or to isolate a crash. It
appends `--mode rpc` and derives `--session-dir` itself, and passes the rest of the
configuration (skills, extensions, prompt templates, tools, system prompt) to the
child, so the same file describes the same agent either way.

Two things to know first: **`sandbox` cannot be combined with `rpc`** — the pair is
refused at load, because the sandbox is a toolset this server builds and a child builds
its own; isolate it with a container or a dedicated user instead. And a few features
have no RPC equivalent and say so rather than failing quietly: storing credentials,
declaring a provider, changing the sandbox from Settings, tree navigation, editing a
past message, and automatic session titles.

The executable may also be a Pi-derived agent. For [Prime Agent](https://github.com/PrimeIntellect-ai/prime-agent):

```json
{ "agentRuntime": { "mode": "rpc", "executable": "prime-agent", "args": [] } }
```

Leave `tools` unset (Prime Agent's only built-in tool is `ipython`), and expect the
conversation tree as a single branch. See [Agent runtimes](configuration.md#agent-runtimes).

## When something does not work

| What you see | What it is |
|---|---|
| `no configuration file found` | pi-outpost never starts without one. `pi-outpost init`, or `init --global` |
| `cannot start: … is already in use` | Something else holds the port. `--port <n>` |
| The setup screen keeps coming back | No provider can answer. `pi-outpost config` shows which `agentDir` it reads. Built-in provider credentials live in `<agentDir>/auth.json`; custom provider declarations and keys live in `<agentDir>/models.json` |
| A bare `fetch failed` | A TLS-inspecting proxy. `export NODE_EXTRA_CA_CERTS=/path/to/corp-ca.pem` |
| Every turn fails on your own endpoint | The compatibility flags. Untick both, or set `compat` in `models.json` |
| Each credential change hangs ~20 s | Remote model catalogs are unreachable. `"offline": true` |
| Starting, or **+ new**, takes a long time | A new session builds the agent again: extensions loaded, MCP servers restarted. Past 2 s the server log says where the time went — `new session took 8.3s — previous session shutdown 2.1s, session and extension load 6.2s, extension bind 1.0s` (`agent runtime built in …` at startup). A late `extensions bound after …` names the extensions' own start |
| A remote browser cannot connect | The origin is not allowed. Add the exact origin you type to `server.allowedOrigins`; the log line names it |
| The file tree does not follow changes | Watching may be off (`files.watch`) or the filesystem emits no events. The tree's ↻ control re-lists by hand |
| Settings will not change the sandbox | Either a `sandboxLocks` entry, or the RPC runtime, which has no sandbox to change |
| Not sure which file is in force | `pi-outpost config` prints the resolved configuration and where it came from |

## Browser MCP management

Send `/mcp` to open the MCP manager. With the `pi-mcp-adapter` management gateway
loaded in the embedded runtime, **Refresh** reads live connection status and tool
counts, and **Connect** attempts a connection. Cached tools are not evidence of an
active connection. A runtime without that gateway reports the limitation rather
than showing invented status.

Use **Add server** for an HTTP(S) URL or a stdio command, or edit/remove a definition
in its displayed scope. The supported files are `.mcp.json`,
`~/.config/mcp/mcp.json`, the agent directory's `mcp-adapter.json`, and the project's
`.pi/mcp-adapter.json`. Servers imported from other files or extensions may appear
without edit actions. Removing one definition does not remove definitions in other
scopes or disconnect an already-running connection immediately.

Secrets and opaque arguments are masked. Leave a mask unchanged to retain its
value. When changing a URL, command, or arguments, replace or remove masked values
explicitly; credentials are not silently transferred to another destination.
Concurrent edits produce a refresh-and-retry error rather than overwriting newer
configuration.

Saving does not restart Pi. When the session is idle, **Apply saved configuration**
asks for confirmation and restarts only that Pi session, reloading its extensions
and MCP configuration. It does not restart the systemd service. Changes are disabled
while the session is working or when sandbox/extension configuration policy locks
them. Only configure servers you trust: stdio commands run as the server account.

Consecutive tools, thinking-only turns and subagent notifications are grouped under
a compact **Process** disclosure. They start collapsed. A subagent's raw transcript
requires opening its own summary too. Assistant answers and errors remain visible.
The saved-session picker nests children under their actual parent session; missing
parents and filtered search matches remain reachable.

## Manage sub-agents and their skills

With the [`@tintinweb/pi-subagents`](https://github.com/tintinweb/pi-subagents) package
installed, **Agents** in the header (in the **⋯** controls sheet on a phone) lists every
sub-agent the package sees for the current project, in its load order: built-in, package,
global (`<agentDir>/agents`), shared (`<project>/.agents/agents`) and project
(`<project>/.pi/agents`). Each card shows the source file, whether the agent is disabled,
and whether it overrides or is overridden by an agent of the same name.

Only global and project agents are edited here. **+ New agent** creates one in either
scope; built-in, package and shared agents are read-only and offer **Copy to global** or
**Copy to project** (a copy with the same name overrides the original). An editable agent
has:

- **Skills**: *All skills* (no `skills:` key), *No skills* (`skills: false`) or a
  checklist written as `skills: a, b`; clearing every box writes `skills: false`. Only
  skills pi-subagents' loader resolves for this project are selectable — those under
  `<project>/.pi/skills`, `<project>/.agents/skills`, `<agentDir>/skills`,
  `~/.agents/skills` or `~/.pi/skills`, not behind a symlinked root. Other loaded skills
  are listed disabled with the reason, and an attached name that no longer resolves is
  flagged.
- **Tools**: the default (all built-in tools) or an allow-list of built-ins, with other
  entries such as `ext:…` or `mcp__…` kept as typed.
- **Model** (or inherit), **Thinking** (or inherit), **Prompt mode** and the **System
  prompt** (the file body), plus enable/disable, rename and delete (with confirmation).

Saving rewrites only the keys you changed; other keys, comments, order and line endings
are kept. If the file changed on disk since it was opened, the save is refused —
**Reload from disk** shows the current file. The browser names an agent by scope and name
only, and the server writes nowhere but the two agent folders. pi-subagents re-reads the
files on every call, so changes apply without a restart.

**Run in this project** starts an enabled agent with a prompt through pi-subagents'
`subagents:rpc:spawn` on the project's own runtime and shows the agent id it returned. It
is unavailable on the `rpc` agent runtime and when pi-subagents is not loaded.

Tool and skill limits shape what a sub-agent is offered; they are **not a security
sandbox**. A sub-agent with `bash` can read any file the server account can, and every
sub-agent runs with the session's privileges. Project agents are repository content: check
the source file of an agent a cloned repository brings.

## Read activity and return to a workspace

The activity strip stays outside the scrolling transcript. It shows the current
project/session and the server-reported activity, including waiting for input,
working, starting, and ready for review. When the connection drops, it reports
that activity is unknown rather than claiming the agent has stopped. Other active
server-managed workspaces appear by name and can be selected from the strip.
Historical error text is labeled **Last error**; it is not proof of a current failure.

These states cover runtimes managed by this server. Embedded sessions also show
observed top-level detached Agent counts from their own lifecycle event bus.
Ambiguous event histories are labeled uncertain and prevent automatic retirement;
they do not prove that every nested or workflow-owned agent has stopped. A saved
transcript or completed notification is not live activity telemetry.

Use **Terminal sessions** (in the header beside **sessions**; on a phone, under
**More controls**) for separately running CLI processes that have loaded
the [opt-in CLI bridge](cli-session-bridge.md). Observation does not create another
agent. Input requires confirmation in that terminal and remains disabled when
the owner is busy, unreachable, or has not granted permission. A submission receipt
is not proof that the CLI accepted the text or completed a model response; check
the terminal if the CLI transcript does not change.

The **sessions** menu also lists the project's Pi CLI history when Pi CLI and Outpost
share the configured agent directory; open, rename or delete it like any session. New
web conversations are saved in the CLI's directory for the project, so `pi -c` or
`/resume` in a terminal there continues them too. Web and a terminal may keep the
**same** conversation open and both send to it: each side reads what the other
appended before its next prompt, and the web view also updates while idle, without a
reload. The terminal shows `Synced N new messages from Outpost web` instead of
redrawing. Sending from both at the same moment can branch the conversation; nothing
is lost. Deleting is refused while a bridged CLI has the file open. See
[Shared session files](cli-session-bridge.md#shared-session-files).

Each standalone browser tab remembers its last acknowledged workspace for each
server. After reconnecting or refreshing that tab, it selects the same still-open
workspace, including a side session, without sending a prompt or opening another
agent. A new tab opens on a start screen instead of any conversation: **Recent**
lists the five most recently modified conversations across open projects (with
their live status), and **Start a new chat in** offers each open project and
**Open a project…**. Nothing is remembered until you pick, so a new tab never
inherits another tab's project. Embedded widgets and `workspaceLock` servers skip
the start screen. Tabs on the same project show the same
conversation until one of them starts a new one (**+ new**) or opens another saved
session: that tab then moves onto its own side session, and the other tabs keep
theirs. **New side session** does the same explicitly. A server with
`workspaceLock` cannot open side sessions, so there the change applies to every
tab and the asking tab is told so. If a side session no longer
exists after a server restart, the tab reports the fallback; select a saved
session explicitly rather than assuming the old session was restored. An embedded
widget's explicit workspace remains authoritative. The tab shows disconnected as
soon as the browser reports offline or the socket closes; a silent half-open
socket is detected by a connection probe (normally within 10 seconds while the
tab is visible). Hidden tabs defer probes to avoid false alarms from suspended
browser timers. The tab then reconnects without automatically resending a prompt.
This restores the server's current session in that workspace, not an older session
file if another client has changed it. Browser disconnection does not stop the
agent runtime, but browser-owned terminals and idle workspace retirement have
separate lifecycles. This is not attachment to an independently running Pi CLI.

Use **Model** to search by provider, model ID, or display name. Arrow keys select
an option; Enter applies it; Escape closes the picker and returns focus. Model
changes remain disabled while the agent is streaming. The saved-session menu
marks the current session with a contrasting outline, background, and text in
both light and dark themes.
