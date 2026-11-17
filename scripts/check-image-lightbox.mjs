/**
 * Built-app image lightbox probe (responsive-mobile-layout 4b): the real bundle
 * (cli/dist) in a real browser.
 *
 * Desktop 1280x800: a conversation with two attached images; click opens a modal
 * viewer, the wheel zooms the image, ArrowRight shows the second one with the zoom
 * reset, Escape closes and focus returns to the first image. A workspace PNG opened in
 * the file viewer opens the viewer too. A `read` tool result carrying an image shows it as a
 * thumbnail in the tool card, which opens the same viewer.
 * Phone 390x844 (touch): no document overflow, 44 px close control, a double tap zooms,
 * swipe down and the close button close.
 * Monkey pass: rapid open/close, double-click spam, a session switch under an open
 * viewer (it must close, no stale image), and no page errors anywhere.
 *
 * Isolation: throwaway workspace and agent dir, no extensions, offline, private
 * bridge registry.
 *
 * Usage: node scripts/check-image-lightbox.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { makeWorkspace, startServer } from '../server/test/harness.mjs';
import { leaveStartScreen } from './leave-start-screen.mjs';

/** A valid RGB PNG of the given size, painted by `paint(x, y) -> [r, g, b]`. */
function png(width, height, paint) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x++) raw.set(paint(x, y), row + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const red = png(480, 320, (x, y) => [200, (x * 255) / 480, (y * 255) / 320]);
const blue = png(400, 300, (x, y) => [(y * 255) / 300, (x * 255) / 400, 220]);
const green = png(640, 400, (x, y) => [((x ^ y) & 16) ? 40 : 10, 180, 60]);

const root = await makeWorkspace({ 'shots/plan.png': green, 'README.md': '# Lightbox fixture\n' });
const agentDir = path.join(root, '.pi-agent');
const registries = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-outpost-lightbox-'));
// The registries refuse group/world-accessible directories: private, like the server creates them.
for (const dir of ['bridges']) await fs.mkdir(path.join(registries, dir), { mode: 0o700 });
const env = {
  PI_OFFLINE: '1',
  ANTHROPIC_API_KEY: 'x',
  PI_OUTPOST_BRIDGE_DIR: path.join(registries, 'bridges'),
};

const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const TITLE = 'Lightbox fixture';
const OTHER = 'Other session';
const sessions = path.join(agentDir, 'sessions');
const other = SessionManager.create(root, sessions);
other.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Nothing to see here' }] });
other.appendSessionInfo(OTHER);
other.appendMessage({ role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'claude-sonnet-4-6', timestamp: Date.now(), stopReason: 'stop', usage, content: [{ type: 'text', text: 'Plain reply.' }] });
const m = SessionManager.create(root, sessions);
m.appendMessage({
  role: 'user',
  content: [
    { type: 'text', text: 'Two screenshots attached' },
    { type: 'image', data: red.toString('base64'), mimeType: 'image/png' },
    { type: 'image', data: blue.toString('base64'), mimeType: 'image/png' },
  ],
});
m.appendSessionInfo(TITLE);
m.appendMessage({ role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'claude-sonnet-4-6', timestamp: Date.now() + 1, stopReason: 'stop', usage, content: [{ type: 'text', text: 'See [the plan](shots/plan.png) for details.' }] });
// A tool that returned an image: its card shows the picture and opens the same viewer.
const TOOL_TITLE = 'Tool image fixture';
const t = SessionManager.create(root, sessions);
t.appendMessage({ role: 'user', content: [{ type: 'text', text: 'Read the plan image' }] });
t.appendSessionInfo(TOOL_TITLE);
t.appendMessage({ role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'claude-sonnet-4-6', timestamp: Date.now() + 2, stopReason: 'toolUse', usage, content: [{ type: 'toolCall', id: 'read-plan', name: 'read', arguments: { path: 'shots/plan.png' } }] });
t.appendMessage({ role: 'toolResult', toolCallId: 'read-plan', toolName: 'read', isError: false, timestamp: Date.now() + 3, content: [{ type: 'text', text: 'Read image file [image/png]' }, { type: 'image', data: green.toString('base64'), mimeType: 'image/png' }] });
t.appendMessage({ role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'claude-sonnet-4-6', timestamp: Date.now() + 4, stopReason: 'stop', usage, content: [{ type: 'text', text: 'That is the plan.' }] });

const server = await startServer(root, { sandbox: false, noExtensions: true }, { entry: path.resolve('cli/dist/pi-outpost.mjs'), env });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });

const lightbox = (page) => page.getByTestId('image-lightbox');
const first = (page) => page.getByRole('button', { name: 'Open attached image 1' });
/** Current scale of the zoomed element, from its computed transform matrix. */
const scaleOf = (page) =>
  page.getByTestId('image-lightbox-zoom').evaluate((el) => {
    const t = getComputedStyle(el).transform;
    return t === 'none' ? 1 : new DOMMatrixReadOnly(t).a;
  });
const settle = (page) => page.waitForTimeout(450);
const focusedName = (page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

async function openSession(page, title) {
  // A phone lists sessions from the bottom navigation, in a sheet.
  const navSessions = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Sessions' });
  await page.getByRole('button', { name: 'sessions', exact: true }).or(navSessions).first().waitFor();
  if (await navSessions.isVisible()) {
    await navSessions.click();
    const sheet = page.getByTestId('phone-sessions-sheet');
    await sheet.getByText(title, { exact: true }).first().click({ timeout: 8000 });
    await sheet.waitFor({ state: 'detached' });
    return;
  }
  const entry = page.getByText(title, { exact: true });
  await page.getByRole('button', { name: 'sessions', exact: true }).waitFor();
  await page.waitForTimeout(300);
  if (!(await entry.first().isVisible())) await page.getByRole('button', { name: 'sessions', exact: true }).click();
  await entry.first().click({ timeout: 8000 }).catch(async (error) => {
    console.log((await page.evaluate(() => document.body.innerText)).slice(0, 1500));
    throw error;
  });
}

async function touch(page, cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
}

const results = [];
try {
  // ---------- desktop ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.base);
    await leaveStartScreen(page);
    await openSession(page, TITLE);
    await first(page).waitFor();
    assert.equal(await first(page).evaluate((el) => getComputedStyle(el).cursor), 'zoom-in');

    await first(page).click();
    await lightbox(page).waitFor();
    assert.equal(await lightbox(page).getAttribute('aria-modal'), 'true');
    assert.equal(await page.getByTestId('image-lightbox-counter').textContent(), '1 / 2');
    const img = lightbox(page).locator('img');
    await img.evaluate((el) => el.decode());
    const box = await img.boundingBox();
    assert.ok(box.width >= 400, `image shown at ${box.width}px, expected its natural size or larger`);
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    // One mouse notch (deltaY 100) is one gradual step, not a jump to the maximum.
    await page.mouse.wheel(0, -100);
    await settle(page);
    const notch = await scaleOf(page);
    assert.ok(notch > 1.1 && notch < 1.5, `one wheel notch must zoom gradually, scale ${notch}`);
    await page.mouse.wheel(0, -100);
    await settle(page);
    const zoomed = await scaleOf(page);
    assert.ok(zoomed > notch + 0.1 && zoomed < 2, `a second notch must zoom a further step, scale ${zoomed}`);
    // Centred on the cursor: the image point under it stays under it.
    const after = await img.boundingBox();
    const fx = (box.x + box.width * 0.3 - after.x) / after.width;
    const fy = (box.y + box.height * 0.3 - after.y) / after.height;
    assert.ok(Math.abs(fx - 0.3) < 0.03 && Math.abs(fy - 0.3) < 0.03, `zoom not centred on the cursor: ${fx.toFixed(3)}, ${fy.toFixed(3)}`);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByTestId('image-lightbox-counter').textContent(), '2 / 2');
    assert.match(await img.getAttribute('src'), new RegExp(`^data:image/png;base64,${blue.toString('base64').slice(0, 40).replace(/[+/]/g, '\\$&')}`));
    assert.equal(await scaleOf(page), 1, 'zoom resets on image change');
    await page.keyboard.press('+');
    await settle(page);
    assert.ok((await scaleOf(page)) > 1, '+ zooms in');
    await page.keyboard.press('0');
    await settle(page);
    assert.equal(await scaleOf(page), 1, '0 resets');
    await page.keyboard.press('Escape');
    await lightbox(page).waitFor({ state: 'detached' });
    assert.equal(await focusedName(page), 'Open attached image 1', 'focus returns to the opening image');
    results.push('desktop: open, wheel zoom, ArrowRight 2 / 2 with reset, + / 0, Escape and focus return');

    // Backdrop click closes; a click on the image does not.
    await first(page).click();
    await lightbox(page).waitFor();
    const b2 = await lightbox(page).locator('img').boundingBox();
    await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.waitForTimeout(350);
    assert.equal(await lightbox(page).count(), 1, 'a click on the image must not close');
    await page.mouse.click(20, 400);
    await lightbox(page).waitFor({ state: 'detached' });
    results.push('desktop: backdrop click closes, image click does not');

    // File viewer image.
    await page.getByRole('link', { name: 'the plan' }).click();
    const viewerTrigger = page.getByRole('button', { name: 'Open image shots/plan.png' });
    await viewerTrigger.waitFor();
    await viewerTrigger.click();
    await lightbox(page).waitFor();
    await lightbox(page).locator('img').evaluate((el) => el.decode());
    assert.match(await lightbox(page).locator('img').getAttribute('src'), /plan\.png/);
    await page.getByRole('button', { name: 'Close image viewer' }).click();
    await lightbox(page).waitFor({ state: 'detached' });
    assert.equal(await focusedName(page), 'Open image shots/plan.png');
    await page.getByRole('button', { name: 'Close file viewer' }).click();
    await viewerTrigger.waitFor({ state: 'detached' });
    results.push('desktop: file viewer PNG opens the lightbox and focus returns');

    // Monkey: rapid open/close.
    for (let i = 0; i < 12; i++) {
      await first(page).click();
      await page.keyboard.press('Escape');
    }
    assert.equal(await lightbox(page).count(), 0, 'rapid open/close leaves no viewer');
    // Double-click spam on the image and on the controls.
    await first(page).click();
    await lightbox(page).waitFor();
    const b3 = await lightbox(page).locator('img').boundingBox();
    for (let i = 0; i < 6; i++) await page.mouse.dblclick(b3.x + b3.width / 2, b3.y + b3.height / 2);
    await page.getByRole('button', { name: 'Zoom in' }).dblclick();
    await page.getByRole('button', { name: 'Next image' }).dblclick();
    await settle(page);
    assert.equal(await lightbox(page).count(), 1, 'double-click spam must not close');
    assert.match(await page.getByTestId('image-lightbox-counter').textContent(), /^[12] \/ 2$/);
    // Session switch under an open viewer (driven past the modal, as a remote switch would be).
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'sessions')?.click());
    await page.evaluate((title) => {
      const el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent === title);
      el?.click();
    }, OTHER);
    await page.getByText('Plain reply.').waitFor();
    await lightbox(page).waitFor({ state: 'detached' });
    assert.equal(await page.locator('img[src^="data:image/png"]').count(), 0, 'no stale image after the switch');
    assert.equal(await page.evaluate(() => document.body.style.overflow), '', 'scroll lock released');
    assert.deepEqual(errors, [], 'page errors');
    results.push('desktop monkey: rapid open/close, dblclick spam, session switch closes the viewer, no errors');

    // Tool result image: thumbnail in the tool card (inside the Process group), opens the lightbox.
    await openSession(page, TOOL_TITLE);
    await page.getByText('That is the plan.', { exact: true }).waitFor();
    const processGroup = page.getByRole('button', { name: /Process ·/ });
    if ((await processGroup.count()) > 0 && (await processGroup.getAttribute('aria-expanded')) === 'false') await processGroup.click();
    const toolThumb = page.getByRole('button', { name: 'Open image 1 returned by read' });
    await toolThumb.waitFor();
    assert.match(await toolThumb.locator('img').getAttribute('src'), /^data:image\/png;base64,/);
    const thumbBox = await toolThumb.boundingBox();
    assert.ok(thumbBox.width >= 44 && thumbBox.height >= 44, `tool thumbnail target ${thumbBox.width}x${thumbBox.height}`);
    assert.equal(await toolThumb.evaluate((el) => getComputedStyle(el).cursor), 'zoom-in');
    assert.ok((await toolThumb.locator('img').boundingBox()).height <= 192, 'thumbnail at most max-h-48');
    await toolThumb.click();
    await lightbox(page).waitFor();
    assert.equal(await page.getByTestId('image-lightbox-counter').textContent(), 'Image 1');
    assert.equal(await lightbox(page).locator('img').getAttribute('src'), await toolThumb.locator('img').getAttribute('src'));
    await page.keyboard.press('Escape');
    await lightbox(page).waitFor({ state: 'detached' });
    assert.equal(await focusedName(page), 'Open image 1 returned by read', 'focus returns to the tool thumbnail');
    assert.deepEqual(errors, [], 'page errors');
    results.push('desktop: tool result image shows in the tool card and opens the lightbox');
    await ctx.close();
  }

  // ---------- phone ----------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.base);
    await leaveStartScreen(page);
    await openSession(page, TITLE);
    await first(page).waitFor();
    await first(page).tap();
    await lightbox(page).waitFor();
    const img = lightbox(page).locator('img');
    await img.evaluate((el) => el.decode());
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `document overflows by ${overflow}px`);
    const dialogBox = await lightbox(page).boundingBox();
    assert.ok(dialogBox.width === 390 && Math.abs(dialogBox.height - 844) <= 1, `dialog ${dialogBox.width}x${dialogBox.height}`);
    const close = await page.getByRole('button', { name: 'Close image viewer' }).boundingBox();
    assert.ok(close.width >= 44 && close.height >= 44, `close control ${close.width}x${close.height}`);
    const imgBox = await img.boundingBox();
    assert.ok(imgBox.width >= 380 && imgBox.x >= 0 && imgBox.x + imgBox.width <= 390, `image fills the width: ${JSON.stringify(imgBox)}`);

    const cx = imgBox.x + imgBox.width / 2;
    const cy = imgBox.y + imgBox.height / 2;
    for (let i = 0; i < 2; i++) {
      await touch(page, cdp, 'touchStart', [[cx, cy]]);
      await touch(page, cdp, 'touchEnd', []);
    }
    await settle(page);
    const tapped = await scaleOf(page);
    assert.ok(tapped > 1.1, `double tap must zoom, scale ${tapped}`);
    assert.equal(await lightbox(page).count(), 1, 'double tap must not close');

    // Swipe left while zoomed pans instead of changing image.
    await touch(page, cdp, 'touchStart', [[cx + 100, cy]]);
    for (let s = 1; s <= 6; s++) await touch(page, cdp, 'touchMove', [[cx + 100 - s * 30, cy]]);
    await touch(page, cdp, 'touchEnd', []);
    await settle(page);
    assert.equal(await page.getByTestId('image-lightbox-counter').textContent(), '1 / 2', 'no image change while zoomed');

    await page.getByRole('button', { name: 'Reset zoom' }).tap();
    await settle(page);
    // Swipe left at rest: next image.
    await touch(page, cdp, 'touchStart', [[cx + 100, cy]]);
    for (let s = 1; s <= 6; s++) await touch(page, cdp, 'touchMove', [[cx + 100 - s * 30, cy]]);
    await touch(page, cdp, 'touchEnd', []);
    await settle(page);
    assert.equal(await page.getByTestId('image-lightbox-counter').textContent(), '2 / 2', 'swipe left shows the next image');
    // Swipe down: close.
    await touch(page, cdp, 'touchStart', [[cx, cy - 100]]);
    for (let s = 1; s <= 6; s++) await touch(page, cdp, 'touchMove', [[cx, cy - 100 + s * 35]]);
    await touch(page, cdp, 'touchEnd', []);
    await lightbox(page).waitFor({ state: 'detached' });
    results.push('phone: fills 390x844, no overflow, close 44px+, double tap zooms, swipe while zoomed pans, swipe left next, swipe down closes');

    // A synthetic swipe ends in a fling, and the browser spends the next tap stopping the
    // fling rather than clicking (as on a real phone). Let it end first.
    await page.waitForTimeout(1000);
    await first(page).tap();
    await lightbox(page).waitFor();
    await page.getByRole('button', { name: 'Close image viewer' }).tap();
    await lightbox(page).waitFor({ state: 'detached' });
    for (let i = 0; i < 8; i++) {
      await first(page).tap();
      await page.getByRole('button', { name: 'Close image viewer' }).tap();
    }
    assert.equal(await lightbox(page).count(), 0);
    assert.deepEqual(errors, [], 'page errors');
    results.push('phone: close button closes, rapid tap open/close, no errors');
    await ctx.close();
  }
  for (const line of results) console.log('PASS ' + line);
} catch (error) {
  for (const line of results) console.log('PASS ' + line);
  throw error;
} finally {
  await browser.close();
  await server.stop();
  await fs.rm(registries, { recursive: true, force: true });
}
