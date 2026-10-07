import type { LoyaltyFormat } from './types';

export type BarcodeHit = { value: string; format: LoyaltyFormat };
export type BarcodeReader = () => Promise<BarcodeHit[]>;
export type BarcodeSelection = { engine: 'nativo' | 'WASM'; reason: string };

type NativeHit = { rawValue: string; format: string };
export interface NativeBarcodeDetector {
  new(options: { formats: string[] }): { detect(source: unknown): Promise<NativeHit[]> };
  getSupportedFormats?: () => Promise<string[]>;
}

const NATIVE_FORMATS: Record<string, LoyaltyFormat> = {
  qr_code: 'qr', ean_13: 'ean13', ean_8: 'ean8',
  code_128: 'code128', code_39: 'code39', upc_a: 'upca',
};
const CORE_FORMATS = ['ean_13', 'ean_8'];
const empty: BarcodeReader = async () => [];
const message = (error: unknown) => String((error as Error)?.message ?? error);

export class BarcodeEngineError extends Error {}

export async function createBarcodeEngine({ native: Native, source, loadWasm, onSelection, isActive = () => true }: {
  native?: NativeBarcodeDetector;
  source: () => unknown;
  loadWasm: () => Promise<BarcodeReader>;
  onSelection: (selection: BarcodeSelection) => void;
  isActive?: () => boolean;
}): Promise<BarcodeReader> {
  if (!isActive()) return empty;
  let wasm: Promise<BarcodeReader> | undefined;
  async function fallback(reason: string): Promise<BarcodeReader> {
    if (!isActive()) return empty;
    if (!wasm) {
      onSelection({ engine: 'WASM', reason });
      wasm = (async () => {
        try { return await loadWasm(); } catch (error) {
          if (!isActive()) return empty;
          throw new BarcodeEngineError(`WASM (${reason}): ${message(error)}`);
        }
      })();
    }
    return wasm;
  }
  async function readWasm(reason: string): Promise<BarcodeHit[]> {
    const read = await fallback(reason);
    if (!isActive()) return [];
    const hits = await read();
    return isActive() ? hits : [];
  }

  let detector: InstanceType<NativeBarcodeDetector> | undefined;
  let reason = 'BarcodeDetector no disponible';
  if (typeof Native === 'function') {
    try {
      if (typeof Native.getSupportedFormats !== 'function') {
        throw new Error('getSupportedFormats no disponible');
      }
      const supported = await Native.getSupportedFormats();
      if (!isActive()) return empty;
      if (!Array.isArray(supported)) throw new Error('formatos no válidos');
      const missing = CORE_FORMATS.filter((format) => !supported.includes(format));
      if (missing.length) throw new Error(`faltan ${missing.join(', ')}`);
      const formats = Object.keys(NATIVE_FORMATS).filter((format) => supported.includes(format));
      detector = new Native({ formats });
      if (typeof detector.detect !== 'function') throw new Error('detect no disponible');
      reason = `formatos: ${formats.join(', ')}`;
    } catch (error) {
      detector = undefined;
      reason = `BarcodeDetector: ${message(error)}`;
    }
  }
  if (!isActive()) return empty;
  if (!detector) {
    await fallback(reason);
    return () => readWasm(reason);
  }

  onSelection({ engine: 'nativo', reason });
  const selected = detector;
  let failures = 0;
  return async () => {
    if (!isActive()) return [];
    if (wasm) return readWasm(reason);
    try {
      const codes = await selected.detect(source());
      if (!isActive()) return [];
      const hits = codes.filter((code) => code?.rawValue).map((code) => ({
        value: String(code.rawValue), format: NATIVE_FORMATS[code.format] ?? 'code128',
      }));
      failures = 0;
      return hits;
    } catch (error) {
      if (!isActive()) return [];
      // Un fotograma vacío es normal; solo cuentan las excepciones consecutivas.
      if (++failures < 3) throw error;
      reason = `BarcodeDetector: 3 errores consecutivos (${message(error)})`;
      return readWasm(reason);
    }
  };
}

export function createBarcodeFilter(cooldownMs = 2500) {
  let lastSeen = '';
  let lastAccepted = '';
  let lastAcceptedAt = 0;
  return (hit: BarcodeHit | undefined, now = Date.now()): BarcodeHit | null => {
    if (!hit || (hit.value === lastAccepted && now - lastAcceptedAt < cooldownMs)) return null;
    if (hit.value !== lastSeen) {
      lastSeen = hit.value;
      return null;
    }
    lastAccepted = hit.value;
    lastAcceptedAt = now;
    lastSeen = '';
    return hit;
  };
}
