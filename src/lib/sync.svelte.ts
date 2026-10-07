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
import { applySnapshot as mergeSnapshot, buildSnapshot as snapshotFromState, type SyncSnapshot } from './catalog-locale';
import { createInitialState, loadShareState, saveShareState } from './storage';
import { acknowledgeChanges, hasPendingChanges, pendingAtSend } from './local-sync';
import { DEFAULT_LOCALE } from './i18n/locale';

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
let hasAppliedSnapshot = false;
let sessionVersion = 0;
let sessionShare = '';
let activeCycle: { session: number; promise: Promise<void> } | null = null;
let activePush: { session: number; promise: Promise<boolean> } | null = null;
let lastPushedAt = 0;

export const syncStatus = $state({
  inHA: false, // ¿estamos incrustados en el panel de HA (hay token)?
  connected: false, // ¿última operación de red OK?
  enabled: false, // Transporte activo, incluso mientras reintenta.
  authoritative: false, // Solo una lectura válida habilita los envíos.
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
  lastPushedAt = Math.max(Date.now(), lastAppliedAt + 1, lastPushedAt + 1);
  return snapshotFromState(app.state, lastPushedAt);
}

function applySnapshot(snap: SyncSnapshot): void {
  app.state = mergeSnapshot(app.state, snap, !hasAppliedSnapshot && snap.updatedAt === 0);
  app.persistLocalOnly();
  syncStatus.lastSyncAt = Date.now();
  lastAppliedAt = snap.updatedAt;
  hasAppliedSnapshot = true;
  log(`⬇️ Snapshot aplicado (${Object.keys(snap.lists ?? {}).length} listas)`);
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
    if (saved && saved !== active) {
      saveShareState(saved, app.state);
      const { profile, locale } = app.state;
      app.state = { ...(loadShareState(active) ?? createInitialState()), profile, locale };
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

function isCurrentSession(session: number): boolean {
  return session === sessionVersion && syncStatus.enabled && sessionShare === syncStatus.activeShareId;
}

export async function startSync(): Promise<void> {
  if (!syncStatus.inHA || !syncStatus.activeShareId) return;
  const session = sessionVersion + 1;
  await stopSync();
  if (session !== sessionVersion) return;
  sessionShare = syncStatus.activeShareId;
  hasAppliedSnapshot = false;
  lastAppliedAt = 0;
  syncStatus.lastError = '';
  syncStatus.enabled = true;
  pollTimer = setInterval(() => synchronize(session), POLL_MS);
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
  }
  await synchronize(session);
}

function synchronize(session: number): Promise<void> {
  if (!isCurrentSession(session)) return Promise.resolve();
  if (activeCycle?.session === session) return activeCycle.promise;
  const promise = (async () => {
    const needsInitialPush = !syncStatus.authoritative;
    if (!await pullOnce(session) || !isCurrentSession(session)) return;
    syncStatus.authoritative = true;
    if (needsInitialPush || hasPendingChanges(app.state)) await pushNow();
  })().finally(() => {
    if (activeCycle?.session === session) activeCycle = null;
  });
  activeCycle = { session, promise };
  return promise;
}

function onFocus(): Promise<void> | undefined {
  if (document.visibilityState !== 'hidden') return synchronize(sessionVersion);
}

export async function stopSync(): Promise<void> {
  sessionVersion++;
  syncStatus.authoritative = false;
  syncStatus.enabled = false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
  }
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
  log('Sync parada.');
}

async function pullOnce(session: number): Promise<boolean> {
  const shareId = sessionShare;
  if (!isCurrentSession(session)) return false;
  try {
    const data = await api<{ snapshot: SyncSnapshot | null; updatedAt: number }>(
      `/api/tucompra/state?share=${encodeURIComponent(shareId)}${app.state.catalogLocale ? `&legacyLocale=${app.state.catalogLocale}` : ''}`,
    );
    if (!isCurrentSession(session)) return false;
    if (!data.snapshot) { log('Sin snapshot remoto aún.'); return false; }
    if (data.snapshot.catalogLocale !== app.state.catalogLocale || !hasAppliedSnapshot || data.snapshot.updatedAt > lastAppliedAt) {
      applySnapshot(data.snapshot);
    }
    syncStatus.lastError = '';
    return true;
  } catch (e) {
    if (!isCurrentSession(session)) return false;
    syncStatus.lastError = (e as Error).message;
    syncStatus.connected = false;
    log(`⚠️ Pull: ${syncStatus.lastError}`);
    return false;
  }
}

export function pushNow(): Promise<boolean> {
  const session = sessionVersion;
  if (!syncStatus.inHA || !isCurrentSession(session) || !syncStatus.authoritative) return Promise.resolve(false);
  const previous = activePush?.session === session ? activePush.promise : null;
  const promise = (previous ? previous.then(() => performPush(session)) : performPush(session)).finally(() => {
    if (activePush?.promise === promise) activePush = null;
  });
  activePush = { session, promise };
  return promise;
}

async function performPush(session: number): Promise<boolean> {
  const shareId = sessionShare;
  if (!isCurrentSession(session) || !syncStatus.authoritative) return false;
  try {
    const sent = pendingAtSend(app.state);
    const snap = buildSnapshot();
    const result = await api<{ ok: boolean; updatedAt: number }>(`/api/tucompra/state?share=${encodeURIComponent(shareId)}`, {
      method: 'POST',
      body: JSON.stringify({ snapshot: snap, updatedAt: snap.updatedAt }),
    });
    if (!isCurrentSession(session)) return false;
    if (!result.ok || result.updatedAt !== snap.updatedAt) {
      syncStatus.authoritative = false;
      return false;
    }
    lastAppliedAt = Math.max(lastAppliedAt, result.updatedAt);
    acknowledgeChanges(app.state, sent);
    app.persistLocalOnly();
    syncStatus.lastSyncAt = Date.now();
    return true;
  } catch (e) {
    if (!isCurrentSession(session)) return false;
    syncStatus.authoritative = false;
    syncStatus.lastError = (e as Error).message;
    syncStatus.connected = false;
    log(`⚠️ Push: ${syncStatus.lastError}`);
    return false;
  }
}

/** Llamado por app.persist() en cada mutación. Debounce 2s. */
export function schedulePush(): void {
  const session = sessionVersion;
  if (!isCurrentSession(session) || !syncStatus.authoritative) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    if (isCurrentSession(session)) pushNow().catch(() => {});
  }, 2000);
}

export async function switchShare(shareId: string): Promise<void> {
  const previousShare = syncStatus.activeShareId;
  const previousSession = sessionVersion;
  if (shareId === previousShare || !await pushNow()) return;
  try {
    const data = await api<{ snapshot: SyncSnapshot | null }>(
      `/api/tucompra/state?share=${encodeURIComponent(shareId)}`,
    );
    if (!data.snapshot || !isCurrentSession(previousSession) || syncStatus.activeShareId !== previousShare) return;
    const stoppedSession = previousSession + 1;
    await stopSync();
    if (sessionVersion !== stoppedSession || syncStatus.activeShareId !== previousShare) return;
    saveShareState(previousShare, app.state);
    const { profile, locale } = app.state;
    app.state = { ...(loadShareState(shareId) ?? createInitialState()), profile, locale };
    syncStatus.activeShareId = shareId;
    hasAppliedSnapshot = false;
    applySnapshot(data.snapshot);
    try { localStorage.setItem(ACTIVE_SHARE_KEY, shareId); } catch {}
    await startSync();
  } catch (e) {
    syncStatus.lastError = (e as Error).message;
    log(`⚠️ Share: ${syncStatus.lastError}`);
  }
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
  if (syncStatus.activeShareId === id) {
    const personal = syncStatus.shares.find((s) => s.id.startsWith('personal:') && s.id !== id);
    if (!personal) return;
    await switchShare(personal.id);
    if (syncStatus.activeShareId === id) return;
  }
  await api(`/api/tucompra/shares/${encodeURIComponent(id)}`, { method: 'DELETE' });
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
    const query = new URLSearchParams({ barcode, locale: app.state.catalogLocale ?? app.state.locale ?? DEFAULT_LOCALE });
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
