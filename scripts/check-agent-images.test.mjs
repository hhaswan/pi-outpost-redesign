import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateWasmAsset, checkAgentImages} from './check-agent-images.mjs';

test('CorruptImageRuntimeCannotDeploy: truncated WASM is rejected with an actionable dependency error', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'image-wasm-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'photon_rs_bg.wasm');
  await writeFile(file, Buffer.from([0, 97, 115, 109, 1]));
  await assert.rejects(validateWasmAsset(file), /Invalid WebAssembly asset:.*Restore the locked dependency/);
});

test('ValidWasmRetainsExactBytes: validation does not rewrite the runtime asset', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'image-wasm-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'valid.wasm');
  const bytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
  await writeFile(file, bytes);
  assert.deepEqual(await validateWasmAsset(file), bytes);
});

test('ActualSdkImagesSurviveNormalization: real Photon decodes and resizes a valid small PNG', async () => {
  const result = await checkAgentImages();
  assert.ok(result.bytes > 0);
});
