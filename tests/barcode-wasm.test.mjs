import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import JsBarcode from 'jsbarcode';
import * as zx from 'zxing-wasm/reader';
import { createBarcodeEngine } from '../src/lib/barcode.ts';

function barcodeImage(text, format) {
  const target = {};
  JsBarcode(target, text, { format, displayValue: false });
  const bits = target.encodings.map((encoding) => encoding.data).join('');
  const width = (bits.length + 40) * 3;
  const height = 180;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 20; y < height - 20; y++) {
    for (let x = 0; x < bits.length; x++) {
      if (bits[x] !== '1') continue;
      for (let i = 0; i < 3; i++) {
        const offset = (y * width + (x + 20) * 3 + i) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = 0;
      }
    }
  }
  return { data, width, height };
}

test('bundled local WASM decodes EAN-13 and EAN-8 through the fallback reader', async () => {
  const formats = { 'EAN-13': 'ean13', 'EAN-8': 'ean8' };
  let current;
  const read = await createBarcodeEngine({
    source: () => null,
    onSelection: ({ engine }) => assert.equal(engine, 'WASM'),
    loadWasm: async () => {
      zx.setZXingModuleOverrides({
        wasmBinary: readFileSync(new URL(import.meta.resolve('zxing-wasm/reader/zxing_reader.wasm'))),
      });
      await zx.getZXingModule();
      return async () => (await zx.readBarcodesFromImageData(current, {
        formats: Object.keys(formats), tryHarder: true,
      })).map((result) => ({ value: result.text, format: formats[result.format] }));
    },
  });
  for (const [text, format, expected] of [['8412345678905', 'EAN13', 'ean13'], ['12345670', 'EAN8', 'ean8']]) {
    current = barcodeImage(text, format);
    assert.deepEqual(await read(), [{ value: text, format: expected }]);
  }
});
