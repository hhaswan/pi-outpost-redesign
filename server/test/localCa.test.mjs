/**
 * The local CA end to end: `pi-outpost tls init|renew` through the real CLI and openssl,
 * the public CA routes, the CA-file checks at startup and plain HTTP on the TLS port.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import fs from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { makeWorkspace, startServer } from "./harness.mjs";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "local-ca-test-token";
const opensslAvailable = (() => {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const skip = opensslAvailable ? false : "openssl is not installed on this machine; tls init/renew need it";

/** Run the CLI against a config file, with the user config directory under `xdg`. */
function cli(args, configFile, xdg, env = {}) {
  return new Promise((resolve) => {
    const childEnv = { ...process.env, PI_OUTPOST_CONFIG: configFile, XDG_CONFIG_HOME: xdg, PI_OFFLINE: "1", NODE_V8_COVERAGE: "", ...env };
    delete childEnv.PI_OUTPOST_TOKEN;
    const child = spawn(process.execPath, ["--import=tsx/esm", path.join(SERVER_DIR, "src", "index.ts"), ...args], {
      cwd: SERVER_DIR,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => resolve({ code, output }));
  });
}

function request(url, { ca, method = "GET", path: rawPath, headers, body } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request({ host: target.hostname, port: target.port, path: rawPath ?? `${target.pathname}${target.search}`, method, ca, headers, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(body);
  });
}

/** One raw plaintext exchange on the TLS port. */
function plain(port, text) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => socket.write(text));
    let answer = "";
    socket.on("data", (chunk) => (answer += chunk));
    socket.on("end", () => resolve(answer));
    socket.on("error", reject);
    socket.setTimeout(8000, () => socket.destroy(new Error("no answer")));
  });
}

const hashFiles = (dir) => Object.fromEntries(fs.readdirSync(dir).map((name) => [name, createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex")]));

describe("local CA", { skip }, () => {
  let root;
  let xdg;
  let configFile;
  let tlsDir;
  let caKeyText;
  let server;
  let tls;

  before(async () => {
    root = await makeWorkspace();
    xdg = path.join(root, ".config");
    tlsDir = path.join(xdg, "pi-outpost", "tls");
    configFile = path.join(root, "cli.config.json");
    await writeFile(configFile, JSON.stringify({ cwd: root, agentDir: path.join(root, ".pi-agent"), sandbox: false, server: { host: "0.0.0.0", port: 3999, token: TOKEN, allowInsecureHttp: true } }, null, 2), { mode: 0o600 });
  });
  after(async () => {
    await server?.stop();
    await rm(root, { recursive: true, force: true });
  });

  test("InitCreatesCaAndServerCertificate", async () => {
    const result = await cli(["tls", "init", "--ip", "10.11.3.77"], configFile, xdg);
    assert.equal(result.code, 0, result.output);
    for (const name of ["ca.key", "ca.crt", "server.key", "server.crt"]) assert.ok(fs.existsSync(path.join(tlsDir, name)), name);
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(tlsDir).mode & 0o777, 0o700);
      for (const name of ["ca.key", "server.key"]) assert.equal(fs.statSync(path.join(tlsDir, name)).mode & 0o777, 0o600, name);
    }
    assert.deepEqual(fs.readdirSync(tlsDir).sort(), ["ca.crt", "ca.key", "server.crt", "server.key"], "no leftover CSR or openssl config");
    const ca = new X509Certificate(fs.readFileSync(path.join(tlsDir, "ca.crt")));
    const leaf = new X509Certificate(fs.readFileSync(path.join(tlsDir, "server.crt")));
    assert.ok(ca.ca, "the CA certificate is a CA");
    assert.ok(!leaf.ca, "the server certificate is not");
    assert.ok(leaf.checkIssued(ca) && leaf.verify(ca.publicKey), "server.crt is signed by ca.crt");
    const days = (certificate) => Math.round((Date.parse(certificate.validTo) - Date.now()) / 86_400_000);
    assert.equal(days(leaf), 365);
    assert.ok(days(ca) >= 3649 && days(ca) <= 3650);
    for (const san of ["IP Address:10.11.3.77", "IP Address:127.0.0.1", "DNS:localhost", `DNS:${os.hostname()}`]) {
      assert.ok(leaf.subjectAltName.split(", ").includes(san), `${san} in ${leaf.subjectAltName}`);
    }
    assert.equal(leaf.subjectAltName.split(", ").length, 4, "exactly the four names");
    assert.match(leaf.keyUsage?.join(",") ?? "", /1\.3\.6\.1\.5\.5\.7\.3\.1/, "serverAuth");
    tls = JSON.parse(await readFile(configFile, "utf8")).server.tls;
    assert.deepEqual(tls, { certFile: path.join(tlsDir, "server.crt"), keyFile: path.join(tlsDir, "server.key"), caFile: path.join(tlsDir, "ca.crt") });
    assert.ok(!JSON.stringify(tls).includes("ca.key"), "the configuration never names ca.key");
    if (process.platform !== "win32") assert.equal(fs.statSync(configFile).mode & 0o777, 0o600, "config permissions kept");
  });

  test("InitReusesExistingCa: init twice keeps the CA and the valid server certificate byte for byte", async () => {
    const before = hashFiles(tlsDir);
    const result = await cli(["tls", "init", "--ip", "10.11.3.77"], configFile, xdg);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /reused the existing local CA/);
    assert.match(result.output, /kept the existing server certificate/);
    assert.deepEqual(hashFiles(tlsDir), before, "no file changed");
    assert.deepEqual(JSON.parse(await readFile(configFile, "utf8")).server.tls, tls, "server.tls still names the same files");
  });

  test("InitReusesExistingCa: a missing server certificate is reissued from the same CA", async () => {
    const backup = path.join(root, "server.crt.bak");
    fs.copyFileSync(path.join(tlsDir, "server.crt"), backup);
    fs.rmSync(path.join(tlsDir, "server.crt"));
    const caBefore = hashFiles(tlsDir)["ca.crt"];
    const result = await cli(["tls", "init", "--ip", "10.11.3.77"], configFile, xdg);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /reused the existing local CA[\s\S]*issued a server certificate/);
    assert.equal(hashFiles(tlsDir)["ca.crt"], caBefore);
    assert.ok(new X509Certificate(fs.readFileSync(path.join(tlsDir, "server.crt"))).verify(new X509Certificate(fs.readFileSync(path.join(tlsDir, "ca.crt"))).publicKey));
  });

  test("InitHalfCaRefused: ca.crt without ca.key is refused, naming the backup and --new-ca", async () => {
    const other = path.join(root, "half-xdg");
    fs.mkdirSync(path.join(other, "pi-outpost", "tls"), { recursive: true });
    fs.copyFileSync(path.join(tlsDir, "ca.crt"), path.join(other, "pi-outpost", "tls", "ca.crt"));
    const result = await cli(["tls", "init"], configFile, other);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /ca\.crt without ca\.key/);
    assert.match(result.output, /--new-ca/);
    assert.deepEqual(fs.readdirSync(path.join(other, "pi-outpost", "tls")), ["ca.crt"]);
  });

  test("RenewKeepsCa", async () => {
    const caBefore = new X509Certificate(fs.readFileSync(path.join(tlsDir, "ca.crt"))).fingerprint256;
    const caKeyBefore = hashFiles(tlsDir)["ca.key"];
    const leafBefore = fs.readFileSync(path.join(tlsDir, "server.crt"), "utf8");
    const result = await cli(["tls", "renew", "--ip", "10.11.3.77"], configFile, xdg);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /restart/);
    const ca = new X509Certificate(fs.readFileSync(path.join(tlsDir, "ca.crt")));
    const leaf = new X509Certificate(fs.readFileSync(path.join(tlsDir, "server.crt")));
    assert.equal(ca.fingerprint256, caBefore);
    assert.equal(hashFiles(tlsDir)["ca.key"], caKeyBefore);
    assert.notEqual(leaf.toString(), new X509Certificate(leafBefore).toString());
    assert.ok(leaf.verify(ca.publicKey));
    assert.equal(Math.round((Date.parse(leaf.validTo) - Date.now()) / 86_400_000), 365);
  });

  test("InitNewCaRequiresFlag: --new-ca replaces the CA with a warning and keeps the old one aside", async () => {
    const other = path.join(root, "replace-xdg");
    const otherConfig = path.join(root, "replace.json");
    await writeFile(otherConfig, await readFile(configFile, "utf8"), { mode: 0o600 });
    assert.equal((await cli(["tls", "init", "--ip", "10.11.3.77"], otherConfig, other)).code, 0);
    const dir = path.join(other, "pi-outpost", "tls");
    const oldCa = fs.readFileSync(path.join(dir, "ca.crt"));
    const result = await cli(["tls", "init", "--ip", "10.11.3.77", "--new-ca"], otherConfig, other);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /WARNING: replaced the local CA\. Every device must install and trust the new CA again/);
    assert.ok(!fs.readFileSync(path.join(dir, "ca.crt")).equals(oldCa), "a new CA");
    const replaced = fs.readdirSync(dir).find((name) => name.startsWith("replaced-"));
    assert.ok(replaced && fs.readFileSync(path.join(dir, replaced, "ca.crt")).equals(oldCa), "the old CA was moved aside, not deleted");
    assert.ok(fs.existsSync(path.join(dir, replaced, "ca.key")));
  });

  test("OpensslMissing", async () => {
    const other = path.join(root, "other-xdg");
    const result = await cli(["tls", "init"], configFile, other, { PATH: path.join(root, "no-such-bin") });
    assert.notEqual(result.code, 0);
    assert.match(result.output, /openssl/);
    assert.match(result.output, /server\.tls\.certFile/);
    assert.ok(!fs.existsSync(path.join(other, "pi-outpost", "tls", "ca.key")));
  });

  test("CaPageIsPublic, CaPrivateKeyNeverServed and plain HTTP on the TLS port", async (t) => {
    caKeyText = fs.readFileSync(path.join(tlsDir, "ca.key"), "utf8");
    // The CA key becomes a FIFO: a reader opening it would block there, and a writer
    // opened without blocking would then find it. ENXIO afterwards means nobody did.
    const fifo = process.platform === "linux";
    if (fifo) {
      fs.rmSync(path.join(tlsDir, "ca.key"));
      execFileSync("mkfifo", ["-m", "600", path.join(tlsDir, "ca.key")]);
    }
    const caPem = fs.readFileSync(tls.caFile);
    server = await startServer(root, { server: { host: "127.0.0.1", token: TOKEN, tls } }, { ca: caPem });
    const base = server.base;

    const page = await request(`${base}/ca`, { ca: caPem });
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /^text\/html/);
    assert.match(page.headers["content-security-policy"], /default-src 'none'/);
    assert.doesNotMatch(page.body.toString(), /<script/i);
    const crt = await request(`${base}/ca.crt`, { ca: caPem });
    assert.equal(crt.status, 200);
    assert.equal(crt.headers["content-type"], "application/x-x509-ca-cert");
    const fingerprint = createHash("sha256").update(crt.body).digest("hex").toUpperCase().match(/../g).join(":");
    assert.ok(page.body.toString().includes(fingerprint), "the page shows the SHA-256 of the served DER");
    assert.equal(new X509Certificate(crt.body).fingerprint256, new X509Certificate(caPem).fingerprint256);
    const profile = await request(`${base}/ca.mobileconfig`, { ca: caPem });
    assert.equal(profile.status, 200);
    assert.equal(profile.headers["content-type"], "application/x-apple-aspen-config");
    const xml = profile.body.toString();
    const payloads = [...xml.matchAll(/<data>([^<]*)<\/data>/g)].map((match) => match[1]);
    assert.deepEqual(payloads, [crt.body.toString("base64")], "the profile carries the CA certificate and nothing else");
    assert.match(xml, /com\.apple\.security\.root/);

    const keyBody = caKeyText.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    for (const rawPath of ["/ca", "/ca.crt", "/ca.mobileconfig", "/ca.key", "/ca/../ca.key", "/tls/ca.key", "/ca.crt/../ca.key"]) {
      const res = await request(`${base}/`, { ca: caPem, path: rawPath });
      const text = res.body.toString("latin1");
      assert.ok(!/PRIVATE KEY/.test(text), `${rawPath} serves no private key`);
      assert.ok(!text.includes(keyBody.slice(0, 40)) && !res.body.toString("base64").includes(keyBody.slice(0, 40)), `${rawPath} carries none of the key's bytes`);
    }
    if (fifo) {
      assert.throws(() => fs.openSync(path.join(tlsDir, "ca.key"), fs.constants.O_WRONLY | fs.constants.O_NONBLOCK), (error) => error.code === "ENXIO", "the server never opened ca.key");
    } else {
      t.diagnostic("ca.key open check needs a Linux FIFO; the content checks above still ran");
    }

    // HttpRedirectsToHttpsRoot
    const redirect = await plain(server.port, `GET /?token=secret HTTP/1.1\r\nHost: 10.11.3.77:${server.port}\r\n\r\n`);
    assert.match(redirect, /^HTTP\/1\.1 301 /);
    assert.match(redirect, new RegExp(`\r\nLocation: https://10\\.11\\.3\\.77:${server.port}/\r\n`));
    assert.ok(!redirect.includes("secret") && !redirect.includes("token"), "path and query are not echoed");
    // HttpForeignHostRefused
    const foreign = await plain(server.port, "GET / HTTP/1.1\r\nHost: evil.example\r\n\r\n");
    assert.match(foreign, /^HTTP\/1\.1 400 /);
    assert.doesNotMatch(foreign, /Location:/i);
    // HttpCannotReachApi
    const body = JSON.stringify({ token: TOKEN });
    const api = await plain(server.port, `POST /api/login HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nOrigin: http://127.0.0.1:${server.port}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
    assert.match(api, /^HTTP\/1\.1 301 /);
    assert.doesNotMatch(api, /set-cookie|signedIn/i);
    assert.ok(!fs.existsSync(path.join(xdg, "pi-outpost", "sessions.json")), "the login handler did not run");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.ok(!server.log().includes("secret"), "the server log does not carry the query");
    // Normal HTTPS is unaffected by the sniffer.
    assert.equal((await request(`${base}/health`, { ca: caPem })).status, 200);
  });

  test("CaFileWithPrivateKeyRefused and NonCaCertificateRefused", async () => {
    const mixed = path.join(root, "mixed.pem");
    await writeFile(mixed, `${fs.readFileSync(tls.caFile, "utf8")}${fs.readFileSync(tls.keyFile, "utf8")}`);
    const keyLine = fs.readFileSync(tls.keyFile, "utf8").split("\n")[1];
    for (const [caFile, pattern] of [[mixed, /server\.tls\.caFile contains a private key/], [tls.certFile, /server\.tls\.caFile is not a CA certificate/]]) {
      const other = await makeWorkspace();
      await assert.rejects(startServer(other, { server: { host: "127.0.0.1", token: TOKEN, tls: { ...tls, caFile } } }, { ca: fs.readFileSync(tls.caFile) }), (error) => {
        assert.match(error.message, pattern);
        assert.ok(!error.message.includes(keyLine), "the key is not printed");
        assert.doesNotMatch(error.message, /\[server\] https?:\/\//, "no listener opened");
        return true;
      });
      await rm(other, { recursive: true, force: true });
    }
  });
});

describe("certificate expiry and absent CA routes", { skip }, () => {
  test("ExpiryWarning and CaRoutesAbsentWithoutCaFile", async () => {
    const root = await makeWorkspace();
    const certFile = path.join(root, "short.crt");
    const keyFile = path.join(root, "short.key");
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", keyFile, "-out", certFile, "-days", "20", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
    const server = await startServer(root, { server: { host: "127.0.0.1", token: TOKEN, tls: { certFile, keyFile } } }, { ca: fs.readFileSync(certFile) });
    try {
      assert.match(server.log(), /the TLS certificate expires in 20 days: run "pi-outpost tls renew"/);
      assert.equal((await request(`${server.base}/ca.crt`, { ca: fs.readFileSync(certFile) })).status, 404);
      // The same notice reaches Settings through /api/session.
      const session = await request(`${server.base}/api/session`, { ca: fs.readFileSync(certFile), headers: { Authorization: `Bearer ${TOKEN}` } });
      assert.equal(session.status, 200);
      assert.equal(JSON.parse(session.body.toString()).certificateDaysLeft, 20);
      // LoginSetsHardenedCookie over TLS / PlainHttpSessionUntilCutover (https half)
      assert.doesNotMatch(server.log(), /sessions travel unencrypted/);
      const login = await request(`${server.base}/api/login`, { ca: fs.readFileSync(certFile), method: "POST", body: JSON.stringify({ token: TOKEN }), headers: { "Content-Type": "application/json", Origin: server.base } });
      assert.equal(login.status, 200);
      const [cookie] = login.headers["set-cookie"];
      assert.match(cookie, /^__Host-pi-outpost-session=[A-Za-z0-9_-]{43}; Max-Age=1209600; Path=\/; HttpOnly; Secure; SameSite=Strict$/);
      const value = /=([^;]*)/.exec(cookie)[1];
      // The http-era name is still read after the cutover, and logout clears both names.
      const plainEra = await request(`${server.base}/api/session`, { ca: fs.readFileSync(certFile), headers: { Cookie: `pi-outpost-session=${value}` } });
      assert.equal(plainEra.status, 200);
      const logout = await request(`${server.base}/api/logout`, { ca: fs.readFileSync(certFile), method: "POST", body: "{}", headers: { "Content-Type": "application/json", Origin: server.base, Cookie: `__Host-pi-outpost-session=${value}` } });
      assert.equal(logout.status, 200);
      assert.deepEqual(logout.headers["set-cookie"].map((line) => line.split("=")[0]).sort(), ["__Host-pi-outpost-session", "pi-outpost-session"]);
    } finally {
      await server.stop();
    }
  });
});
