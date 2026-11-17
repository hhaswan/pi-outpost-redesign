#!/usr/bin/env node
/**
 * Built app over HTTPS with a throwaway local CA (`pi-outpost tls init`), in a real browser:
 * /ca without signing in, sign-in with the token, reload keeps the session, Settings shows
 * the certificate and pairs a second browser by QR link, Sign out all devices drops every
 * browser, a reused pairing code is refused, plain http:// redirects to https://. Phone and
 * desktop widths, then monkey passes: double submit, code reuse, rapid sign-out/sign-in.
 *
 * Then the same server without TLS, as the live deployment runs before its HTTPS cutover
 * (`allowInsecureHttp`, opened by LAN address so the page is an insecure context): token
 * sign-in sets a non-Secure `pi-outpost-session` cookie, reload keeps it, Settings says
 * "Not encrypted", QR pairing over http signs in a second browser, sign-out signs out.
 *
 * Chromium trusts only this server's key (--ignore-certificate-errors-spki-list), never
 * every certificate. Everything lives in a temporary directory; nothing touches ~/.config.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey, X509Certificate } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { freePort, makeWorkspace, startServer } from '../server/test/harness.mjs';
import { leaveStartScreen } from './leave-start-screen.mjs';

const entry = path.resolve('cli/dist/pi-outpost.mjs');
const token = 'https-login-probe-token-0123456789abcdef';
const root = await makeWorkspace({ 'README.md': '# probe\n' });
const xdg = path.join(root, '.config');
const port = await freePort();
const configFile = path.join(root, 'tls-init.json');
fs.writeFileSync(configFile, JSON.stringify({ cwd: root, sandbox: false, server: { host: '127.0.0.1', port, token } }), { mode: 0o600 });
const cliEnv = { ...process.env, XDG_CONFIG_HOME: xdg, PI_OFFLINE: '1' };
delete cliEnv.PI_OUTPOST_TOKEN;
execFileSync(process.execPath, [entry, 'tls', 'init', '--config', configFile], { env: cliEnv, stdio: 'pipe' });
const tls = JSON.parse(fs.readFileSync(configFile, 'utf8')).server.tls;
assert.ok(tls?.caFile && !JSON.stringify(tls).includes('ca.key'));
const ca = fs.readFileSync(tls.caFile);
const fingerprint = new X509Certificate(ca).fingerprint256;
// Trust exactly this server key: the SPKI pin of server.crt.
const spki = createHash('sha256').update(createPublicKey(fs.readFileSync(tls.certFile)).export({ type: 'spki', format: 'der' })).digest('base64');

const server = await startServer(root, { sandbox: false, noExtensions: true, server: { host: '127.0.0.1', port, token, tls } }, { entry, ca, env: { PI_OFFLINE: '1', ANTHROPIC_API_KEY: 'x' } });
const base = server.base;
assert.ok(base.startsWith('https://'));
const sessionsFile = path.join(xdg, 'pi-outpost', 'sessions.json');
const stored = () => (fs.existsSync(sessionsFile) ? JSON.parse(fs.readFileSync(sessionsFile, 'utf8')).sessions : []);

const browser = await chromium.launch({ headless: true, args: [`--ignore-certificate-errors-spki-list=${spki}`], ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const pageErrors = [];
let plainServer;
const signIn = (page) => page.getByTestId('sign-in');
async function openSettings(page) {
  const more = page.getByRole('button', { name: 'More controls', exact: true });
  if (await more.isVisible()) await more.click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByTestId('security-settings').waitFor();
}
async function signInWithToken(page) {
  await page.getByLabel('Access token', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await signIn(page).waitFor({ state: 'detached', timeout: 30000 });
}
async function newPage(width) {
  const context = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 900 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(`${width}: ${error.message}`));
  return { context, page };
}

try {
  for (const width of [390, 1280]) {
    if (fs.existsSync(sessionsFile)) fs.rmSync(sessionsFile);
    const { context: contextA, page: a } = await newPage(width);

    // /ca is public and shows the fingerprint of the served certificate.
    await a.goto(`${base}/ca`);
    assert.equal((await a.getByTestId('ca-fingerprint').textContent()).trim(), fingerprint);
    assert.equal(await a.locator('script').count(), 0);

    // The sign-in screen links to /ca. Monkey: double click and Enter spend one attempt.
    await a.goto(base);
    await signIn(a).waitFor({ timeout: 30000 });
    assert.equal(await a.getByRole('link', { name: "Install this server's certificate" }).getAttribute('href'), '/ca');
    let logins = 0;
    a.on('request', (request) => { if (new URL(request.url()).pathname === '/api/login') logins++; });
    await a.getByLabel('Access token', { exact: true }).fill(token);
    await a.getByRole('button', { name: 'Connect', exact: true }).dblclick();
    await a.keyboard.press('Enter').catch(() => {});
    await signIn(a).waitFor({ state: 'detached', timeout: 30000 });
    assert.equal(logins, 1, `double submit sent ${logins} logins`);
    await leaveStartScreen(a);
    const cookies = await contextA.cookies();
    const cookie = cookies.find((entry) => entry.name === '__Host-pi-outpost-session');
    assert.ok(cookie && cookie.httpOnly && cookie.secure && cookie.sameSite === 'Strict' && cookie.path === '/', JSON.stringify(cookie));
    assert.equal(await a.evaluate(() => JSON.stringify(localStorage)).then((text) => text.includes(token)), false, 'no token in localStorage');
    assert.equal(stored().length, 1);

    // Reload keeps the session.
    await a.reload();
    await a.getByRole('region', { name: 'Activity', exact: true }).or(a.getByTestId('start-screen')).first().waitFor({ timeout: 30000 });
    assert.equal(await signIn(a).count(), 0, 'reload asked to sign in again');

    // Settings: the CA fingerprint and QR of /ca, then a pairing QR for another browser.
    if (await a.getByTestId('start-screen').count()) await leaveStartScreen(a);
    await openSettings(a);
    await a.getByText('Server certificate', { exact: true }).click();
    assert.equal((await a.getByTestId('security-settings').getByTestId('ca-fingerprint').textContent()).trim(), fingerprint);
    assert.equal(await a.getByRole('img', { name: 'QR code of the certificate install page' }).getAttribute('data-qr-text'), `${base}/ca`);
    await a.getByRole('button', { name: 'Create code', exact: true }).click();
    const qr = a.getByRole('img', { name: 'QR code to pair a device' });
    await qr.waitFor();
    const pairUrl = await qr.getAttribute('data-qr-text');
    const code = pairUrl.split('#')[1];
    assert.match(pairUrl, new RegExp(`^${base.replace(/[.]/g, '\\.')}/pair#[0-9A-Z]{5}-[0-9A-Z]{5}$`));
    assert.ok((await a.getByTestId('pairing-code').textContent()).includes(code));
    if (width < 768) assert.ok(await a.evaluate(() => document.body.scrollWidth <= innerWidth), 'phone overflow with Settings open');

    // The QR link signs in a second browser; the code never reaches a request line.
    const { context: contextB, page: b } = await newPage(width);
    const requested = [];
    b.on('request', (request) => requested.push(request.url(), request.headers().referer ?? ''));
    await b.goto(pairUrl);
    await b.getByTestId('start-screen').or(b.getByRole('region', { name: 'Activity', exact: true })).first().waitFor({ timeout: 30000 });
    assert.equal(await signIn(b).count(), 0);
    assert.equal(new URL(b.url()).pathname, '/');
    assert.equal(new URL(b.url()).hash, '');
    assert.ok(!requested.some((url) => url.includes(code)), 'the code left the fragment');
    assert.equal(stored().filter((entry) => entry.via === 'pair').length, 1);

    // Monkey: the same code again from a third browser is refused.
    const { context: contextC, page: c } = await newPage(width);
    await c.goto(pairUrl);
    await signIn(c).waitFor({ timeout: 30000 });
    await c.getByRole('alert').filter({ hasText: 'wrong, used or expired' }).waitFor();
    await contextC.close();

    // Sign out all devices from B kicks A without a reload.
    await leaveStartScreen(b);
    await openSettings(b);
    await b.getByRole('button', { name: 'Sign out all devices', exact: true }).click();
    await signIn(b).waitFor({ timeout: 15000 });
    await signIn(a).waitFor({ timeout: 15000 });
    assert.equal(stored().length, 0);
    await contextB.close();

    // Monkey: rapid sign-in / sign-out on A ends signed in with one session.
    for (let round = 0; round < 3; round++) {
      await signInWithToken(a);
      if (await a.getByTestId('start-screen').count()) await leaveStartScreen(a);
      await openSettings(a);
      await a.getByRole('button', { name: 'Sign out', exact: true }).click();
      await signIn(a).waitFor({ timeout: 15000 });
    }
    await signInWithToken(a);
    assert.equal(stored().length, 1, `sessions after the burst: ${stored().length}`);
    assert.equal(await a.evaluate(() => fetch('/api/session').then((response) => response.status)), 200);

    // Plain http:// on the same port lands on https:// at the root, without the query.
    await a.goto(`http://127.0.0.1:${port}/files/raw?path=README.md&token=leak`);
    assert.equal(a.url(), `${base}/`);
    // Monkey: the cookie disappears under an open tab; the next load asks to sign in, not a blank page.
    await contextA.clearCookies();
    await a.reload();
    await signIn(a).waitFor({ timeout: 15000 });
    await contextA.close();
    console.log(`PASS https sign-in at ${width}px`);
  }
  assert.ok(!server.log().includes('leak'), 'the redirected query reached the log');
  assert.deepEqual(pageErrors, []);
  console.log('PASS HttpsSessionLogin: /ca public, token sign-in, reload, QR pairing, sign out all, code reuse refused, http redirect, monkey bursts');
  await plainHttpPass();
} catch (error) {
  console.error(server.log().split('\n').slice(-20).join('\n'));
  if (plainServer) console.error(plainServer.log().split('\n').slice(-20).join('\n'));
  throw error;
} finally {
  await browser.close();
  await server.stop();
  await plainServer?.stop();
}

/** PlainHttpSessionUntilCutover: no TLS, LAN address, a real login form and cookie. */
async function plainHttpPass() {
  const lan = Object.values(os.networkInterfaces()).flat().find((entry) => entry.family === 'IPv4' && !entry.internal)?.address;
  assert.ok(lan, 'a non-loopback IPv4 address for the insecure-context pass');
  const plainRoot = await makeWorkspace({ 'README.md': '# plain\n' });
  const plainPort = await freePort();
  plainServer = await startServer(plainRoot, { sandbox: false, noExtensions: true, server: { host: '0.0.0.0', port: plainPort, token, allowInsecureHttp: true, allowedOrigins: [`http://${lan}:${plainPort}`] } }, { entry, env: { PI_OFFLINE: '1', ANTHROPIC_API_KEY: 'x' } });
  assert.equal(plainServer.log().match(/sessions travel unencrypted/g)?.length, 1, 'one startup warning');
  const plainBase = `http://${lan}:${plainPort}`;
  const plainSessions = path.join(plainServer.configDir, 'sessions.json');
  const plainStored = () => (fs.existsSync(plainSessions) ? JSON.parse(fs.readFileSync(plainSessions, 'utf8')).sessions : []);
  for (const width of [390, 1280]) {
    if (fs.existsSync(plainSessions)) fs.rmSync(plainSessions);
    const { context: contextA, page: a } = await newPage(width);
    await a.goto(plainBase);
    assert.equal(await a.evaluate(() => window.isSecureContext), false, 'must reproduce insecure plain HTTP');
    await signIn(a).waitFor({ timeout: 30000 });
    // Monkey: double click plus Enter is still one login.
    let logins = 0;
    a.on('request', (request) => { if (new URL(request.url()).pathname === '/api/login') logins++; });
    await a.getByLabel('Access token', { exact: true }).fill(token);
    await a.getByRole('button', { name: 'Connect', exact: true }).dblclick();
    await a.keyboard.press('Enter').catch(() => {});
    await signIn(a).waitFor({ state: 'detached', timeout: 30000 });
    assert.equal(logins, 1, `double submit sent ${logins} logins`);
    const cookies = await contextA.cookies();
    assert.equal(cookies.find((entry) => entry.name.startsWith('__Host-')), undefined);
    const cookie = cookies.find((entry) => entry.name === 'pi-outpost-session');
    assert.ok(cookie && cookie.httpOnly && !cookie.secure && cookie.sameSite === 'Strict' && cookie.path === '/', JSON.stringify(cookies));
    assert.equal(plainStored().length, 1);
    if (await a.getByTestId('start-screen').count()) await leaveStartScreen(a);

    await a.reload();
    await a.getByRole('region', { name: 'Activity', exact: true }).or(a.getByTestId('start-screen')).first().waitFor({ timeout: 30000 });
    assert.equal(await signIn(a).count(), 0, 'reload over http asked to sign in again');
    if (await a.getByTestId('start-screen').count()) await leaveStartScreen(a);

    await openSettings(a);
    assert.equal((await a.getByTestId('plain-http-notice').textContent()).trim(), 'Not encrypted — set up HTTPS (docs)');
    await a.getByRole('button', { name: 'Create code', exact: true }).click();
    const pairUrl = await a.getByRole('img', { name: 'QR code to pair a device' }).getAttribute('data-qr-text');
    assert.match(pairUrl, new RegExp(`^${plainBase.replace(/[.]/g, '\\.')}/pair#[0-9A-Z]{5}-[0-9A-Z]{5}$`));
    if (width < 768) assert.ok(await a.evaluate(() => document.body.scrollWidth <= innerWidth), 'phone overflow with Settings open');

    const { context: contextB, page: b } = await newPage(width);
    await b.goto(pairUrl);
    await b.getByTestId('start-screen').or(b.getByRole('region', { name: 'Activity', exact: true })).first().waitFor({ timeout: 30000 });
    assert.equal(await signIn(b).count(), 0, 'QR pairing over http did not sign in');
    assert.equal((await contextB.cookies()).find((entry) => entry.name === 'pi-outpost-session')?.secure, false);
    assert.equal(plainStored().length, 2);

    // Sign out A: signed out, after a reload too; B stays in.
    await a.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signIn(a).waitFor({ timeout: 15000 });
    assert.equal((await contextA.cookies()).find((entry) => entry.name === 'pi-outpost-session'), undefined, 'logout cleared the cookie');
    await a.reload();
    await signIn(a).waitFor({ timeout: 15000 });
    assert.equal(await b.evaluate(() => fetch('/api/session').then((response) => response.status)), 200);
    assert.equal(plainStored().length, 1);

    // Monkey: rapid sign-in / sign-out ends signed in with B plus one session for A.
    for (let round = 0; round < 3; round++) {
      await signInWithToken(a);
      if (await a.getByTestId('start-screen').count()) await leaveStartScreen(a);
      await openSettings(a);
      await a.getByRole('button', { name: 'Sign out', exact: true }).click();
      await signIn(a).waitFor({ timeout: 15000 });
    }
    await signInWithToken(a);
    assert.equal(plainStored().length, 2, `sessions after the burst: ${plainStored().length}`);
    await contextA.close();
    await contextB.close();
    console.log(`PASS plain-http sign-in at ${width}px`);
  }
  assert.deepEqual(pageErrors, []);
  console.log('PASS PlainHttpSessionUntilCutover: LAN http login form, non-Secure cookie, reload, Not encrypted notice, QR pairing over http, sign out, monkey bursts');
}
