#!/usr/bin/env node
/**
 * Built app, real browser: an extension's ctx.ui.input with terminal OSC 8 hyperlinks, shaped
 * exactly like pi-mcp-adapter's OAuth prompt, shows one "Open authorization page" button-link
 * and one URL link, with no escape bytes in the DOM, at 1280 and 390 px. A javascript: target in
 * a second dialog is never linked. The answer typed in the dialog reaches the extension.
 * No model calls: the dialog comes from an extension command.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeWorkspace, startServer } from '../server/test/harness.mjs';
import { leaveStartScreen } from './leave-start-screen.mjs';

const root = await makeWorkspace({ 'README.md': '# links\n' });
const home = path.join(root, 'home');
const agentDir = path.join(root, '.pi-agent');
await fs.mkdir(agentDir, { recursive: true });
const answers = path.join(root, 'answers.jsonl');
const url = `https://maccai.example/oauth/authorize?response_type=code&client_id=pi-outpost&redirect_uri=${encodeURIComponent('http://127.0.0.1:43123/callback')}&state=${'s'.repeat(160)}`;
const extension = path.join(root, 'oauth-dialog.mjs');
// terminalHyperlink() from pi-mcp-adapter/dist/utils.js, and the title from its commands.ts.
await fs.writeFile(extension, `import { appendFile } from "node:fs/promises";
const terminalHyperlink = (label, url) => \`\\u001B]8;;\${url}\\u001B\\\\\${label}\\u001B]8;;\\u001B\\\\\`;
const url = ${JSON.stringify(url)};
export default (pi) => {
  pi.registerCommand("oauth", { handler: async (_args, ctx) => {
    const value = await ctx.ui.input("Complete maccai OAuth\\n\\n" + terminalHyperlink("Open authorization page", url) + "\\n" + terminalHyperlink(url, url) + "\\n\\nApprove access, then paste the full callback URL from the browser address bar below.");
    await appendFile(${JSON.stringify(answers)}, JSON.stringify({ value: value ?? null }) + "\\n");
  }});
  pi.registerCommand("evil", { handler: async (_args, ctx) => {
    const value = await ctx.ui.input("Evil link\\n\\n" + terminalHyperlink("click me", "javascript:alert(1)") + " \\u001B]0;title\\u0007end");
    await appendFile(${JSON.stringify(answers)}, JSON.stringify({ evil: value ?? null }) + "\\n");
  }});
};
`);
const server = await startServer(root, { agentDir, sandbox: false, noExtensions: false, extensionPaths: [extension], updateCheck: false, changelogNotice: false }, { entry: path.resolve('cli/dist/pi-outpost.mjs'), env: { HOME: home, PI_OFFLINE: '1', ANTHROPIC_API_KEY: 'fixture-no-model-calls' } });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const pageErrors = [];
const records = async () => (await fs.readFile(answers, 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width < 768 ? 844 : 900 } });
    page.on('pageerror', (error) => pageErrors.push(`${width}: ${error.message}`));
    await page.goto(server.base);
    await leaveStartScreen(page);
    const composer = page.getByPlaceholder(/^message pi/);
    await composer.fill('/oauth');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const dialog = page.getByRole('region', { name: 'Complete maccai OAuth', exact: true });
    await dialog.waitFor({ timeout: 30000 });
    const open = dialog.getByRole('link', { name: 'Open authorization page', exact: true });
    assert.equal(await open.count(), 1);
    assert.equal(await open.getAttribute('href'), url);
    assert.equal(await open.getAttribute('target'), '_blank');
    assert.equal(await open.getAttribute('rel'), 'noopener noreferrer');
    const box = await open.boundingBox();
    assert.ok(box.height >= 44, `button-link is ${box.height}px tall`);
    assert.equal(await dialog.getByRole('link').count(), 2);
    const urlLink = dialog.getByRole('link').nth(1);
    assert.equal((await urlLink.textContent()).trim(), url);
    assert.equal(await urlLink.getAttribute('href'), url);
    const html = await dialog.evaluate((element) => element.innerHTML);
    assert.ok(!html.includes('\u001b') && !html.includes(']8;;'), 'escape bytes in the DOM');
    assert.equal((await dialog.textContent()).split(url).length - 1, 1, 'the URL is visible once');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}px`);
    const urlBox = await urlLink.boundingBox();
    const dialogBox = await dialog.boundingBox();
    assert.ok(urlBox.x + urlBox.width <= dialogBox.x + dialogBox.width + 1, 'the long URL breaks inside the dialog');
    // Monkey: the link opens a new tab and leaves the dialog in place.
    const [popup] = await Promise.all([page.context().waitForEvent('page'), open.click()]);
    await popup.close();
    await dialog.getByRole('textbox').fill(`http://127.0.0.1:43123/callback?code=${width}`);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    const deadline = Date.now() + 10000;
    while (!(await records()).some((r) => r.value === `http://127.0.0.1:43123/callback?code=${width}`)) {
      assert.ok(Date.now() < deadline, 'the answer did not reach the extension');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    await composer.fill('/evil');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const evil = page.getByRole('region', { name: 'Evil link', exact: true });
    await evil.waitFor({ timeout: 30000 });
    assert.equal(await evil.getByRole('link').count(), 0, 'a javascript: target was linked');
    const evilText = await evil.textContent();
    assert.ok(evilText.includes('click me') && evilText.includes('end') && !evilText.includes('title'), evilText);
    await evil.getByRole('button', { name: 'Cancel', exact: true }).click();
    await evil.waitFor({ state: 'detached' });
    await page.close();
    console.log(`PASS extension hyperlinks at ${width}px`);
  }
  assert.deepEqual(pageErrors, []);
  console.log('PASS ExtensionDialogTerminalHyperlinks: one button-link, one URL link, no escapes, javascript: not linked, answer delivered');
} catch (error) {
  console.error(server.log().split('\n').slice(-30).join('\n'));
  throw error;
} finally {
  await browser.close();
  await server.stop();
}
