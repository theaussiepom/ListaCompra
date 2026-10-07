import assert from 'node:assert/strict';
import test from 'node:test';
import { BarcodeEngineError, createBarcodeEngine, createBarcodeFilter } from '../src/lib/barcode.ts';

const allFormats = ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a'];
const hit = { value: '8412345678905', format: 'ean13' };
const frame = {};

function native({ supported = allFormats, detect = async () => [], construct } = {}) {
  return class {
    static async getSupportedFormats() { return supported; }
    constructor(options) { construct?.(options); }
    detect = detect;
  };
}

async function setup(Native, overrides = {}) {
  const selections = [];
  let loads = 0;
  const read = await createBarcodeEngine({
    native: Native,
    source: () => frame,
    loadWasm: async () => { loads++; return async () => [hit]; },
    onSelection: (selection) => selections.push(selection),
    ...overrides,
  });
  return { read, selections, loads: () => loads };
}

test('native grocery support selects only advertised formats and maps every existing format', async () => {
  let requested;
  const Native = native({
    supported: [...allFormats, 'pdf417'],
    construct: ({ formats }) => { requested = formats; },
    detect: async (source) => {
      assert.equal(source, frame);
      return allFormats.map((format, index) => ({ rawValue: String(index + 1), format }));
    },
  });
  const engine = await setup(Native);
  assert.deepEqual(requested, allFormats);
  assert.deepEqual((await engine.read()).map((value) => value.format), ['qr', 'ean13', 'ean8', 'code128', 'code39', 'upca']);
  assert.equal(engine.loads(), 0);
  assert.equal(engine.selections[0].engine, 'nativo');
});

test('native grocery support does not require unsupported optional formats', async () => {
  const engine = await setup(native({
    supported: ['ean_13', 'ean_8'],
    construct: ({ formats }) => assert.deepEqual(formats, ['ean_13', 'ean_8']),
  }));
  assert.deepEqual(await engine.read(), []);
  assert.equal(engine.loads(), 0);
});

const unsupported = [
  ['absent', undefined, /no disponible/],
  ['non-constructor partial implementation', {}, /no disponible/],
  ['missing EAN-8', native({ supported: ['ean_13', 'qr_code'] }), /ean_8/],
  ['missing EAN-13', native({ supported: ['ean_8'] }), /ean_13/],
  ['missing introspection', class { detect() {} }, /getSupportedFormats/],
  ['rejected introspection', class { static async getSupportedFormats() { throw new Error('capability failed'); } }, /capability failed/],
  ['throwing introspection', class { static getSupportedFormats() { throw new Error('capability threw'); } }, /capability threw/],
  ['invalid introspection', native({ supported: null }), /formatos no válidos/],
  ['throwing constructor', native({ construct: () => { throw new Error('setup failed'); } }), /setup failed/],
  ['missing detect', class { static async getSupportedFormats() { return allFormats; } }, /detect no disponible/],
];
for (const [name, Native, reason] of unsupported) {
  test(`${name} falls back to WASM`, async () => {
    const engine = await setup(Native);
    assert.deepEqual(await engine.read(), [hit]);
    assert.equal(engine.loads(), 1);
    assert.equal(engine.selections[0].engine, 'WASM');
    assert.match(engine.selections[0].reason, reason);
  });
}

test('three consecutive native failures switch once and scanning continues', async () => {
  let attempts = 0;
  const engine = await setup(native({ detect: async () => { attempts++; throw new Error('service unavailable'); } }));
  await assert.rejects(engine.read(), /service unavailable/);
  await assert.rejects(engine.read(), /service unavailable/);
  assert.deepEqual(await engine.read(), [hit]);
  assert.deepEqual(await engine.read(), [hit]);
  assert.equal(attempts, 3);
  assert.equal(engine.loads(), 1);
  assert.deepEqual(engine.selections.map((item) => item.engine), ['nativo', 'WASM']);
  assert.match(engine.selections[1].reason, /3 errores consecutivos.*service unavailable/);
});

test('empty successful frames reset native failure count', async () => {
  let attempts = 0;
  const engine = await setup(native({ detect: async () => {
    if (++attempts % 3 === 0) return [];
    throw new Error('frame not ready');
  } }));
  for (let i = 0; i < 2; i++) {
    await assert.rejects(engine.read(), /frame not ready/);
    await assert.rejects(engine.read(), /frame not ready/);
    assert.deepEqual(await engine.read(), []);
  }
  assert.equal(engine.loads(), 0);
});

test('malformed native results count as engine errors', async () => {
  const engine = await setup(native({ detect: async () => undefined }));
  await assert.rejects(engine.read(), TypeError);
  await assert.rejects(engine.read(), TypeError);
  assert.deepEqual(await engine.read(), [hit]);
});

for (const phase of ['import', 'initialization']) {
  test(`WASM ${phase} failure retains a useful cause and fallback reason`, async () => {
    await assert.rejects(setup(undefined, {
      loadWasm: async () => { throw new Error(`${phase} failed`); },
    }), (error) => error instanceof BarcodeEngineError && error.message.includes(`${phase} failed`) && error.message.includes('BarcodeDetector no disponible'));
  });
}

test('failed runtime WASM initialization is not retried every frame', async () => {
  let loads = 0;
  const engine = await setup(native({ detect: async () => { throw new Error('native failed'); } }), {
    loadWasm: async () => { loads++; throw new Error('WASM initialization failed'); },
  });
  await assert.rejects(engine.read(), /native failed/);
  await assert.rejects(engine.read(), /native failed/);
  await assert.rejects(engine.read(), BarcodeEngineError);
  await assert.rejects(engine.read(), BarcodeEngineError);
  assert.equal(loads, 1);
});

test('closing while detecting suppresses late hits and runtime fallback', async () => {
  for (const fails of [false, true]) {
    let active = true;
    let finish;
    const engine = await setup(native({ detect: () => new Promise((resolve, reject) => {
      finish = () => fails ? reject(new Error('closed')) : resolve([{ rawValue: hit.value, format: 'ean_13' }]);
    }) }), { isActive: () => active });
    const pending = engine.read();
    active = false;
    finish();
    assert.deepEqual(await pending, []);
    assert.deepEqual(await engine.read(), []);
    assert.equal(engine.loads(), 0);
  }
});

test('closing during capability discovery avoids constructing or loading an engine', async () => {
  let active = true;
  let finish;
  const Native = native({ construct: () => assert.fail('closed detector constructed') });
  Native.getSupportedFormats = () => new Promise((resolve) => { finish = resolve; });
  const pending = setup(Native, { isActive: () => active });
  active = false;
  finish(allFormats);
  const engine = await pending;
  assert.deepEqual(await engine.read(), []);
  assert.equal(engine.loads(), 0);
  assert.deepEqual(engine.selections, []);
});

test('closing during WASM initialization prevents later reads', async () => {
  let active = true;
  let finish;
  const pending = setup(undefined, {
    isActive: () => active,
    loadWasm: () => new Promise((resolve) => { finish = resolve; }),
  });
  active = false;
  finish(async () => assert.fail('closed camera read'));
  const engine = await pending;
  assert.deepEqual(await engine.read(), []);
});

test('continuous acceptance retains two-read verification, duplicate cooldown and new codes', async () => {
  const accept = createBarcodeFilter();
  const engine = await setup(undefined);
  assert.equal(accept((await engine.read())[0], 0), null);
  assert.deepEqual(accept((await engine.read())[0], 120), hit);
  assert.equal(accept((await engine.read())[0], 240), null);
  assert.equal(accept((await engine.read())[0], 2619), null);
  assert.equal(accept((await engine.read())[0], 2620), null);
  assert.deepEqual(accept((await engine.read())[0], 2740), hit);
  const other = { value: '12345670', format: 'ean8' };
  assert.equal(accept(other, 2800), null);
  assert.deepEqual(accept(other, 2920), other);
  assert.equal(accept(undefined, 3000), null);
});

test('alternating codes do not satisfy two-read verification', () => {
  const accept = createBarcodeFilter();
  const other = { ...hit, value: '12345670' };
  for (const value of [hit, other, hit, other]) assert.equal(accept(value), null);
  assert.deepEqual(accept(other), other);
});
