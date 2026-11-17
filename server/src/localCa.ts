/**
 * A private local CA for the LAN: `pi-outpost tls init|renew`, and the public pages that
 * hand its certificate to the devices that should trust it.
 *
 * Generation shells out to `openssl` (no shell, no npm dependency). The CA key stays in
 * `<userConfigDir>/tls/ca.key`; the running server is never told where it is.
 */
import { execFile } from "node:child_process";
import { createHash, randomBytes, X509Certificate } from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { PublicCa } from "./serverTransport.ts";

const run = promisify(execFile);
export const CA_DAYS = 3650;
export const SERVER_DAYS = 365;

export class LocalCaError extends Error {}

export interface TlsFiles {
  dir: string;
  caKey: string;
  caCert: string;
  serverKey: string;
  serverCert: string;
}

export function tlsFiles(configDir: string): TlsFiles {
  const dir = path.join(configDir, "tls");
  return {
    dir,
    caKey: path.join(dir, "ca.key"),
    caCert: path.join(dir, "ca.crt"),
    serverKey: path.join(dir, "server.key"),
    serverCert: path.join(dir, "server.crt"),
  };
}

/** The address other machines reach this host on: the source of the default route, else the first non-internal IPv4. */
async function primaryAddress(): Promise<string | undefined> {
  const viaRoute = await new Promise<string | undefined>((resolve) => {
    // A connected UDP socket sends nothing; it only asks the kernel which source it would use.
    const socket = dgram.createSocket("udp4");
    socket.on("error", () => {
      socket.close();
      resolve(undefined);
    });
    socket.connect(53, "192.0.2.1", () => {
      const address = socket.address().address;
      socket.close();
      resolve(address);
    });
  });
  if (viaRoute && viaRoute !== "0.0.0.0" && !viaRoute.startsWith("127.")) return viaRoute;
  return Object.values(os.networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
}

/**
 * Subject alternative names: the given addresses (or the configured host when it is a
 * literal address, or this machine's primary address), then 127.0.0.1, localhost and the
 * host name.
 */
export async function defaultSans(host: string, ips: string[] = [], dns: string[] = []): Promise<{ ips: string[]; dns: string[] }> {
  const addresses = [...ips];
  if (addresses.length === 0) {
    if (net.isIP(host) && host !== "0.0.0.0" && host !== "::") addresses.push(host);
    else {
      const primary = await primaryAddress();
      if (primary) addresses.push(primary);
    }
  }
  for (const ip of addresses) if (!net.isIP(ip)) throw new LocalCaError(`"${ip}" is not an IP address`);
  for (const name of dns) if (!/^[A-Za-z0-9*.-]+$/.test(name)) throw new LocalCaError(`"${name}" is not a DNS name`);
  return {
    ips: [...new Set([...addresses, "127.0.0.1"])],
    dns: [...new Set(["localhost", os.hostname(), ...dns].filter(Boolean))],
  };
}

async function openssl(args: string[]): Promise<void> {
  try {
    await run("openssl", args, { windowsHide: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new LocalCaError(
        'openssl was not found on PATH. Install openssl, or configure existing PEM files in "server.tls.certFile" and "server.tls.keyFile".',
      );
    }
    throw new LocalCaError(`openssl failed: ${(error as { stderr?: string }).stderr?.trim() || (error as Error).message}`);
  }
}

/** A minimal openssl configuration, so nothing depends on the system's openssl.cnf. */
function opensslConfig(sans: { ips: string[]; dns: string[] }): string {
  const alt = [...sans.ips.map((ip) => `IP:${ip}`), ...sans.dns.map((name) => `DNS:${name}`)].join(",");
  return [
    "[req]",
    "distinguished_name = dn",
    "prompt = no",
    "[dn]",
    "CN = pi-outpost",
    "[ca]",
    "basicConstraints = critical,CA:TRUE,pathlen:0",
    "keyUsage = critical,keyCertSign,cRLSign",
    "subjectKeyIdentifier = hash",
    "[server]",
    "basicConstraints = critical,CA:FALSE",
    "keyUsage = critical,digitalSignature",
    "extendedKeyUsage = serverAuth",
    `subjectAltName = ${alt}`,
    "subjectKeyIdentifier = hash",
    "authorityKeyIdentifier = keyid",
    "",
  ].join("\n");
}

async function newKey(file: string): Promise<void> {
  await openssl(["genpkey", "-algorithm", "EC", "-pkeyopt", "ec_paramgen_curve:P-256", "-out", file]);
  fs.chmodSync(file, 0o600);
}

async function issueServer(files: TlsFiles, cnf: string, commonName: string): Promise<void> {
  const key = `${files.serverKey}.new`;
  const csr = path.join(files.dir, "server.csr");
  const cert = `${files.serverCert}.new`;
  try {
    await newKey(key);
    await openssl(["req", "-new", "-config", cnf, "-key", key, "-subj", `/CN=${commonName}`, "-out", csr]);
    // A positive random 127-bit serial: no serial file to keep.
    const serial = `0x${(randomBytes(16)[0] & 0x7f).toString(16).padStart(2, "0")}${randomBytes(15).toString("hex")}`;
    await openssl(["x509", "-req", "-in", csr, "-CA", files.caCert, "-CAkey", files.caKey, "-set_serial", serial, "-days", String(SERVER_DAYS), "-sha256", "-extfile", cnf, "-extensions", "server", "-out", cert]);
    fs.renameSync(key, files.serverKey);
    fs.renameSync(cert, files.serverCert);
  } finally {
    fs.rmSync(key, { force: true });
    fs.rmSync(cert, { force: true });
    fs.rmSync(csr, { force: true });
  }
}

export interface IssueOptions {
  host: string;
  ips?: string[];
  dns?: string[];
}

export interface InitResult {
  files: TlsFiles;
  /** An existing CA was kept: no device has to trust anything again. */
  reusedCa: boolean;
  /** The server certificate was issued now (else the existing, still valid one was kept). */
  issuedServer: boolean;
  /** With --new-ca: where the replaced CA was moved. */
  replacedCaBackup?: string;
}

/** Whether `server.crt` is signed by `ca.crt` and has more than 30 days left. */
function serverCertificateUsable(files: TlsFiles, now = Date.now()): boolean {
  try {
    const ca = new X509Certificate(fs.readFileSync(files.caCert));
    const leaf = new X509Certificate(fs.readFileSync(files.serverCert));
    return fs.existsSync(files.serverKey) && leaf.checkIssued(ca) && leaf.verify(ca.publicKey) && Date.parse(leaf.validTo) - now > 30 * 86_400_000;
  } catch {
    return false;
  }
}

/**
 * `tls init`. Idempotent: an existing CA is reused, never regenerated, so devices that trust
 * it keep trusting it; the server certificate is kept while valid, else issued from that CA.
 * Only `newCa` replaces a CA, and the old one is moved aside, not deleted.
 */
export async function initLocalCa(configDir: string, options: IssueOptions & { newCa?: boolean }): Promise<InitResult> {
  const files = tlsFiles(configDir);
  const hasKey = fs.existsSync(files.caKey);
  const hasCert = fs.existsSync(files.caCert);
  let replacedCaBackup: string | undefined;
  if ((hasKey || hasCert) && !options.newCa) {
    if (!hasKey || !hasCert) {
      throw new LocalCaError(`${files.dir} holds ${hasKey ? "ca.key without ca.crt" : "ca.crt without ca.key"}. Restore the missing file from your backup, or pass --new-ca to replace the CA (every device must then trust the new one).`);
    }
    if (serverCertificateUsable(files)) return { files, reusedCa: true, issuedServer: false };
    await renewServerCertificate(configDir, options);
    return { files, reusedCa: true, issuedServer: true };
  }
  if (hasKey || hasCert) {
    replacedCaBackup = path.join(files.dir, `replaced-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    fs.mkdirSync(replacedCaBackup, { mode: 0o700 });
    for (const file of [files.caKey, files.caCert, files.serverKey, files.serverCert]) {
      if (fs.existsSync(file)) fs.renameSync(file, path.join(replacedCaBackup, path.basename(file)));
    }
  }
  const sans = await defaultSans(options.host, options.ips, options.dns);
  fs.mkdirSync(files.dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(files.dir, 0o700);
  const cnf = path.join(files.dir, "openssl.cnf");
  fs.writeFileSync(cnf, opensslConfig(sans), { mode: 0o600 });
  try {
    await newKey(files.caKey);
    try {
      await openssl(["req", "-new", "-x509", "-config", cnf, "-extensions", "ca", "-key", files.caKey, "-subj", `/CN=pi-outpost local CA (${os.hostname()})`, "-sha256", "-days", String(CA_DAYS), "-out", files.caCert]);
      await issueServer(files, cnf, sans.ips[0] ?? "localhost");
    } catch (error) {
      // A half-made CA would be reused by the next init; nothing has trusted it yet.
      fs.rmSync(files.caKey, { force: true });
      fs.rmSync(files.caCert, { force: true });
      throw error;
    }
  } finally {
    fs.rmSync(cnf, { force: true });
  }
  return { files, reusedCa: false, issuedServer: true, ...(replacedCaBackup ? { replacedCaBackup } : {}) };
}

/** `tls renew`: a new server key and certificate from the existing CA, which stays unchanged. */
export async function renewServerCertificate(configDir: string, options: IssueOptions): Promise<TlsFiles> {
  const files = tlsFiles(configDir);
  if (!fs.existsSync(files.caKey) || !fs.existsSync(files.caCert)) {
    throw new LocalCaError(`No local CA in ${files.dir}. Run "pi-outpost tls init" first.`);
  }
  const sans = await defaultSans(options.host, options.ips, options.dns);
  const cnf = path.join(files.dir, "openssl.cnf");
  fs.writeFileSync(cnf, opensslConfig(sans), { mode: 0o600 });
  try {
    await issueServer(files, cnf, sans.ips[0] ?? "localhost");
  } finally {
    fs.rmSync(cnf, { force: true });
  }
  return files;
}

/** Deterministic UUID-shaped string from the fingerprint: reinstalling the profile replaces it. */
function profileUuid(fingerprint: string, salt: string): string {
  const hex = createHash("sha256").update(`${salt}:${fingerprint}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`.toUpperCase();
}

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** An unsigned iOS/macOS configuration profile with one root-certificate payload. */
export function mobileconfig(ca: PublicCa): string {
  const name = escapeXml(new X509Certificate(ca.der).subject.replace(/^CN=/, "") || "pi-outpost local CA");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>ca.crt</string>
      <key>PayloadContent</key>
      <data>${ca.der.toString("base64")}</data>
      <key>PayloadDisplayName</key>
      <string>${name}</string>
      <key>PayloadIdentifier</key>
      <string>pi-outpost.ca.${profileUuid(ca.fingerprint, "cert")}</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${profileUuid(ca.fingerprint, "cert")}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>${name}</string>
  <key>PayloadIdentifier</key>
  <string>pi-outpost.profile.${profileUuid(ca.fingerprint, "profile")}</string>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${profileUuid(ca.fingerprint, "profile")}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

/** The script-free install page served on /ca. */
export function caPage(ca: PublicCa, title: string): string {
  const t = escapeXml(title);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install the certificate · ${t}</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:0 auto;padding:1.5rem;color:#18181b;background:#fafafa}
h1{font-size:1.4rem}h2{font-size:1.05rem;margin-top:1.6rem}code{font-size:.85rem;word-break:break-all}
.fp{padding:.75rem 1rem;border:1px solid #d4d4d8;border-radius:1rem;background:#fff}
a.btn{display:inline-block;margin:.25rem .5rem .25rem 0;padding:.5rem 1rem;border-radius:999px;border:1px solid #059669;color:#047857;text-decoration:none}
@media (prefers-color-scheme:dark){body{background:#09090b;color:#e4e4e7}.fp{background:#18181b;border-color:#3f3f46}a.btn{color:#34d399}}
</style></head><body>
<h1>Trust this pi-outpost server</h1>
<p>Install the server's local certificate authority once on each device. Your browser then trusts this server without warnings.</p>
<p class="fp">SHA-256 fingerprint:<br><code data-testid="ca-fingerprint">${ca.fingerprint}</code><br>Valid until ${escapeXml(ca.validTo)}</p>
<p>Before installing, compare this fingerprint with the one shown in Settings on a device that already trusts the server.</p>
<p><a class="btn" href="/ca.mobileconfig">iPhone / iPad profile</a><a class="btn" href="/ca.crt">Certificate (ca.crt)</a><a class="btn" href="/">Continue to ${t}</a></p>
<h2>iPhone and iPad</h2>
<ol><li>Open this page in Safari and tap <b>iPhone / iPad profile</b>, then <b>Allow</b>.</li>
<li>Settings, <b>Profile Downloaded</b>, <b>Install</b>.</li>
<li>Settings, General, About, <b>Certificate Trust Settings</b>: turn on full trust for the pi-outpost certificate.</li></ol>
<h2>macOS</h2>
<ol><li>Download <b>ca.crt</b> and open it: Keychain Access adds it to the login keychain.</li>
<li>Double-click the certificate, open <b>Trust</b>, set <b>When using this certificate</b> to <b>Always Trust</b>.</li></ol>
<h2>Windows</h2>
<ol><li>Download <b>ca.crt</b> and open it, then <b>Install Certificate</b>.</li>
<li>Choose <b>Current User</b>, <b>Place all certificates in the following store</b>, <b>Trusted Root Certification Authorities</b>.</li></ol>
<h2>Android</h2>
<ol><li>Download <b>ca.crt</b>.</li>
<li>Settings, Security, Encryption &amp; credentials, <b>Install a certificate</b>, <b>CA certificate</b>, then pick the file.</li></ol>
<h2>Linux (Chrome, Firefox)</h2>
<p>Import <b>ca.crt</b> under the browser's certificate settings, Authorities, and trust it for websites.</p>
<p>Before the certificate is installed, the browser shows one warning when it opens this page. That cannot be avoided: it is why the fingerprint above is there to compare.</p>
</body></html>
`;
}
