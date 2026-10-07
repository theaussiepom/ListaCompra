// Sincronización con Home Assistant (100% local, sin servicios externos).
//
// La SPA se sirve dentro de HA en un <iframe> del panel lateral. El wrapper
// `tucompra-panel.js` nos entrega por postMessage el token de acceso del
// usuario logueado en HA; con él llamamos a /api/tucompra/* autenticados.
//
// Identidad = usuario de HA (no hay login ni passphrase). La compartición es
// a nivel de cuenta entera vía "shares"; solo los admins de HA los gestionan.
//
// Fuera de HA (dev local / GitHub Pages) no hay token → la app funciona en
// modo local puro (LocalStorage) y la sync queda deshabilitada.

import { app } from './stores/app.svelte';
import type { ShoppingList, Product, Store } from './types';
import { LOCALIZED_STORES } from './data/locales';
import { DEFAULT_LOCALE, LOCALES } from './i18n/locale';

// IDs de tienda de todos los locales: distingue seed (de cualquier idioma) de
// tienda custom del usuario, para no sincronizar el seed como si fuera custom.
const ALL_SEED_STORE_IDS = new Set(
  LOCALES.flatMap((l) => LOCALIZED_STORES[l].map((s) => s.id)),
);

interface SyncSnapshot {
  lists: Record<string, ShoppingList>;
  customProducts: Product[];
  customStores: Store[];
  defaultStores?: Record<string, string>;
  updatedAt: number;
}

export interface ShareInfo {
  id: string;
  name: string;
  owner: string;
  members: string[];
  updatedAt: number;
}

export interface HAUser {
  user_id: string;
  name: string;
  is_admin: boolean;
  person: { entity_id: string; name: string; picture?: string } | null;
}

const ACTIVE_SHARE_KEY = 'tucompra:shareId';
const POLL_MS = 12_000;

let token = '';
let hassUrl = '';
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastAppliedAt = 0;

export const syncStatus = $state({
  inHA: false, // ¿estamos incrustados en el panel de HA (hay token)?
  connected: false, // ¿última operación de red OK?
  enabled: false, // ¿sync activa (polling en marcha)?
  user: null as HAUser | null,
  isAdmin: false,
  shares: [] as ShareInfo[],
  activeShareId: '',
  haLanguage: '' as string, // idioma de HA (p.ej. "en", "de")
  haCountry: '' as string, // país de HA (p.ej. "US", "GB")
  lastSyncAt: 0,
  lastError: '',
  log: [] as string[],
});

function log(msg: string): void {
  const t = new Date().toLocaleTimeString();
  syncStatus.log = [...syncStatus.log.slice(-19), `[${t}] ${msg}`];
  console.log('[sync-ha]', msg);
}

// ─── Token desde el wrapper del panel ───────────────────────────────────

/** Escucha el token que envía tucompra-panel.js y lo pide al arrancar. */
function listenForToken(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || window.parent === window) {
      resolve(false); // no estamos en un iframe → modo local
      return;
    }
    let settled = false;
    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.type !== 'tucompra-token' || !d.token) return;
      token = d.token;
      hassUrl = d.hassUrl || window.location.origin;
      syncStatus.haLanguage = d.language || '';
      syncStatus.haCountry = d.country || '';
      syncStatus.inHA = true;
      if (!settled) {
        settled = true;
        resolve(true);
      }
    };
    window.addEventListener('message', onMessage);
    // Pide el token al padre (por si ya se cargó antes de escuchar).
    try {
      window.parent.postMessage({ type: 'tucompra-request-token' }, '*');
    } catch {}
    // Si en 3s no llega, asumimos modo local.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, 3000);
  });
}

// ─── Fetch autenticado ──────────────────────────────────────────────────

async function api<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${hassUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const msg = `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  syncStatus.connected = true;
  return (await res.json()) as T;
}

// ─── Snapshot (mismo modelo que la versión Supabase) ────────────────────

function buildSnapshot(): SyncSnapshot {
  const { lists, products, stores } = app.state;
  return {
    lists,
    customProducts: products.filter((p) => p.id.startsWith('custom-')),
    customStores: stores.filter((s) => !ALL_SEED_STORE_IDS.has(s.id) || s.edited),
    defaultStores: app.state.defaultStores,
    updatedAt: Date.now(),
  };
}

function applySnapshot(snap: SyncSnapshot): void {
  // Merge de listas lista a lista: gana la versión más reciente por storeId.
  const remoteLists = snap.lists ?? {};
  const merged: Record<string, ShoppingList> = { ...app.state.lists };
  for (const [id, remoteList] of Object.entries(remoteLists)) {
    const local = merged[id];
    if (!local || remoteList.updatedAt > local.updatedAt) merged[id] = remoteList;
  }
  app.state.lists = merged;

  const seedProducts = app.state.products.filter((p) => !p.id.startsWith('custom-'));
  app.state.products = [...seedProducts, ...(snap.customProducts ?? [])];

  const localUntouched = app.state.stores.filter(
    (s) => ALL_SEED_STORE_IDS.has(s.id) && !s.edited,
  );
  app.state.stores = [...localUntouched, ...(snap.customStores ?? [])];

  if (snap.defaultStores) app.state.defaultStores = snap.defaultStores;

  app.persistLocalOnly();
  syncStatus.lastSyncAt = Date.now();
  lastAppliedAt = snap.updatedAt;
  log(`⬇️ Snapshot aplicado (${Object.keys(remoteLists).length} listas)`);
}

// ─── Ciclo de vida ──────────────────────────────────────────────────────

/** Se llama al montar la app. Obtiene token, identidad y shares, y arranca. */
export async function hydrateAuth(): Promise<void> {
  const ok = await listenForToken();
  if (!ok) {
    log('Modo local (fuera de Home Assistant).');
    return;
  }
  try {
    syncStatus.user = await api<HAUser>('/api/tucompra/me');
    syncStatus.isAdmin = !!syncStatus.user?.is_admin;
    log(`👤 ${syncStatus.user?.name}${syncStatus.isAdmin ? ' (admin)' : ''}`);
    await refreshShares();

    // Lista activa por defecto: si el usuario pertenece a alguna lista
    // COMPARTIDA, esa manda (es la del hogar). Solo respetamos la elección
    // guardada si apunta a otra compartida (el usuario cambió entre varias).
    // La personal solo es la predeterminada cuando no hay ninguna compartida.
    let saved = '';
    try { saved = localStorage.getItem(ACTIVE_SHARE_KEY) ?? ''; } catch {}
    const savedValid = !!saved && syncStatus.shares.some((s) => s.id === saved);
    const firstShared = syncStatus.shares.find((s) => s.id.startsWith('shared:'))?.id;

    let active: string;
    if (firstShared) {
      active = savedValid && saved.startsWith('shared:') ? saved : firstShared;
    } else {
      active = savedValid
        ? saved
        : (syncStatus.shares.find((s) => s.id.startsWith('personal:'))?.id
          ?? syncStatus.shares[0]?.id ?? '');
    }
    syncStatus.activeShareId = active;
    try { localStorage.setItem(ACTIVE_SHARE_KEY, active); } catch {}

    await startSync();
  } catch (e) {
    syncStatus.lastError = (e as Error).message;
    log(`❌ hydrateAuth: ${syncStatus.lastError}`);
  }
}

export async function refreshShares(): Promise<void> {
  try {
    const data = await api<{ shares: ShareInfo[] }>('/api/tucompra/shares');
    syncStatus.shares = data.shares ?? [];
  } catch (e) {
    syncStatus.lastError = (e as Error).message;
    log(`❌ refreshShares: ${syncStatus.lastError}`);
  }
}

export async function startSync(): Promise<void> {
  if (!syncStatus.inHA || !syncStatus.activeShareId) return;
  syncStatus.lastError = '';
  await pullOnce();
  await pushNow(); // por si el local es más reciente que el remoto

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { pullOnce().catch(() => {}); }, POLL_MS);
  // Pull también al volver a la pestaña.
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
  }
  syncStatus.enabled = true;
  log(`✅ Sync activa (share: ${syncStatus.activeShareId}).`);
}

function onFocus() {
  if (document.visibilityState !== 'hidden') pullOnce().catch(() => {});
}

export async function stopSync(): Promise<void> {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
  }
  syncStatus.enabled = false;
  log('Sync parada.');
}

async function pullOnce(): Promise<void> {
  if (!syncStatus.activeShareId) return;
  try {
    const data = await api<{ snapshot: SyncSnapshot | null; updatedAt: number }>(
      `/api/tucompra/state?share=${encodeURIComponent(syncStatus.activeShareId)}`,
    );
    if (!data.snapshot) { log('Sin snapshot remoto aún.'); return; }
    const localUpdatedAt = Math.max(
      ...Object.values(app.state.lists).map((l) => l.updatedAt), 0,
    );
    if (data.snapshot.updatedAt > Math.max(localUpdatedAt, lastAppliedAt)) {
      applySnapshot(data.snapshot);
    }
  } catch (e) {
    syncStatus.lastError = (e as Error).message;
    syncStatus.connected = false;
    log(`⚠️ Pull: ${syncStatus.lastError}`);
  }
}

export async function pushNow(): Promise<void> {
  if (!syncStatus.inHA || !syncStatus.activeShareId) return;
  try {
    const snap = buildSnapshot();
    await api(`/api/tucompra/state?share=${encodeURIComponent(syncStatus.activeShareId)}`, {
      method: 'POST',
      body: JSON.stringify({ snapshot: snap, updatedAt: snap.updatedAt }),
    });
    syncStatus.lastSyncAt = Date.now();
  } catch (e) {
    syncStatus.lastError = (e as Error).message;
    syncStatus.connected = false;
    log(`⚠️ Push: ${syncStatus.lastError}`);
  }
}

/** Llamado por app.persist() en cada mutación. Debounce 2s. */
export function schedulePush(): void {
  if (!syncStatus.enabled) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushNow().catch(() => {}); }, 2000);
}

export async function switchShare(shareId: string): Promise<void> {
  await stopSync();
  syncStatus.activeShareId = shareId;
  try { localStorage.setItem(ACTIVE_SHARE_KEY, shareId); } catch {}
  lastAppliedAt = 0;
  await startSync();
}

// ─── Gestión de shares (solo admin) ─────────────────────────────────────

export async function listUsers(): Promise<HAUser[]> {
  const data = await api<{ users: HAUser[] }>('/api/tucompra/users');
  return data.users ?? [];
}

export async function createShare(name: string, memberIds: string[]): Promise<void> {
  await api('/api/tucompra/shares', {
    method: 'POST',
    body: JSON.stringify({ name, members: memberIds }),
  });
  await refreshShares();
}

export async function updateShare(
  id: string,
  patch: { name?: string; members?: string[] },
): Promise<void> {
  await api(`/api/tucompra/shares/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
  await refreshShares();
}

export async function deleteShare(id: string): Promise<void> {
  await api(`/api/tucompra/shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (syncStatus.activeShareId === id) {
    const personal = syncStatus.shares.find((s) => s.id.startsWith('personal:'));
    if (personal) await switchShare(personal.id);
  }
  await refreshShares();
}

/** Compat: en el modelo HA la sync se auto-activa si hay token. */
export function syncWasEnabled(): boolean {
  return true;
}

export interface LookupResult {
  enabled: boolean;
  cached?: boolean;
  found?: boolean;
  name?: string;
  brand?: string;
  quantity?: string;
  categories?: string[];
  image?: string;
  error?: string;
}

/** Traduce un código de barras a producto (Open Food Facts, vía la integración).
 *  Devuelve { enabled: false } si el usuario no ha activado `product_lookup`. */
export async function lookupBarcode(barcode: string): Promise<LookupResult> {
  if (!syncStatus.inHA) return { enabled: false };
  try {
    const query = new URLSearchParams({ barcode, locale: app.state.locale ?? DEFAULT_LOCALE });
    if (syncStatus.activeShareId) query.set('share', syncStatus.activeShareId);
    return await api<LookupResult>(`/api/tucompra/lookup?${query}`);
  } catch (e) {
    log(`⚠️ Lookup: ${(e as Error).message}`);
    return { enabled: true, found: false, error: 'network' };
  }
}

/** Pide al wrapper que abra/cierre la barra lateral de Home Assistant. */
export function toggleHaSidebar(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  try {
    window.parent.postMessage({ type: 'tucompra-toggle-menu' }, '*');
  } catch {}
}
