/**
 * Built-app responsive gate: the real bundle (cli/dist) in a real browser at phone,
 * tablet and desktop widths.
 *
 * At each width, for each surface it can open, it checks that:
 * - the document does not scroll horizontally;
 * - no visible interactive control extends beyond the viewport;
 * - the element at each visible button's centre is that button (nothing covers it);
 * - no page error was thrown.
 * On phone widths the surfaces are the phone shell's: the header's overflow sheet (and
 * Settings opened inside it), Files, a file pushed over Files and back, Sessions, the
 * Work Plan and the terminal, each from the bottom navigation. At wider widths they are
 * the Work Plan and the sessions dropdown; at 1280 it also asserts the desktop header
 * is still one row with its own controls and that there is no bottom navigation.
 * At every wide width Terminal sessions is in the header, the activity strip is one slim
 * line, and on screens up to 900px tall (1133x744 is an iPad in landscape, with touch)
 * the transcript keeps at least half the viewport height.
 * On phone widths it also opens every menu in the overflow sheet (and the project
 * menu in the header), measures hit areas below 44x44 px, and flags hover-only
 * controls: a control that is transparent on a screen without hover (the phone
 * contexts emulate touch, so `(hover: none)` and `(pointer: coarse)` match) cannot be
 * found there. Small hit areas are printed only, unless `--strict-touch` is given.
 * Controls under an open sheet are neither measured nor flagged: they cannot be hit.
 * At 1280 it checks the other side of the hover gate: a session's rename control is
 * hidden until its row is hovered, as before.
 *
 * Usage: node scripts/check-responsive.mjs [--report] [--strict-touch] [--width=360,...] [--shots=dir]
 *   --report        print every violation and exit 0 (a broken fixture still exits 1)
 *   --strict-touch  count small phone hit areas as violations
 *   --shots=dir     save a screenshot of every checked screen into dir
 *
 * Isolation: a throwaway workspace and agent dir, no extensions, offline, and private
 * bridge registry, so a CLI on this machine never sees the
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
const shotsDir = args.find((a) => a.startsWith('--shots='))?.slice('--shots='.length);
if (shotsDir) await fs.mkdir(shotsDir, { recursive: true });
const VIEWPORTS = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  // iPad landscape: wide layout, coarse pointer, short screen.
  { width: 1133, height: 744, touch: true },
  { width: 1440, height: 900 },
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
};
// Owner-only, as the registry requires.
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
  const out = { overflow: null, offscreen: [], covered: [], small: [], hoverOnly: [], behindSurface: 0 };
  const noHover = window.matchMedia('(hover: none)').matches;
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
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return true;
  };
  const transparent = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (Number(getComputedStyle(n).opacity) === 0) return true;
    return false;
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
    // Inside a closed <details> only the summary is rendered.
    const closedDetails = el.closest('details:not([open])');
    if (closedDetails && !el.closest('summary')?.parentElement?.isSameNode(closedDetails)) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4) continue; // visually hidden (sr-only, file inputs)
    if (!shown(el)) continue;
    const c = clipped(el);
    if (c.width <= 0.5 || c.height <= 0.5) continue; // scrolled out of its container
    const label = describe(el);
    if (transparent(el)) {
      // Where there is no hover, a transparent control is an invisible tap target —
      // unless a surface covers it anyway. xterm's input is transparent by design:
      // the terminal it sits in is what shows.
      const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
      const behind = hit && layer && layer.contains(hit) && !layer.contains(el);
      if (noHover && !behind && !el.closest('.xterm')) out.hoverOnly.push(label);
      continue;
    }
    if (c.left < -0.5 || c.top < -0.5 || c.right > vw + 0.5 || c.bottom > vh + 0.5) {
      out.offscreen.push(`${label} at x=${Math.round(c.left)}..${Math.round(c.right)} y=${Math.round(c.top)}..${Math.round(c.bottom)}`);
      continue;
    }
    const isButton = el.matches('button, [role=button]');
    let behind = false;
    if (isButton && getComputedStyle(el).pointerEvents !== 'none') {
      const x = c.left + c.width / 2;
      const y = c.top + c.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (hit && layer && layer.contains(hit) && !layer.contains(el)) { out.behindSurface += 1; behind = true; }
      else if (hit && hit !== el && !el.contains(hit)) out.covered.push(`${label} covered by ${describe(hit)} at (${Math.round(x)},${Math.round(y)})`);
    }
    if (phone && isButton && !behind && (r.width < minTarget - 0.5 || r.height < minTarget - 0.5)) {
      out.small.push(`${label} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  return out;
}

const server = await startServer(root, { sandbox: false, noExtensions: true, terminal: { enabled: true } }, { entry: path.resolve('cli/dist/pi-outpost.mjs'), env });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const results = [];
let failed = false;
try {
  for (const viewport of VIEWPORTS) {
    const phone = viewport.width <= PHONE_MAX;
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: phone || !!viewport.touch, isMobile: false });
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
      const found = await page.evaluate(inspect, { phone: phone || !!viewport.touch, minTarget: MIN_TARGET, surface });
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, `${viewport.width}-${name.replace(/[^a-z0-9]+/gi, '-')}.png`) });
      results.push({ width: viewport.width, surface: name, ...found, errors: [...errors] });
      errors.length = 0;
    };
    await check('chat');

    /** A broken expectation about the shell, reported like any other violation. */
    const expect = (name, ok, message) => {
      if (!ok) results.push({ width: viewport.width, surface: name, overflow: null, offscreen: [], covered: [], small: [], hoverOnly: [], behindSurface: 0, errors: [], broken: [message] });
    };
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const navButton = (name) => nav.getByRole('button', { name, exact: false });
    const noPhoneSheets = async (name) => {
      const left = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="phone-"][data-testid$="-sheet"], [data-testid="compact-header-more"]')].map((n) => n.dataset.testid));
      expect(name, left.length === 0, `sheets left open: ${left.join(', ')}`);
    };

    if (phone) {
      expect('shell', await nav.isVisible(), 'no bottom navigation on a phone');
      const header = page.getByTestId('compact-header');
      const headerBox = await header.boundingBox();
      expect('shell', headerBox && headerBox.height <= 45, `phone header ${headerBox?.height}px tall, expected one 44px row`);
      expect('shell', (await navButton('Chat').getAttribute('aria-current')) === 'page', 'Chat is not the current surface');
      const modelBar = await page.getByTestId('model-bar').boundingBox();
      expect('shell', modelBar && modelBar.height <= 46, `the model bar takes ${modelBar?.height}px, expected one row`);
      const strip = await page.getByRole('region', { name: 'Activity' }).boundingBox();
      expect('shell', strip && strip.height <= 30, `the activity strip takes ${strip?.height}px, expected one slim line`);

      // The project control in the header and the menu it opens.
      const projectControl = header.locator('button').first();
      if ((await projectControl.getAttribute('aria-expanded')) !== null || (await projectControl.getAttribute('aria-haspopup')) !== null) {
        await projectControl.click();
        await page.waitForTimeout(200);
        await check('project menu', '[data-testid="compact-header"]');
        if ((await projectControl.getAttribute('aria-expanded')) === 'true') await projectControl.click();
        else await page.keyboard.press('Escape');
      }

      // The overflow sheet, and Settings opened in place inside it.
      await page.getByRole('button', { name: 'More controls' }).click();
      const more = page.getByTestId('compact-header-more');
      await more.waitFor();
      await check('overflow menu', '[data-testid="compact-header-more"]');
      // Every menu the sheet holds, each opened in place and closed again.
      const menuSelector = 'button[aria-haspopup]:not([aria-haspopup="dialog"]), button[aria-expanded]';
      const menus = await more.locator(menuSelector).evaluateAll((list) =>
        list.map((b) => b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent.trim()));
      expect('overflow menu', menus.length >= 3, `only ${menus.length} menus found in the overflow sheet: ${menus.join(', ')}`);
      // The sheet is back in the same state after each round, so the nth trigger stays the nth.
      for (const [index, name] of menus.entries()) {
        const trigger = more.locator(menuSelector).nth(index);
        await trigger.click();
        await page.waitForTimeout(200);
        await check(`overflow menu: ${name.slice(0, 40)}`, '[data-testid="compact-header-more"]');
        // Some menus close themselves on a choice; only close what is still open.
        if (await more.isVisible() && (await trigger.getAttribute('aria-expanded')) === 'true') await trigger.click();
        expect(`overflow menu: ${name}`, await more.isVisible(), `opening and closing "${name}" closed the overflow sheet`);
      }
      // Settings opened in place, then closed with Escape.
      await more.getByRole('button', { name: 'Settings' }).click();
      await page.waitForTimeout(200);
      await check('overflow menu: settings', '[data-testid="compact-header-more"]');
      // Its folded sections too (accounts with their API key buttons, tools, extensions).
      await more.locator('details:not([open]) > summary').evaluateAll((list) => list.forEach((s) => s.click()));
      await page.waitForTimeout(300);
      await check('overflow menu: settings expanded', '[data-testid="compact-header-more"]');
      await page.keyboard.press('Escape');
      if (await more.isVisible()) await more.getByRole('button', { name: 'Close' }).first().click();
      await noPhoneSheets('overflow menu closed');

      // Files, then a file pushed over it, and back.
      await navButton('Files').click();
      const files = page.getByTestId('phone-files-sheet');
      await files.waitFor();
      await files.getByText('README.md', { exact: true }).waitFor();
      await check('files', '[data-testid="phone-files-sheet"]');
      await files.getByText('README.md', { exact: true }).click();
      const viewer = page.getByTestId('phone-viewer-sheet');
      await viewer.getByText('Responsive fixture', { exact: false }).first().waitFor();
      await check('file viewer', '[data-testid="phone-viewer-sheet"]');
      // The toolbar scrolls sideways rather than clipping: its last control can be reached.
      const toolbar = viewer.getByTestId('file-viewer-toolbar');
      await toolbar.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await page.waitForTimeout(150);
      const edit = viewer.getByRole('button', { name: /edit/ }).last();
      const editBox = await edit.boundingBox();
      expect('file viewer toolbar', editBox && editBox.x >= 0 && editBox.x + editBox.width <= viewport.width + 0.5, `the toolbar's last control is out of reach (${JSON.stringify(editBox)})`);
      await check('file viewer: toolbar scrolled', '[data-testid="phone-viewer-sheet"]');
      await viewer.getByRole('button', { name: 'Back to files' }).click();
      await viewer.waitFor({ state: 'detached' });
      expect('file viewer back', await files.isVisible(), 'back from the viewer did not return to Files');
      await files.getByRole('button', { name: 'Close' }).last().click();
      await noPhoneSheets('files closed');

      await navButton('Sessions').click();
      const sessionsSheet = page.getByTestId('phone-sessions-sheet');
      await sessionsSheet.getByText(SESSION_TITLE, { exact: true }).waitFor();
      await check('sessions sheet', '[data-testid="phone-sessions-sheet"]');
      await sessionsSheet.getByRole('button', { name: 'Close' }).click();
      await noPhoneSheets('sessions closed');

      await navButton('Plan').click();
      const planSheet = page.getByTestId('phone-plan-sheet');
      await planSheet.getByRole('complementary', { name: 'Work Plan' }).waitFor();
      await check('plan', '[data-testid="phone-plan-sheet"]');
      await planSheet.getByRole('button', { name: 'Close Work Plan' }).click();
      await noPhoneSheets('plan closed');
      await navButton('Plan').click();
      await planSheet.waitFor();
      await page.keyboard.press('Escape');
      expect('plan closed', !(await planSheet.isVisible()), 'Escape did not close the Work Plan sheet');

      if (await navButton('Terminal').isVisible()) {
        await navButton('Terminal').click();
        const terminal = page.getByTestId('terminal-sheet');
        await terminal.waitFor();
        await page.waitForTimeout(500);
        const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollHeight - window.innerHeight, top: window.scrollY }));
        expect('terminal', scroll.doc <= 1 && scroll.top === 0, `page scrolls under the terminal (${scroll.doc}px)`);
        await check('terminal', '[data-testid="terminal-sheet"]');
        await terminal.getByRole('button', { name: 'Close Terminal' }).click();
        await terminal.waitFor({ state: 'hidden' });
      } else {
        console.log(`NOTE ${viewport.width}px terminal: not enabled in this build's fixture, skipped`);
      }
      await check('chat after surfaces');
      await context.close();
      continue;
    }

    // Wide layouts: Terminal sessions sits in the header row, the activity strip is
    // one slim line, and a short screen still gives the conversation most of its height.
    {
      const wide = await page.evaluate(() => ({
        terminalInHeader: [...document.querySelectorAll('header button')].some((b) => b.textContent.trim() === 'Terminal sessions'),
        strip: document.querySelector('section[aria-label="Activity"]')?.getBoundingClientRect().height ?? 0,
        ratio: (document.querySelector('main')?.getBoundingClientRect().height ?? 0) / innerHeight,
      }));
      expect('wide shell', wide.terminalInHeader, 'Terminal sessions is not in the header row');
      expect('wide shell', wide.strip <= 30, `the activity strip takes ${wide.strip}px, expected one slim line`);
      if (viewport.height <= 900) expect('wide shell', wide.ratio >= 0.5, `the transcript takes ${(wide.ratio * 100).toFixed(1)}% of a ${viewport.width}x${viewport.height} screen, expected at least 50%`);
      console.log(`INFO ${viewport.width}x${viewport.height} transcript ${(wide.ratio * 100).toFixed(1)}% of the viewport`);
    }
    if (viewport.width >= 1024) {
      expect('desktop shell', !(await nav.count()), 'bottom navigation shown on a desktop');
      expect('desktop shell', !(await page.getByTestId('compact-header').count()), 'compact header shown on a desktop');
      const row = await page.evaluate(() => {
        const header = document.querySelector('header');
        const kids = [...(header?.querySelectorAll('button') ?? [])].filter((b) => b.getBoundingClientRect().height > 0);
        const tops = new Set(kids.map((b) => Math.round(b.getBoundingClientRect().top + b.getBoundingClientRect().height / 2)));
        return { height: header?.getBoundingClientRect().height ?? 0, rows: tops.size, labels: kids.map((b) => (b.textContent || '').trim()) };
      });
      expect('desktop shell', row.height < 60 && row.rows === 1, `desktop header ${row.height}px over ${row.rows} rows`);
      for (const label of ['◨ files', 'sessions']) {
        expect('desktop shell', row.labels.includes(label), `desktop header lost "${label}"`);
      }
      expect('desktop shell', await page.getByRole('button', { name: 'Terminal sessions' }).isVisible(), 'desktop lost Terminal sessions');
    }

    if (viewport.width < 1024) {
      // Tablet: the file sidebar overlays the chat as a drawer instead of pushing it.
      const filesToggle = page.getByRole('button', { name: '◨ files' });
      if (await filesToggle.isVisible()) {
        const mainBefore = await page.locator('main').boundingBox();
        await filesToggle.click();
        const drawer = page.getByTestId('tablet-sidebar-drawer');
        await drawer.getByText('README.md', { exact: true }).waitFor();
        const mainAfter = await page.locator('main').boundingBox();
        expect('tablet drawer', mainBefore && mainAfter && Math.abs(mainBefore.width - mainAfter.width) < 1, `the sidebar pushed the chat (${mainBefore?.width} to ${mainAfter?.width}px)`);
        await check('files drawer', '[data-testid="tablet-sidebar-drawer"]');
        await page.keyboard.press('Escape');
        expect('tablet drawer', !(await drawer.getByText('README.md', { exact: true }).isVisible()), 'Escape did not close the tablet drawer');
      }
    }

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
    const blindExtra = [];
    if (viewport.width >= 1024 && !viewport.touch && (await sessions.isVisible())) {
      // Desktop keeps its hover reveal: a session's rename control is hidden until
      // its row is hovered, then shown. A touch screen has no hover, so it shows.
      await sessions.click();
      const rename = page.getByRole('button', { name: 'Rename session' }).first();
      await rename.waitFor({ state: 'attached' });
      const before = await rename.evaluate((el) => getComputedStyle(el).opacity);
      await rename.locator('xpath=..').hover();
      await page.waitForTimeout(250);
      const after = await rename.evaluate((el) => getComputedStyle(el).opacity);
      expect('desktop hover reveal', before === '0' && after === '1', `rename control opacity ${before} at rest, ${after} on hover; expected 0 then 1`);
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
      // ... and a hover-only control, on a screen without hover.
      const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      const touchPage = await touch.newPage();
      await touchPage.setContent('<button style="opacity:0;width:60px;height:44px">hover only</button>');
      const seenTouch = await touchPage.evaluate(inspect, { phone: true, minTarget: MIN_TARGET, surface: null });
      await touch.close();
      if (!seenTouch.hoverOnly.some((v) => v.includes('hover only'))) blindExtra.push('hover-only');
      const blind = [
        ...blindExtra,
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
    ...(r.broken ?? []).map((v) => `shell: ${v}`),
    ...(r.hoverOnly ?? []).map((v) => `hover-only: ${v} is transparent on a screen without hover`),
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
