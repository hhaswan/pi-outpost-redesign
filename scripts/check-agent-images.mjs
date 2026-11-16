/** Fail before shipping when the SDK would silently omit every image. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire, findPackageJSON} from 'node:module';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function validateWasmAsset(file) {
  const bytes = await readFile(file);
  try {
    await WebAssembly.compile(bytes);
  } catch (cause) {
    throw new Error(`Invalid WebAssembly asset: ${file}. Restore the locked dependency; increasing image limits will not fix it.`, {cause});
  }
  return bytes;
}

export async function checkAgentImages(anchor = import.meta.url) {
  // Resolve from the actual release, not the worker's unrelated dependency tree.
  const sdkPackage = findPackageJSON('@earendil-works/pi-coding-agent', anchor);
  assert.ok(sdkPackage, 'SDK package is missing from the release dependency tree');
  const metadata = JSON.parse(await readFile(sdkPackage, 'utf8'));
  assert.equal(typeof metadata.exports?.['.']?.import, 'string', 'SDK import entry changed; review image preflight');
  const sdkEntry = path.resolve(path.dirname(sdkPackage), metadata.exports['.'].import);
  const sdkRequire = createRequire(sdkEntry);
  const photonEntry = sdkRequire.resolve('@silvia-odwyer/photon-node');
  const wasm = path.join(path.dirname(photonEntry), 'photon_rs_bg.wasm');
  await validateWasmAsset(wasm);
  const {resizeImage} = await import(pathToFileURL(sdkEntry).href);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg==', 'base64');
  const image = await resizeImage(png, 'image/png', {maxWidth: 2, maxHeight: 2, maxBytes: 4096});
  assert.ok(image?.wasResized && image.width === 2 && image.height === 2 && image.data.length < 4096,
    'SDK image decoding/resizing failed; do not deploy a runtime that omits images');
  return {sdkEntry, wasm, bytes: (await readFile(wasm)).length};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await checkAgentImages(process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : undefined);
  console.log('PASS AgentImageDecodeAndResize');
}
