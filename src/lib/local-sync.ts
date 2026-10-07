import type { AppState, LocalSyncState, PendingField } from './types';
import { buildSnapshot } from './catalog-locale';

const FIELDS: PendingField[] = ['customProducts', 'customStores', 'customCategories', 'defaultStores', 'usage', 'productIcons'];
const value = (field: PendingField, data: ReturnType<typeof buildSnapshot>) =>
  data[field] ?? (field.startsWith('custom') ? [] : {});

/** Revisiones locales, nunca incluidas en el snapshot compartido. */
export function recordLocalChanges(state: AppState, previous: AppState): void {
  const pending = state.localSync ?? { revision: 0, fields: {}, lists: {} };
  const revision = Math.max(pending.revision, previous.localSync?.revision ?? 0) + 1;
  const before = buildSnapshot(previous, 0);
  const after = buildSnapshot(state, 0);
  let changed = false;
  for (const field of FIELDS) {
    if (JSON.stringify(value(field, before)) !== JSON.stringify(value(field, after))) {
      pending.fields[field] = revision;
      changed = true;
    }
  }
  for (const id of new Set([...Object.keys(previous.lists), ...Object.keys(state.lists)])) {
    if (JSON.stringify(previous.lists[id]) !== JSON.stringify(state.lists[id])) {
      pending.lists[id] = revision;
      changed = true;
    }
  }
  if (changed) pending.revision = revision;
  state.localSync = pending;
}

export function pendingAtSend(state: AppState): LocalSyncState {
  const pending = state.localSync ?? { revision: 0, fields: {}, lists: {} };
  return { revision: pending.revision, fields: { ...pending.fields }, lists: { ...pending.lists } };
}

export function acknowledgeChanges(state: AppState, sent: LocalSyncState): void {
  const pending = state.localSync;
  if (!pending) return;
  for (const field of FIELDS) {
    if (pending.fields[field] !== undefined && pending.fields[field]! <= (sent.fields[field] ?? -1)) delete pending.fields[field];
  }
  for (const [id, revision] of Object.entries(pending.lists)) {
    if (revision <= (sent.lists[id] ?? -1)) delete pending.lists[id];
  }
}

export function hasPendingChanges(state: AppState): boolean {
  return !!state.localSync && (Object.keys(state.localSync.fields).length > 0 || Object.keys(state.localSync.lists).length > 0);
}
