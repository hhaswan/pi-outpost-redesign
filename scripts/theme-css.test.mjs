import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const webRequire = createRequire(path.join(root, 'web/package.json'));
const selector = ':where([data-theme="dark"], [data-theme="dark"] *, :host([data-theme="dark"]) *)';

async function compileWeb() {
  const postcss = webRequire('postcss');
  const tailwind = webRequire('tailwindcss');
  const config = webRequire('./tailwind.config.cjs');
  const result = await postcss([tailwind({
    ...config,
    content: [{ raw: 'bg-white dark:bg-black', extension: 'html' }],
  })]).process('@tailwind utilities; .applied { @apply bg-white dark:bg-black; }', { from: undefined });
  return result.css;
}

async function compileEmbedVariant() {
  // Embed uses Tailwind 4; web uses Tailwind 3. Exercise the actual shared
  // stylesheet's variant, not a test-only copy of its selector.
  const { compile } = await import('@tailwindcss/node');
  const source = await readFile(path.join(root, 'web/src/index.css'), 'utf8');
  const variant = source.match(/@custom-variant dark\s*\([^;]+;/)?.[0];
  assert.ok(variant, 'shared stylesheet must define the embed dark variant');
  const compiler = await compile(`@import "tailwindcss";\n${variant}`, {
    base: root,
    onDependency() {},
  });
  return compiler.build(['bg-white', 'dark:bg-black']);
}

for (const [pipeline, compile] of [['web', compileWeb], ['embed variant', compileEmbedVariant]]) {
  test(`${pipeline}: ExplicitThemeUtilities and ShadowHostThemeUtilities`, async () => {
    const css = await compile();
    assert.ok(css.includes(`.dark\\:bg-black${selector}`), 'dark utility must use explicit root/host selectors');
    assert.ok(!css.includes('prefers-color-scheme'), 'OS must not override an explicit light theme');
    if (pipeline === 'web') assert.ok(css.includes(`.applied${selector}`), '@apply must use the same variant');
  });

  // Opt-in browser proof keeps the ordinary script suite independent of browser
  // installation. This is isolated CSS proof, not a running-application test.
  test(`${pipeline}: explicit document and shadow themes override OS changes`, {
    skip: process.env.THEME_CSS_BROWSER !== '1',
  }, async () => {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.THEME_CSS_BROWSER_EXECUTABLE || undefined,
    });
    try {
      const page = await browser.newPage();
      const css = await compile();
      await page.setContent('<div id="normal" class="bg-white dark:bg-black">Document</div><div id="host"></div>');
      await page.addStyleTag({ content: css });
      await page.evaluate((sheet) => {
        const shadow = document.querySelector('#host').attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = sheet;
        shadow.append(style);
        const probe = document.createElement('div');
        probe.className = 'bg-white dark:bg-black';
        probe.id = 'probe';
        shadow.append(probe);
      }, css);
      for (const colorScheme of ['dark', 'light', 'dark']) {
        await page.emulateMedia({ colorScheme });
        for (const documentTheme of ['light', 'dark', 'light']) {
          for (const hostTheme of ['dark', 'light', 'dark']) {
            const colors = await page.evaluate(([documentTheme, hostTheme]) => {
              document.documentElement.dataset.theme = documentTheme;
              const host = document.querySelector('#host');
              host.dataset.theme = hostTheme;
              return [
                getComputedStyle(document.querySelector('#normal')).backgroundColor,
                getComputedStyle(host.shadowRoot.querySelector('#probe')).backgroundColor,
              ];
            }, [documentTheme, hostTheme]);
            const expected = (theme) => theme === 'dark' ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)';
            assert.deepEqual(colors, [expected(documentTheme), expected(hostTheme)],
              `${pipeline}: OS=${colorScheme}, document=${documentTheme}, host=${hostTheme}`);
          }
        }
      }
    } finally {
      await browser.close();
    }
  });
}
