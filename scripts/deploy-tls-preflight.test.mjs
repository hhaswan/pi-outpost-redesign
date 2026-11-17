/**
 * The deploy preflight keeps the TLS directory as it found it, refuses TLS files inside the
 * checkout, and refuses a server certificate that does not chain to the configured CA.
 * Linux root with a built cli/dist only, like the deployment itself.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(repo, "cli/dist/pi-outpost.mjs");
const opensslAvailable = spawnSync("openssl", ["version"]).status === 0;
const skip = process.platform !== "linux" || process.getuid?.() !== 0 ? "the native deployment runs on Linux as root only"
  : !fs.existsSync(entry) ? "cli/dist is not built (node cli/scripts/build.mjs)"
  : !opensslAvailable ? "openssl is not installed" : false;

/** Name, size, mode and mtime of every file: what "untouched" means. */
const snapshot = (dir) => fs.readdirSync(dir).sort().map((name) => {
  const stat = fs.statSync(path.join(dir, name));
  return [name, stat.size, stat.mode, stat.mtimeMs, fs.readFileSync(path.join(dir, name)).toString("base64")];
});

function preflight(configPath, env) {
  return spawnSync(process.execPath, [path.join(repo, "scripts/deploy-custom-native.mjs"), configPath, "--check"], { cwd: repo, env, encoding: "utf8" });
}

test("DeployLeavesTlsDirUntouched, TlsInsideRepositoryRefused, MismatchedCertificateRefused", { skip }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "outpost-tls-preflight-"));
  try {
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), PI_OFFLINE: "1" };
    delete env.PI_OUTPOST_TOKEN;
    const configPath = path.join(home, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ cwd: home, sandbox: false, server: { host: "127.0.0.1", port: 3999, token: "preflight-token" } }), { mode: 0o600 });
    execFileSync(process.execPath, [entry, "tls", "init", "--ip", "127.0.0.1", "--config", configPath], { env, stdio: "pipe" });
    const tlsDir = path.join(home, ".config/pi-outpost/tls");
    const before = snapshot(tlsDir);
    const configBefore = fs.readFileSync(configPath, "utf8");

    const ok = preflight(configPath, env);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /DEPLOY_PREFLIGHT_OK \(TLS files outside the repository, certificate chains to the CA\)/);
    assert.deepEqual(snapshot(tlsDir), before, "the TLS directory is untouched");
    assert.equal(fs.readFileSync(configPath, "utf8"), configBefore, "server.tls is preserved");

    // TLS files inside the checkout would be lost by a re-clone and could be committed.
    const inside = path.join(home, "inside.json");
    const config = JSON.parse(configBefore);
    fs.writeFileSync(inside, JSON.stringify({ ...config, server: { ...config.server, tls: { ...config.server.tls, certFile: path.join(repo, "server.crt") } } }));
    const refused = preflight(inside, env);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /server\.tls\.certFile is inside the repository/);

    // A certificate from another CA would make every device warn after the restart.
    const otherCrt = path.join(home, "other.crt");
    execFileSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", path.join(home, "other.key"), "-out", otherCrt, "-days", "5", "-subj", "/CN=other"], { stdio: "ignore" });
    const mismatched = path.join(home, "mismatched.json");
    fs.writeFileSync(mismatched, JSON.stringify({ ...config, server: { ...config.server, tls: { ...config.server.tls, certFile: otherCrt } } }));
    const wrong = preflight(mismatched, env);
    assert.notEqual(wrong.status, 0);
    assert.match(wrong.stderr, /not signed by server\.tls\.caFile/);
    assert.deepEqual(snapshot(tlsDir), before);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the updater never names the TLS directory or the user config directory", () => {
  const updater = fs.readFileSync(path.join(repo, "scripts/update-custom-native.sh"), "utf8");
  assert.doesNotMatch(updater, /\.config|\/tls\b|ca\.key|server\.key|sessions\.json/);
  const deploy = fs.readFileSync(path.join(repo, "scripts/deploy-custom-native.mjs"), "utf8");
  // Every TLS file access in the deployment is a read.
  assert.doesNotMatch(deploy, /(writeFile|copyFile|rm|rename|cp)\([^)]*tls/i);
});
