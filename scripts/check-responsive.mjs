/**
 * Built-app responsive gate: the real bundle (cli/dist) in a real browser at phone,
 * tablet and desktop widths.
 *
 * At each width, for each surface it can open (the chat, the Work Plan, the sessions
 * sidebar), it checks that:
 * - the document does not scroll horizontally;
 * - no visible interactive control extends beyond the viewport;
 * - the element at each visible button's centre is that button (nothing covers it);
 * - no page error was thrown.
 * On phone widths it also measures hit areas below 44x44 px. That list is printed
 * only, unless `--strict-touch` is given: later phases of responsive-mobile-layout
 * make it pass.
 *
 * Usage: node scripts/check-responsive.mjs [--report] [--strict-touch] [--width=360,...]
 *   --report        print every violation and exit 0 (a broken fixture still exits 1)
 *   --strict-touch  count small phone hit areas as violations
 *
 * Isolation: a throwaway workspace and agent dir, no extensions, offline, and private
 * bridge, handoff and reservation registries, so a CLI on this machine never sees the
 * probe's server and the probe never sees a real one.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { makeWorkspace, startServer } from '../server/test/harness.mjs';

const args = process.argv.slice(2);
const reportOnly = args.includes('--report');
const strictTouch = args.includes('--strict-touch');
const widthArg = args.find((a) => a.startsWith('--width='));
const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
].filter((v) => !widthArg || widthArg.slice('--width='.length).split(',').map(Number).includes(v.width));
const PHONE_MAX = 767;
const MIN_TARGET = 44;

const root = await makeWorkspace({ 'README.md': '# Responsive fixture\n' });
const agentDir = path.join(root, '.pi-agent');
const registries = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-outpost-responsive-'));
const env = {
  PI_OFFLINE: '1',
  ANTHROPIC_API_KEY: 'x',
  PI_OUTPOST_BRIDGE_DIR: path.join(registries, 'bridges'),
  PI_OUTPOST_HANDOFF_DIR: path.join(registries, 'handoffs'),
  PI_OUTPOST_RESERVATION_DIR: path.join(registries, 'reservations'),
};
// Owner-only, as the stores require; the handoff and reservation stores create their own.
await fs.mkdir(env.PI_OUTPOST_BRIDGE_DIR, { mode: 0o700 });

// The fixture: a long user message with an unbroken token, a reply with a wide code
// block, and a Work Plan — the content that has pushed a narrow layout wide before.
const SESSION_TITLE = 'Responsive fixture';
const m = SessionManager.create(root, path.join(agentDir, 'sessions'));
const longWord = 'https://example.com/' + 'a-very-long-path-segment-without-spaces'.repeat(8);
m.appendMessage({ role: 'user', content: [{ type: 'text', text: `${'Please review the layout on a small phone screen. '.repeat(12)}\n\n${longWord}` }] });
m.appendSessionInfo(SESSION_TITLE);
m.appendMessage({
  role: 'assistant', api: 'anthropic-messages', provider: 'anthropic', model: 'claude-sonnet-4-6', timestamp: Date.now(), stopReason: 'stop',
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  content: [{ type: 'text', text: 'Run this:\n\n```sh\nDOTENV_FILE=/very/long/path/to/an/environment/file/that/never/wraps.env ./.cicd/migrate.sh version --verbose --dry-run\n```\n\nThen check the output.' }],
});
await fs.writeFile(m.getSessionFile() + '.work-plan.json', JSON.stringify({
  version: 1, id: 'p', title: 'Responsive plan', updatedAt: new Date().toISOString(),
  tasks: Array.from({ length: 6 }, (_, i) => ({ id: 't' + i, title: `Task ${i} with a reasonably long title`, status: i < 3 ? 'done' : 'todo' })),
}));

/** Runs in the page: every violation on the current screen. */
function inspect({ phone, minTarget, surface }) {
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const out = { overflow: null, offscreen: [], covered: [], small: [], behindSurface: 0 };
  // The surface the probe opened (a drawer, a dropdown): controls under it are meant
  // to be covered by it. Its nearest positioned ancestor is the layer that floats.
  let layer = surface ? document.querySelector(surface) : null;
  while (layer && !/^(absolute|fixed)$/.test(getComputedStyle(layer).position)) layer = layer.parentElement;
  const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  if (sw > vw + 1) out.overflow = `document ${sw}px wide in a ${vw}px viewport`;

  const describe = (el) => {
    const name = el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) || el.getAttribute('placeholder') || '';
    return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''} "${name}"`;
  };
  const shown = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  };
  // The part of the element its scrolling ancestors leave visible. The document
  // itself is not a clip here: a control pushed past the viewport edge is the defect.
  const clipped = (el) => {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed') break;
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowX + cs.overflowY)) {
        const c = n.getBoundingClientRect();
        if (cs.overflowX !== 'visible') { left = Math.max(left, c.left); right = Math.min(right, c.right); }
        if (cs.overflowY !== 'visible') { top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom); }
      }
    }
    return { left, top, right, bottom, width: right - left, height: bottom - top, full: r };
  };
  const controls = document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=menuitem], [role=treeitem], [tabindex]:not([tabindex="-1"])');
  for (const el of controls) {
    if (el.closest('[inert],[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4) continue; // visually hidden (sr-only, file inputs)
    if (!shown(el)) continue;
    const c = clipped(el);
    if (c.width <= 0.5 || c.height <= 0.5) continue; // scrolled out of its container
    const label = describe(el);
    if (c.left < -0.5 || c.top < -0.5 || c.right > vw + 0.5 || c.bottom > vh + 0.5) {
      out.offscreen.push(`${label} at x=${Math.round(c.left)}..${Math.round(c.right)} y=${Math.round(c.top)}..${Math.round(c.bottom)}`);
      continue;
    }
    const isButton = el.matches('button, [role=button]');
    if (isButton && getComputedStyle(el).pointerEvents !== 'none') {
      const x = c.left + c.width / 2;
      const y = c.top + c.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && layer && layer.contains(hit) && !layer.contains(el)) out.behindSurface += 1;
      else if (hit && hit !== el && !el.contains(hit)) out.covered.push(`${label} covered by ${describe(hit)} at (${Math.round(x)},${Math.round(y)})`);
    }
    if (phone && isButton && (r.width < minTarget - 0.5 || r.height < minTarget - 0.5)) {
      out.small.push(`${label} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return out;
}

const server = await startServer(root, { sandbox: false, noExtensions: true }, { entry: path.resolve('cli/dist/pi-outpost.mjs'), env });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const results = [];
let failed = false;
try {
  for (const viewport of VIEWPORTS) {
    const phone = viewport.width <= PHONE_MAX;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: phone, isMobile: false });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Select the session where the sidebar control is known to exist, then load the
    // page fresh at the width under test: the tab restores its session on reload.
    await page.goto(server.base);
    await page.getByRole('button', { name: 'sessions', exact: true }).click();
    await page.getByText(SESSION_TITLE, { exact: true }).click();
    await page.getByText('Then check the output.').waitFor();
    await page.setViewportSize(viewport);
    await page.reload();
    await page.getByText('Then check the output.').waitFor();
    await page.waitForTimeout(400);

    const check = async (name, surface = null) => {
      const found = await page.evaluate(inspect, { phone, minTarget: MIN_TARGET, surface });
      results.push({ width: viewport.width, surface: name, ...found, errors: [...errors] });
      errors.length = 0;
    };
    await check('chat');

    // Work Plan: the opposite of its default state at this width, then back.
    const openPlan = page.getByRole('button', { name: 'Open Work Plan' });
    if (await openPlan.isVisible()) {
      await openPlan.click();
      await page.getByRole('complementary', { name: 'Work Plan' }).waitFor();
      await check('plan open', 'aside[aria-label="Work Plan"]');
      await page.getByRole('button', { name: 'Close Work Plan' }).click();
    } else if (await page.getByRole('complementary', { name: 'Work Plan' }).isVisible()) {
      await page.getByRole('button', { name: 'Close Work Plan' }).click();
      await check('plan closed');
      await page.getByRole('button', { name: 'Open Work Plan' }).click();
    }

    const sessions = page.getByRole('button', { name: 'sessions', exact: true });
    if (await sessions.isVisible()) {
      await sessions.click();
      await page.waitForTimeout(300);
      await check('sessions', 'input[aria-label="Search sessions"]');
      await sessions.click({ force: true }).catch(() => {});
    }
    if (viewport === VIEWPORTS[VIEWPORTS.length - 1]) {
      // The inspector must still see what it exists to see: a wide element, a control
      // past the edge, and a control under another. A gate that went blind passes.
      await page.evaluate(() => {
        const add = (html) => { const d = document.createElement('div'); d.innerHTML = html; document.body.append(d.firstElementChild); };
        add('<div data-probe style="position:absolute;top:0;left:0;width:4000px;height:1px"></div>');
        add('<button data-probe style="position:fixed;top:10px;left:calc(100vw - 20px);width:60px;height:44px">past edge</button>');
        add('<button data-probe style="position:fixed;top:200px;left:10px;width:60px;height:44px">under</button>');
        add('<div data-probe style="position:fixed;top:190px;left:0;width:100px;height:80px;z-index:9999;background:red">cover</div>');
      });
      const seen = await page.evaluate(inspect, { phone: true, minTarget: MIN_TARGET, surface: null });
      await page.evaluate(() => document.querySelectorAll('[data-probe]').forEach((n) => n.remove()));
      const blind = [
        !seen.overflow && 'overflow',
        !seen.offscreen.some((v) => v.includes('past edge')) && 'offscreen',
        !seen.covered.some((v) => v.includes('"under"')) && 'covered',
      ].filter(Boolean);
      if (blind.length) throw new Error(`check-responsive self-test: inspector missed ${blind.join(', ')}`);
      console.log('PASS self-test: inspector flags overflow, offscreen and covered controls');
    }
    await context.close();
  }
} catch (error) {
  console.error(server.log().split('\n').slice(-15).join('\n'));
  throw error;
} finally {
  await browser.close();
  await server.stop();
  await fs.rm(registries, { recursive: true, force: true });
  await fs.rm(root, { recursive: true, force: true });
}

for (const r of results) {
  const violations = [
    ...(r.overflow ? [`overflow: ${r.overflow}`] : []),
    ...r.offscreen.map((v) => `offscreen: ${v}`),
    ...r.covered.map((v) => `covered: ${v}`),
    ...r.errors.map((v) => `page error: ${v}`),
    ...(strictTouch ? r.small.map((v) => `hit area: ${v}`) : []),
  ];
  if (violations.length) failed = true;
  const behind = r.behindSurface ? ` (${r.behindSurface} controls under the open surface, expected)` : '';
  console.log(`${violations.length ? 'FAIL' : 'PASS'} ${r.width}px ${r.surface}${violations.length ? '' : ': no overflow, offscreen or covered controls'}${behind}`);
  for (const v of violations) console.log(`  ${v}`);
  if (!strictTouch && r.small.length) {
    console.log(`  report-only, hit areas below ${MIN_TARGET}px (${r.small.length}):`);
    for (const v of r.small) console.log(`    ${v}`);
  }
}
if (failed && !reportOnly) {
  console.error('check-responsive: violations found (use --report to list without failing)');
  process.exit(1);
}
