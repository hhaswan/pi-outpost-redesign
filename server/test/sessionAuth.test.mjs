/**
 * Browser sign-in at the wire: cookie sessions, the session store, revocation,
 * token rotation, pairing and URL-token refusal, against a real server process.
 * Plain loopback HTTP is enough here: cookies are headers to a Node client.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { bearer, connect, makeWorkspace, PNG_BYTES, startServer } from "./harness.mjs";

const TOKEN = "session-auth-test-token";
const COOKIE = "__Host-pi-outpost-session";
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** A client of one server: requests from its own origin unless told otherwise. */
function client(server) {
  const origin = server.base;
  return {
    async post(route, body, { cookie, origin: from = origin, headers = {} } = {}) {
      return fetch(`${server.base}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(from ? { Origin: from } : {}), ...(cookie ? { Cookie: `${COOKIE}=${cookie}` } : {}), ...headers },
        body: JSON.stringify(body ?? {}),
      });
    },
    async get(route, { cookie, headers = {} } = {}) {
      return fetch(`${server.base}${route}`, { headers: { ...(cookie ? { Cookie: `${COOKIE}=${cookie}` } : {}), ...headers } });
    },
    async login(token = TOKEN) {
      const res = await this.post("/api/login", { token });
      assert.equal(res.status, 200, "login");
      return cookieValue(res);
    },
    socket(cookie, options = {}) {
      return connect(server.wsUrl(), { ...options, headers: { ...options.headers, Cookie: `${COOKIE}=${cookie}` } });
    },
  };
}

function cookieValue(res) {
  const header = res.headers.get("set-cookie");
  assert.ok(header, "a Set-Cookie header");
  return /__Host-pi-outpost-session=([^;]*)/.exec(header)[1];
}

async function readStore(server) {
  return JSON.parse(await readFile(path.join(server.configDir, "sessions.json"), "utf8"));
}

/** Rewrite one stored session; the server re-reads the file when it changes. */
async function editSession(server, cookie, change) {
  const store = await readStore(server);
  const session = store.sessions.find((entry) => entry.id === sha256(cookie));
  assert.ok(session, "the session is stored");
  change(session);
  // Make the mtime move even on a coarse-grained filesystem.
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(path.join(server.configDir, "sessions.json"), JSON.stringify(store));
}

const isOpen = (socket) => socket.closed() === null;

/**
 * A signed-in browser without spending a login attempt: the session is written to the
 * store the way the server writes it, and the server picks it up from disk. Login itself
 * is exercised by its own tests; its rate limit would otherwise refuse this suite.
 */
async function forge(server) {
  const cookie = randomBytes(32).toString("base64url");
  const file = path.join(server.configDir, "sessions.json");
  const store = await readFile(file, "utf8").then(JSON.parse, () => ({ version: 1, sessions: [] }));
  const now = Date.now();
  store.sessions.push({ id: sha256(cookie), created: now, lastUsed: now, expires: now + 14 * 86_400_000, label: "test", via: "token" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  await mkdir(server.configDir, { recursive: true });
  await writeFile(file, JSON.stringify(store), { mode: 0o600 });
  return cookie;
}

describe("browser session auth", () => {
  let server;
  let api;

  before(async () => {
    server = await startServer(await makeWorkspace({ "plot.png": PNG_BYTES }), { server: { token: TOKEN, allowedOrigins: ["https://other.example"] } });
    api = client(server);
  });
  after(async () => {
    await server?.stop();
  });

  test("LoginSetsHardenedCookie", async () => {
    const res = await api.post("/api/login", { token: TOKEN });
    assert.equal(res.status, 200);
    const header = res.headers.get("set-cookie");
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=1209600"]) {
      assert.ok(header.split(/;\s*/).includes(attribute), `cookie has ${attribute}: ${header}`);
    }
    assert.match(header, /^__Host-pi-outpost-session=[A-Za-z0-9_-]{43};/);
    assert.doesNotMatch(header, /Domain=/i);
    const body = await res.text();
    assert.ok(!body.includes(TOKEN) && !body.includes(cookieValue(res)), "the body carries neither the token nor the cookie");
  });

  test("LoginWrongToken", async () => {
    for (const body of [{ token: "wrong" }, {}]) {
      const res = await api.post("/api/login", body);
      assert.equal(res.status, 401);
      assert.equal(res.headers.get("set-cookie"), null);
    }
  });

  test("LoginCrossOriginRefused", async () => {
    for (const origin of ["https://evil.example", "https://other.example", undefined]) {
      const res = await api.post("/api/login", { token: TOKEN }, { origin: origin ?? "" });
      assert.equal(res.status, 403, `origin ${origin}`);
      assert.equal(res.headers.get("set-cookie"), null);
    }
  });

  test("StoreHoldsOnlyHashes", async () => {
    const cookie = await api.login();
    const file = path.join(server.configDir, "sessions.json");
    const text = await readFile(file, "utf8");
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.ok(text.includes(sha256(cookie)), "the hash is stored");
    assert.ok(!text.includes(cookie), "the cookie value is not");
    const entry = JSON.parse(text).sessions.find((session) => session.id === sha256(cookie));
    assert.equal(entry.via, "token");
    for (const field of ["created", "lastUsed", "expires", "label"]) assert.ok(entry[field] !== undefined, field);
  });

  test("a session cookie opens every protected surface: /api/session, /branding, /files/raw and /ws", async () => {
    const cookie = await forge(server);
    const session = await api.get("/api/session", { cookie });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).signedIn, true);
    assert.equal((await api.get("/branding", { cookie })).status, 200);
    assert.equal((await api.get("/files/raw?path=plot.png", { cookie })).status, 200);
    const socket = api.socket(cookie);
    try {
      await socket.waitFor("hello", 30_000);
    } finally {
      socket.close();
    }
  });

  test("ExpiredCookieRejected", async () => {
    const cookie = await forge(server);
    await editSession(server, cookie, (session) => {
      session.expires = Date.now() - 1000;
    });
    assert.equal((await api.get("/api/session", { cookie })).status, 401);
    assert.equal((await api.get("/files/raw?path=plot.png", { cookie })).status, 401);
    const socket = api.socket(cookie);
    assert.equal(await socket.waitForClose(), 4401);
    assert.deepEqual(socket.received, [], "no snapshot before the close");
  });

  test("UseExtendsExpiry", async () => {
    const cookie = await forge(server);
    const day = 24 * 60 * 60 * 1000;
    await editSession(server, cookie, (session) => {
      session.expires = Date.now() + 11 * day;
    });
    const res = await api.get("/api/session", { cookie });
    assert.equal(res.status, 200);
    assert.equal(cookieValue(res), cookie, "the same cookie is re-sent");
    assert.match(res.headers.get("set-cookie"), /Max-Age=1209600/);
    const stored = (await readStore(server)).sessions.find((session) => session.id === sha256(cookie));
    assert.ok(Math.abs(stored.expires - (Date.now() + 14 * day)) < 60_000, "expiry moved to 14 days from now");
    // A fresh session is not re-sent on every request.
    const fresh = await forge(server);
    assert.equal((await api.get("/api/session", { cookie: fresh })).headers.get("set-cookie"), null);
  });

  test("CrossOriginSocketWithCookieRefused", async () => {
    const cookie = await forge(server);
    const socket = api.socket(cookie, { origin: "https://other.example" });
    assert.equal(await socket.waitForClose(), 4401);
    assert.deepEqual(socket.received, []);
  });

  test("CrossOriginLogoutRefused", async () => {
    const cookie = await forge(server);
    const res = await api.post("/api/logout", {}, { cookie, origin: "https://evil.example" });
    assert.equal(res.status, 403);
    assert.equal((await api.get("/api/session", { cookie })).status, 200, "the session remains valid");
  });

  test("DeployScriptBearer", async () => {
    const before = await readFile(path.join(server.configDir, "sessions.json"), "utf8");
    const socket = connect(server.wsUrl(), bearer(TOKEN));
    try {
      await socket.waitFor("hello", 30_000);
    } finally {
      socket.close();
    }
    assert.equal((await api.get("/branding", { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 200);
    assert.equal(await readFile(path.join(server.configDir, "sessions.json"), "utf8"), before, "Bearer creates no session");
  });

  test("UrlTokenRejected on every protected HTTP route, whatever else is presented", async () => {
    const cookie = await forge(server);
    for (const route of ["/branding", "/files/raw?path=plot.png", "/files/download?path=plot.png", "/api/session"]) {
      const res = await api.get(`${route}${route.includes("?") ? "&" : "?"}token=${TOKEN}`, { cookie, headers: { Authorization: `Bearer ${TOKEN}` } });
      assert.equal(res.status, 401, route);
    }
    const docx = await fetch(`${server.base}/files/docx-template?token=${TOKEN}`, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, body: "x" });
    assert.equal(docx.status, 401);
    const viaUrl = connect(server.wsUrl(TOKEN), { headers: { Cookie: `${COOKIE}=${cookie}` } });
    assert.equal(await viaUrl.waitForClose(), 4401);
    assert.deepEqual(viaUrl.received, []);
  });

  test("LogoutOnlyThisBrowser", async () => {
    const [a, b] = [await forge(server), await forge(server)];
    const [socketA, socketB] = [api.socket(a), api.socket(b)];
    await socketA.waitFor("hello", 30_000);
    await socketB.waitFor("hello", 30_000);
    const res = await api.post("/api/logout", {}, { cookie: a });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal(await socketA.waitForClose(), 4401, "the signed-out browser's socket closes at once");
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.ok(isOpen(socketB), "the other browser stays connected");
    assert.equal((await api.get("/api/session", { cookie: a })).status, 401);
    assert.equal((await api.get("/api/session", { cookie: b })).status, 200);
    socketB.close();
  });

  test("RevokedSessionRejectedOnOpenSocket", async () => {
    const [a, b] = [await forge(server), await forge(server)];
    const [socketA, socketB] = [api.socket(a), api.socket(b)];
    await socketA.waitFor("hello", 30_000);
    await socketB.waitFor("hello", 30_000);
    assert.equal((await api.post("/api/sessions/revoke-all", {}, { cookie: a })).status, 200);
    assert.equal(await socketA.waitForClose(), 4401);
    assert.equal(await socketB.waitForClose(), 4401);
    assert.equal((await api.get("/api/session", { cookie: a })).status, 401);
    assert.equal((await api.get("/api/session", { cookie: b })).status, 401);
    assert.equal((await readStore(server)).sessions.length, 0);
  });

  test("PairingRequiresSignedInCreator", async () => {
    assert.equal((await api.post("/api/pair/create", {})).status, 401);
  });

  test("PairingCreatesIndependentSession and PairingCodeReuseRejected", async () => {
    const creator = await forge(server);
    const created = await api.post("/api/pair/create", {}, { cookie: creator });
    assert.equal(created.status, 200);
    const { code, expiresAt } = await created.json();
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    assert.ok(expiresAt - Date.now() <= 120_000 && expiresAt - Date.now() > 100_000, "valid two minutes");
    // Typed in lower case without the dash: the same code.
    const redeemed = await api.post("/api/pair", { code: code.replace("-", "").toLowerCase() });
    assert.equal(redeemed.status, 200);
    const paired = cookieValue(redeemed);
    assert.notEqual(paired, creator);
    assert.equal((await readStore(server)).sessions.find((session) => session.id === sha256(paired)).via, "pair");
    const again = await api.post("/api/pair", { code });
    assert.equal(again.status, 401, "single use");
    assert.equal(again.headers.get("set-cookie"), null);
    assert.equal((await api.post("/api/logout", {}, { cookie: creator })).status, 200);
    assert.equal((await api.get("/api/session", { cookie: paired })).status, 200, "signing out the creator leaves the paired device signed in");
  });

  test("OldTokenRejectedAfterInAppRotation", async () => {
    const [rotating, other] = [await forge(server), await forge(server)];
    const code = (await (await api.post("/api/pair/create", {}, { cookie: rotating })).json()).code;
    const res = await api.post("/api/token/rotate", { revokeOtherSessions: true }, { cookie: rotating });
    assert.equal(res.status, 200);
    const { token } = await res.json();
    assert.ok(Buffer.from(token, "base64url").length >= 32, "at least 32 random bytes");
    assert.equal((await api.get("/branding", { headers: { Authorization: `Bearer ${TOKEN}` } })).status, 401, "old Bearer refused");
    assert.equal((await api.post("/api/login", { token: TOKEN })).status, 401, "old token sign-in refused");
    assert.equal((await api.get("/branding", { headers: { Authorization: `Bearer ${token}` } })).status, 200, "new Bearer accepted");
    assert.equal((await api.get("/api/session", { cookie: rotating })).status, 200, "the rotating browser stays signed in");
    assert.equal((await api.get("/api/session", { cookie: other })).status, 401, "other sessions are revoked");
    assert.equal((await api.post("/api/pair", { code })).status, 401, "rotation invalidates pairing codes");
    assert.equal(JSON.parse(await readFile(server.configFile, "utf8")).server.token, token, "written to server.token");
    const login = await api.post("/api/login", { token });
    assert.equal(login.status, 200);
  });
});

describe("sessions across processes", () => {
  test("StoreSurvivesRestart: a session stored by an earlier run still authenticates", async () => {
    const root = await makeWorkspace();
    const cookie = "earlier-run-cookie-value-0123456789abcdefghijk";
    const now = Date.now();
    await mkdir(path.join(root, ".config", "pi-outpost"), { recursive: true });
    await writeFile(path.join(root, ".config", "pi-outpost", "sessions.json"), JSON.stringify({ version: 1, sessions: [{ id: sha256(cookie), created: now, lastUsed: now, expires: now + 86_400_000 * 13.5, label: "earlier", via: "token" }] }), { mode: 0o600 });
    const server = await startServer(root, { server: { token: TOKEN } });
    try {
      assert.equal((await client(server).get("/api/session", { cookie })).status, 200);
      assert.equal((await client(server).get("/api/session", { cookie: "unknown" })).status, 401);
    } finally {
      await server.stop();
    }
  });

  test("OpenSocketClosedOnExpiry and CliRevokeAllReachesRunningServer, within the 15 s sweep", async () => {
    const server = await startServer(await makeWorkspace(), { server: { token: TOKEN } });
    const api = client(server);
    try {
      const [expiring, revoked] = [await api.login(), await api.login()];
      const [socketA, socketB] = [api.socket(expiring), api.socket(revoked)];
      await socketA.waitFor("hello", 30_000);
      await socketB.waitFor("hello", 30_000);
      await editSession(server, expiring, (session) => {
        session.expires = Date.now() + 500;
      });
      const started = Date.now();
      assert.equal(await socketA.waitForClose(17_000), 4401);
      assert.ok(Date.now() - started < 16_500, "closed within the sweep interval");
      assert.ok(isOpen(socketB), "the other session is untouched");

      const cli = spawn(process.execPath, ["--import=tsx/esm", path.join(SERVER_DIR, "src", "index.ts"), "sessions", "revoke-all"], {
        cwd: SERVER_DIR,
        env: { ...process.env, PI_OUTPOST_CONFIG: server.configFile, XDG_CONFIG_HOME: path.dirname(server.configDir), PI_OFFLINE: "1", NODE_V8_COVERAGE: "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      cli.stdout.on("data", (chunk) => (output += chunk));
      cli.stderr.on("data", (chunk) => (output += chunk));
      assert.equal(await new Promise((resolve) => cli.on("close", resolve)), 0, output);
      assert.equal((await readStore(server)).sessions.length, 0);
      const revokedAt = Date.now();
      assert.equal(await socketB.waitForClose(17_000), 4401);
      assert.ok(Date.now() - revokedAt < 16_500);
      assert.equal((await api.get("/api/session", { cookie: revoked })).status, 401);
    } finally {
      await server.stop();
    }
  });

  test("RotationRefusedForEnvToken", async () => {
    const server = await startServer(await makeWorkspace(), { server: { token: "file-token" } }, { env: { PI_OUTPOST_TOKEN: TOKEN } });
    try {
      const before = await readFile(server.configFile, "utf8");
      const cookie = await client(server).login(TOKEN);
      const res = await client(server).post("/api/token/rotate", {}, { cookie });
      assert.equal(res.status, 409);
      assert.match((await res.json()).message, /PI_OUTPOST_TOKEN/);
      assert.equal(await readFile(server.configFile, "utf8"), before);
      const cli = spawn(process.execPath, ["--import=tsx/esm", path.join(SERVER_DIR, "src", "index.ts"), "token", "rotate"], {
        cwd: SERVER_DIR,
        env: { ...process.env, PI_OUTPOST_CONFIG: server.configFile, XDG_CONFIG_HOME: path.dirname(server.configDir), PI_OUTPOST_TOKEN: TOKEN, NODE_V8_COVERAGE: "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      cli.stdout.on("data", (chunk) => (output += chunk));
      cli.stderr.on("data", (chunk) => (output += chunk));
      assert.equal(await new Promise((resolve) => cli.on("close", resolve)), 1);
      assert.match(output, /PI_OUTPOST_TOKEN/);
      assert.equal(await readFile(server.configFile, "utf8"), before);
    } finally {
      await server.stop();
    }
  });

  test("LoginRateLimited and PairingRedeemRateLimited: the 11th attempt is refused unchecked", async () => {
    const server = await startServer(await makeWorkspace(), { server: { token: TOKEN } });
    const api = client(server);
    try {
      for (let attempt = 0; attempt < 10; attempt++) assert.equal((await api.post("/api/login", { token: "wrong" })).status, 401);
      const limited = await api.post("/api/login", { token: TOKEN });
      assert.equal(limited.status, 429, "even the right token is not checked");
      assert.equal(limited.headers.get("set-cookie"), null);
      for (let attempt = 0; attempt < 10; attempt++) assert.equal((await api.post("/api/pair", { code: "AAAAA-AAAAA" })).status, 401);
      assert.equal((await api.post("/api/pair", { code: "AAAAA-AAAAA" })).status, 429);
    } finally {
      await server.stop();
    }
  });

  test("a CLI rotation writes a new token for the next start and --revoke-sessions empties the store", async () => {
    const server = await startServer(await makeWorkspace(), { server: { token: TOKEN } });
    try {
      await client(server).login();
      const cli = spawn(process.execPath, ["--import=tsx/esm", path.join(SERVER_DIR, "src", "index.ts"), "token", "rotate", "--revoke-sessions"], {
        cwd: SERVER_DIR,
        env: { ...process.env, PI_OUTPOST_CONFIG: server.configFile, XDG_CONFIG_HOME: path.dirname(server.configDir), PI_OUTPOST_TOKEN: undefined, NODE_V8_COVERAGE: "" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      cli.stdout.on("data", (chunk) => (output += chunk));
      cli.stderr.on("data", (chunk) => (output += chunk));
      assert.equal(await new Promise((resolve) => cli.on("close", resolve)), 0, output);
      const written = JSON.parse(await readFile(server.configFile, "utf8")).server.token;
      assert.notEqual(written, TOKEN);
      assert.ok(output.includes(written), "printed once");
      assert.equal((await readStore(server)).sessions.length, 0);
    } finally {
      await server.stop();
    }
  });
});
