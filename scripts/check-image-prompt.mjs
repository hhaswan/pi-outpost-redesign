#!/usr/bin/env node
/** Real browser attachment -> SDK normalization -> local Anthropic wire, without model spend. */
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from 'playwright/test';
import { makeWorkspace, startServer } from '../server/test/harness.mjs';
import { leaveStartScreen } from './leave-start-screen.mjs';

const entry = fileURLToPath(new URL('../cli/dist/pi-outpost.mjs', import.meta.url));
const root = await makeWorkspace();
const home = path.join(root, 'home');
const agentDir = path.join(home, '.pi', 'agent');
const requests = [];
let titleRequests = 0;
const endpointErrors = [];
const endpoint = http.createServer(async (request, response) => {
  try {
    assert.equal(request.method, 'POST');
    assert.equal(new URL(request.url, 'http://localhost').pathname, '/v1/messages');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.model, 'image-regression');
    assert.equal(body.stream, true);
    const isPrompt = body.messages.at(-1)?.content.some(block => block.type === 'text' && block.text.startsWith('image regression '));
    if (isPrompt) requests.push(body);
    else {
      // Outpost names a new session after its first exchange, through the same local endpoint.
      assert.equal(body.max_tokens, 200);
      titleRequests++;
    }
    const reply = isPrompt ? `local-image-reply-${requests.length}` : 'Image regression';
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    event('message_start', { message: { id: `msg_${requests.length}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    event('message_stop', {});
    response.end();
  } catch (error) {
    endpointErrors.push(error.message);
    response.writeHead(500).end('Local fixture rejected request');
  }
});
let server, browser;
try {
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({ providers: { anthropic: {
    baseUrl: `http://127.0.0.1:${endpoint.address().port}`,
    apiKey: 'local-fixture-not-a-real-key',
    models: [{ id: 'image-regression', api: 'anthropic-messages', input: ['text', 'image'], reasoning: false }],
  } } }));
  // Startup model selection belongs to SDK settings, not Outpost's config schema.
  await writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({ defaultProvider: 'anthropic', defaultModel: 'image-regression', defaultThinkingLevel: 'off' }));
  const env = { HOME: home, USERPROFILE: home, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1' };
  for (const key of Object.keys(process.env)) {
    if (/API_KEY|TOKEN|SECRET|CREDENTIAL|PROXY/i.test(key)) env[key] = undefined;
  }
  server = await startServer(root, { agentDir, noExtensions: true, offline: true, updateCheck: false, changelogNotice: false,
    allowedModels: [{ provider: 'anthropic', id: 'image-regression' }],
  }, { entry, env });
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext();
  const externalRequests = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === server.base || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    externalRequests.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(server.base);
  await leaveStartScreen(page);
  const composer = page.getByPlaceholder(/^message pi/);
  await expect(composer).toBeEnabled();

  // Chromium encodes and decodes actual pixels. No image-library fakes.
  async function fixture(name, mimeType, width, height) {
    const data = await page.evaluate(({ mimeType, width, height }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#d22438'; ctx.fillRect(0, 0, width / 2, height);
      ctx.fillStyle = '#1864d2'; ctx.fillRect(width / 2, 0, width / 2, height);
      return canvas.toDataURL(mimeType, 0.9).split(',')[1];
    }, { mimeType, width, height });
    return { name, mimeType, buffer: Buffer.from(data, 'base64') };
  }
  async function submit(file, label) {
    const before = requests.length;
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach files', exact: true }).click();
    await (await chooser).setFiles(file);
    await expect(page.getByTitle('remove attachment', { exact: true })).toHaveCount(1);
    await composer.fill(label);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect.poll(() => requests.length, { timeout: 30_000 }).toBe(before + 1);
    await expect(page.getByText(`local-image-reply-${before + 1}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stop the agent', exact: true })).toHaveCount(0);
    await expect(composer).toBeEnabled();
    await expect(composer).toHaveValue('');
    await expect(page.getByTitle('remove attachment', { exact: true })).toHaveCount(0);
    await expect(page.locator('[data-pending-upload]')).toHaveCount(0);
    const message = requests.at(-1).messages.at(-1);
    assert.equal(message.role, 'user');
    assert.ok(message.content.some(block => block.type === 'text' && block.text.includes(label)));
    return message.content;
  }
  async function checkImage(content, width, height) {
    assert.ok(!JSON.stringify(content).includes('Image omitted'), 'valid attachment must not become omission text');
    const images = content.filter(block => block.type === 'image');
    assert.equal(images.length, 1, 'exactly one image; no stale attachment');
    const source = images[0].source;
    assert.equal(source.type, 'base64');
    assert.ok(['image/png', 'image/jpeg', 'image/webp'].includes(source.media_type));
    assert.ok(Buffer.byteLength(source.data, 'ascii') <= 4.5 * 1024 * 1024, 'encoded payload exceeds 4.5 MiB');
    assert.equal(Buffer.from(source.data, 'base64').toString('base64'), source.data, 'canonical base64');
    const decoded = await page.evaluate(async source => {
      const image = new Image(); image.src = `data:${source.media_type};base64,${source.data}`;
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height,
        left: [...ctx.getImageData(Math.floor(canvas.width / 4), Math.floor(canvas.height / 2), 1, 1).data],
        right: [...ctx.getImageData(Math.floor(canvas.width * 3 / 4), Math.floor(canvas.height / 2), 1, 1).data] };
    }, source);
    const scale = Math.min(1, 2000 / width, 2000 / height);
    assert.ok(decoded.width <= 2000 && decoded.height <= 2000);
    assert.ok(Math.abs(decoded.width - Math.round(width * scale)) <= 1);
    assert.ok(Math.abs(decoded.height - Math.round(height * scale)) <= 1);
    for (const [actual, wanted] of [[decoded.left, [210, 36, 56, 255]], [decoded.right, [24, 100, 210, 255]]]) {
      actual.forEach((value, index) => assert.ok(Math.abs(value - wanted[index]) <= 12, 'decoded fixture pixels changed'));
    }
    return `${decoded.width}x${decoded.height}, ${source.data.length} base64 bytes`;
  }
  for (const [name, mimeType, width, height] of [
    ['small.png', 'image/png', 160, 100],
    ['small.jpg', 'image/jpeg', 180, 120],
    ['large.png', 'image/png', 3200, 2400],
  ]) {
    const content = await submit(await fixture(name, mimeType, width, height), `image regression ${name}`);
    console.log(`PASS ${name}: ${await checkImage(content, width, height)}`);
  }
  // Invalid bytes use the real SDK refusal path; the next turn must still carry valid pixels.
  const invalid = await submit({ name: 'invalid.png', mimeType: 'image/png', buffer: Buffer.from('not an image') }, 'image regression invalid');
  assert.equal(invalid.filter(block => block.type === 'image').length, 0);
  assert.ok(JSON.stringify(invalid).includes('Image omitted'), 'invalid image must report omission, not silently disappear');
  const retry = await submit(await fixture('retry.png', 'image/png', 160, 100), 'image regression retry');
  console.log(`PASS invalid image then valid retry: ${await checkImage(retry, 160, 100)}`);
  assert.equal(requests.length, 5);
  assert.equal(titleRequests, 1);
  assert.deepEqual(endpointErrors, []);
  assert.deepEqual(pageErrors, [], 'app must not throw or go blank');
  assert.deepEqual(externalRequests, [], 'browser must not access external network');
  console.log('PASS actual image prompts: 5 local prompts + 1 local title, no model spend, no blank app or stale upload state');
} catch (error) {
  if (server) console.error(server.log().slice(-3000));
  console.error('Local endpoint requests:', requests.map(body => ({ max_tokens: body.max_tokens, lastMessage: body.messages.at(-1)?.content.map(block => block.type === 'text' ? block.text : block.type) })), endpointErrors);
  throw error;
} finally {
  await browser?.close();
  await server?.stop();
  endpoint.closeAllConnections();
  await new Promise(resolve => endpoint.close(resolve));
  await rm(root, { recursive: true, force: true });
}
