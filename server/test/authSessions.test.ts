import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { normalizePairingCode, PAIRING_TTL_MS, readSessionCookie, sessionCookie, SessionStore } from "../src/authSessions.ts";
import { parseCli } from "../src/cli.ts";

async function store(run: (store: SessionStore, clock: { now: number }, file: string) => Promise<void> | void) {
  const dir = await mkdtemp(path.join(tmpdir(), "outpost-sessions-"));
  const clock = { now: 1_000_000 };
  const file = path.join(dir, "sessions.json");
  try {
    await run(new SessionStore(file, () => clock.now), clock, file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("PairingCodeExpires: a code is refused once two minutes have passed", () =>
  store((sessions, clock) => {
    const { code, expiresAt } = sessions.createPairingCode();
    assert.equal(expiresAt, clock.now + PAIRING_TTL_MS);
    clock.now += PAIRING_TTL_MS + 1;
    assert.equal(sessions.redeemPairingCode(code), false);
  }));

test("PairingCodeReuseRejected: a code redeems once", () =>
  store((sessions) => {
    const { code } = sessions.createPairingCode();
    assert.equal(sessions.redeemPairingCode(code), true);
    assert.equal(sessions.redeemPairingCode(code), false);
  }));

test("pairing codes: 50 bits of Crockford base32, look-alikes forgiven, at most three outstanding", () =>
  store((sessions) => {
    const codes = Array.from({ length: 4 }, () => sessions.createPairingCode().code);
    for (const code of codes) assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    assert.equal(sessions.redeemPairingCode(codes[0]!), false, "the oldest was dropped");
    assert.equal(sessions.redeemPairingCode(` ${codes[1]!.toLowerCase()} `), true);
    assert.equal(normalizePairingCode("abcde-io0lx"), "ABCDE1001X");
  }));

test("revoke-all and rotation drop pairing codes; removeAll can keep the caller", () =>
  store((sessions) => {
    const keep = sessions.create("a", "token");
    const drop = sessions.create("b", "pair");
    const { code } = sessions.createPairingCode();
    const kept = sessions.check(keep)!;
    sessions.removeAll(kept.id);
    assert.equal(sessions.redeemPairingCode(code), false);
    assert.ok(sessions.check(keep));
    assert.equal(sessions.check(drop), undefined);
  }));

test("a CLI revoke-all seen on disk drops the running server's pairing codes", () =>
  store((running, clock, file) => {
    const { code } = running.createPairingCode();
    clock.now += 10;
    new SessionStore(file, () => clock.now + 5).removeAll();
    running.reloadIfChanged();
    assert.equal(running.redeemPairingCode(code), false);
  }));

test("sliding renewal: only after a day, to 14 days from the request", () =>
  store(async (sessions, clock, file) => {
    const day = 86_400_000;
    const cookie = sessions.create("x", "token");
    assert.equal(sessions.check(cookie)!.renewed, false);
    clock.now += 3 * day;
    assert.equal(sessions.check(cookie)!.renewed, true);
    const stored = JSON.parse(await readFile(file, "utf8")).sessions[0];
    assert.equal(stored.expires, clock.now + 14 * day);
    clock.now += 14 * day;
    assert.equal(sessions.check(cookie), undefined, "expired");
  }));

test("cookie attributes and parsing (PlainHttpSessionUntilCutover)", () => {
  assert.equal(sessionCookie("v", true), "__Host-pi-outpost-session=v; Max-Age=1209600; Path=/; HttpOnly; Secure; SameSite=Strict");
  assert.equal(sessionCookie("v", false), "pi-outpost-session=v; Max-Age=1209600; Path=/; HttpOnly; SameSite=Strict");
  assert.equal(sessionCookie("", false, 0), "pi-outpost-session=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict");
  assert.equal(readSessionCookie("a=b; __Host-pi-outpost-session=xyz; c=d"), "xyz");
  assert.equal(readSessionCookie("pi-outpost-session=xyz"), "xyz");
  assert.equal(readSessionCookie("pi-outpost-session=old; __Host-pi-outpost-session=new"), "new", "__Host- wins");
  assert.equal(readSessionCookie("x-pi-outpost-session=xyz; pi-outpost-session="), undefined);
});

test("CLI: tls, token and sessions take an action word and their own flags", () => {
  assert.deepEqual(parseCli(["tls", "init", "--ip", "10.11.3.77", "--dns", "box"]).auth, { action: "init", ips: ["10.11.3.77"], dns: ["box"], revokeSessions: false, newCa: false });
  assert.equal(parseCli(["tls", "init", "--new-ca"]).auth.newCa, true);
  assert.throws(() => parseCli(["tls", "renew", "--new-ca"]), /belongs to "pi-outpost tls init"/);
  assert.equal(parseCli(["tls", "renew"]).command, "tls");
  assert.equal(parseCli(["token", "rotate", "--revoke-sessions"]).auth.revokeSessions, true);
  assert.equal(parseCli(["sessions", "revoke-all"]).auth.action, "revoke-all");
  assert.throws(() => parseCli(["tls"]), /needs one of: init, renew/);
  assert.throws(() => parseCli(["token", "show"]), /needs one of: rotate/);
  assert.throws(() => parseCli(["--ip", "1.2.3.4"]), /belong to "pi-outpost tls"/);
  assert.throws(() => parseCli(["sessions", "revoke-all", "--revoke-sessions"]), /belongs to "pi-outpost token rotate"/);
  assert.throws(() => parseCli(["constructor"]), /unknown command/);
});
