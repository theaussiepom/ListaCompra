// Capa de persistencia local. El estado completo vive en LocalStorage;
// la sync entre dispositivos se hace contra Home Assistant (lib/sync.svelte.ts).

import type { AppState } from './types';
import { STORE_TYPES } from './data/storeTypes';
import { STORES_SEED } from './data/stores';
import { CATEGORIES_SEED } from './data/categories';
import { PRODUCTS_SEED } from './data/products';

const STORAGE_KEY = 'tucompra:state:v1';

export function createInitialState(): AppState {
  return JSON.parse(JSON.stringify({
    version: 1,
    storeTypes: STORE_TYPES,
    stores: STORES_SEED,
    categories: CATEGORIES_SEED,
    products: PRODUCTS_SEED,
    lists: {},
  })) as AppState;
}

export function loadState(): AppState {
  if (typeof localStorage === 'undefined') return createInitialState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return createInitialState();
  try {
    const parsed = JSON.parse(raw) as AppState;
    if (parsed.version !== 1) return createInitialState();
    return parsed;
  } catch {
    return createInitialState();
  }
}

export function saveState(state: AppState): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearState(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(`${STORAGE_KEY}:share:`)) localStorage.removeItem(key);
  }
}

/** Conserva cambios locales del share anterior al cambiar de espacio. */
export function saveShareState(shareId: string, state: AppState): void {
  if (typeof localStorage === 'undefined' || !shareId) return;
  localStorage.setItem(`${STORAGE_KEY}:share:${shareId}`, JSON.stringify(state));
}

export function loadShareState(shareId: string): AppState | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:share:${shareId}`);
    const state = raw ? JSON.parse(raw) as AppState : undefined;
    return state?.version === 1 ? state : undefined;
  } catch {
    return undefined;
  }
}
