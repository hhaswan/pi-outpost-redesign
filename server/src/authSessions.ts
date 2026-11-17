/**
 * Browser sign-in sessions and pairing codes.
 *
 * A session is a random cookie value; only its SHA-256 is stored, in
 * `<userConfigDir>/sessions.json` (0600, written atomically). The file is re-read when
 * it changes on disk, so `pi-outpost sessions revoke-all` reaches a running server.
 * Pairing codes live in memory only: a restart, a revoke-all and a rotation drop them.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SESSION_COOKIE = "__Host-pi-outpost-session";
/** The cookie on a server without TLS: browsers drop `Secure` (and so `__Host-`) cookies on http. */
export const PLAIN_SESSION_COOKIE = "pi-outpost-session";
export const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
/** A request renews a session once a day at most. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
export const PAIRING_TTL_MS = 2 * 60 * 1000;
const MAX_PAIRING_CODES = 3;
/** Crockford base32: no I, L, O, U. */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface StoredSession {
  id: string;
  created: number;
  lastUsed: number;
  expires: number;
  label: string;
  via: "token" | "pair";
}

interface StoreFile {
  version: 1;
  /** Set by revoke-all: a running server drops its pairing codes when it sees a new value. */
  revokedAt?: number;
  sessions: StoredSession[];
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** `secure`: the server has TLS. Without it the cookie loses `Secure` and the `__Host-` prefix, nothing else. */
export function sessionCookie(value: string, secure: boolean, maxAgeSeconds = SESSION_LIFETIME_MS / 1000): string {
  return secure
    ? `${SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Strict`
    : `${PLAIN_SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; SameSite=Strict`;
}

/** Either name, `__Host-` first: a browser keeps its http-era cookie across the HTTPS cutover. */
export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const found = new Map<string, string>();
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if ((name === SESSION_COOKIE || name === PLAIN_SESSION_COOKIE) && !found.has(name)) found.set(name, rest.join("="));
  }
  return found.get(SESSION_COOKIE) || found.get(PLAIN_SESSION_COOKIE) || undefined;
}

/** `XXXXX-XXXXX` with case, dashes, spaces and look-alikes (I/L -> 1, O -> 0) forgiven. */
export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
}

export class SessionStore {
  private sessions = new Map<string, StoredSession>();
  private mtimeMs = -1;
  private revokedAt: number | undefined;
  private pairing = new Map<string, number>();

  constructor(
    readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.reloadIfChanged();
  }

  /** Re-read the file when another process changed it. Returns whether it did. */
  reloadIfChanged(): boolean {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(this.file).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    if (mtimeMs === this.mtimeMs) return false;
    this.mtimeMs = mtimeMs;
    let parsed: StoreFile | undefined;
    try {
      parsed = mtimeMs === 0 ? undefined : (JSON.parse(fs.readFileSync(this.file, "utf8")) as StoreFile);
    } catch {
      parsed = undefined;
    }
    this.sessions = new Map((parsed?.sessions ?? []).filter((s) => typeof s?.id === "string").map((s) => [s.id, s]));
    if (parsed?.revokedAt !== undefined && parsed.revokedAt !== this.revokedAt) this.pairing.clear();
    this.revokedAt = parsed?.revokedAt;
    return true;
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const body: StoreFile = { version: 1, ...(this.revokedAt !== undefined ? { revokedAt: this.revokedAt } : {}), sessions: [...this.sessions.values()] };
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temp, this.file);
    this.mtimeMs = fs.statSync(this.file).mtimeMs;
  }

  /** A new session; the returned cookie value is never stored. */
  create(label: string, via: StoredSession["via"]): string {
    this.reloadIfChanged();
    const value = randomBytes(32).toString("base64url");
    const now = this.now();
    this.sessions.set(sha256(value), { id: sha256(value), created: now, lastUsed: now, expires: now + SESSION_LIFETIME_MS, label: label.slice(0, 80), via });
    this.save();
    return value;
  }

  /**
   * The session a cookie value names, when valid. More than a day after its last extension
   * the expiry moves to 14 days from now and `renewed` says the cookie should be re-sent.
   */
  check(value: string | undefined): { id: string; renewed: boolean } | undefined {
    if (!value) return undefined;
    this.reloadIfChanged();
    const id = sha256(value);
    const session = this.sessions.get(id);
    const now = this.now();
    if (!session || session.expires <= now) return undefined;
    const renewed = session.expires - now < SESSION_LIFETIME_MS - RENEW_AFTER_MS;
    if (renewed) {
      session.expires = now + SESSION_LIFETIME_MS;
      session.lastUsed = now;
      this.save();
    }
    return { id, renewed };
  }

  /** Whether a session id (not a cookie value) is still valid: the WebSocket sweep's question. */
  valid(id: string): boolean {
    const session = this.sessions.get(id);
    return session !== undefined && session.expires > this.now();
  }

  remove(id: string): void {
    this.reloadIfChanged();
    if (this.sessions.delete(id)) this.save();
  }

  /** Every session except `keep`, and every pairing code. */
  removeAll(keep?: string): void {
    this.reloadIfChanged();
    for (const id of this.sessions.keys()) if (id !== keep) this.sessions.delete(id);
    this.pairing.clear();
    this.revokedAt = this.now();
    this.save();
  }

  count(): number {
    const now = this.now();
    return [...this.sessions.values()].filter((s) => s.expires > now).length;
  }

  /** A single-use pairing code valid for two minutes, as `XXXXX-XXXXX`. */
  createPairingCode(): { code: string; expiresAt: number } {
    const bytes = randomBytes(10);
    const code = [...bytes].map((byte) => CROCKFORD[byte & 31]).join("");
    const expiresAt = this.now() + PAIRING_TTL_MS;
    this.pairing.set(sha256(code), expiresAt);
    while (this.pairing.size > MAX_PAIRING_CODES) this.pairing.delete(this.pairing.keys().next().value!);
    return { code: `${code.slice(0, 5)}-${code.slice(5)}`, expiresAt };
  }

  /** Consume a pairing code: true once, for a code that has not expired. */
  redeemPairingCode(input: string): boolean {
    const key = sha256(normalizePairingCode(input));
    const expiresAt = this.pairing.get(key);
    this.pairing.delete(key);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  clearPairingCodes(): void {
    this.pairing.clear();
  }
}
