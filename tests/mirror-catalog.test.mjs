import assert from 'node:assert/strict';
import test from 'node:test';
import { applySnapshot, buildSnapshot, catalogReferences, refreshCatalog } from '../src/lib/catalog-locale.ts';
import { createInitialState, loadState, saveState } from '../src/lib/storage.ts';
import { getLocalizedSeed } from '../src/lib/data/locales/index.ts';

const icon = { kind: 'emoji', value: '📦' };
const product = (id, name, categoryId, extra = {}) => ({ id, name, categoryId, icon, defaultUnit: 'unidad', ...extra });
const category = (id, typeId) => ({ id, name: id, typeId, icon });
const list = (productId) => ({ storeId: 'inbox', items: [{ id: 'line', productId, qty: 1, unit: 'unidad', done: false, addedAt: 1 }], updatedAt: 1 });
const emptySnapshot = { catalogLocale: 'en', lists: {}, customProducts: [], customStores: [], customCategories: [], defaultStores: {}, usage: {}, productIcons: {}, updatedAt: 100 };

// Simula una versión futura del seed sin añadir datos de producción.
function withSeedMirror(run) {
  const seed = getLocalizedSeed('fr');
  const canonical = seed.products[0];
  const mirror = seed.products[1];
  const originals = [{ ...canonical }, { ...mirror }];
  Object.assign(canonical, { name: 'Canonical concept', storeId: seed.stores[0].id });
  Object.assign(mirror, { name: 'Specialist concept', mirrorOf: canonical.id });
  try { run({ canonical, mirror, store: seed.stores[0] }); }
  finally {
    for (const [item, old] of [[canonical, originals[0]], [mirror, originals[1]]]) {
      for (const key of Object.keys(item)) delete item[key];
      Object.assign(item, old);
    }
  }
}

function pendingState(field = 'lists') {
  const canonical = product('custom-canonical', 'Canonical concept', 'custom-market-category', { storeId: 'custom-market' });
  const mirror = product('custom-mirror', 'Specialist concept', 'custom-specialist-category', { mirrorOf: canonical.id });
  const state = refreshCatalog(createInitialState(), 'en');
  state.products.push(canonical, mirror);
  state.categories.push(category(canonical.categoryId, 'supermercado'), category(mirror.categoryId, 'carniceria'));
  state.stores.push({ id: canonical.storeId, name: 'Private market', typeId: 'supermercado', icon });
  state.localSync = { revision: 1, fields: {}, lists: {} };
  if (field === 'lists') {
    state.lists.inbox = list(mirror.id);
    state.localSync.lists.inbox = 1;
  } else {
    state.localSync.fields[field] = 1;
    if (field === 'productIcons') state.productIcons = { [mirror.id]: icon };
    if (field === 'usage') state.usage = { inbox: { [mirror.id]: 2 } };
  }
  return { state, canonical, mirror };
}

function assertDependencies(state, canonical, mirror) {
  assert(state.products.some(p => p.id === mirror.id), 'mirror survives');
  assert(state.products.some(p => p.id === canonical.id), 'canonical survives');
  assert(state.categories.some(c => c.id === canonical.categoryId), 'canonical category survives');
  assert(state.stores.some(s => s.id === canonical.storeId), 'canonical exclusive store survives');
}

test('referenced foreign seed mirror keeps its direct canonical and store through reload and another client', () => {
  withSeedMirror(({ canonical, mirror, store }) => {
    const state = refreshCatalog(createInitialState(), 'en');
    state.lists.inbox = list(mirror.id);
    const refreshed = refreshCatalog(state);
    assertDependencies(refreshed, canonical, mirror);
    const snapshot = JSON.parse(JSON.stringify(buildSnapshot(refreshed, 20)));
    assert(snapshot.retainedProducts.some(p => p.id === canonical.id));
    assert(snapshot.retainedProducts.some(p => p.id === mirror.id));
    const other = applySnapshot({ ...createInitialState(), locale: 'de' }, snapshot);
    assertDependencies(other, canonical, mirror);
    assert(other.stores.some(s => s.id === store.id));
    const cache = new Map();
    const previous = globalThis.localStorage;
    globalThis.localStorage = { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
    try {
      saveState(other);
      assertDependencies(refreshCatalog(loadState()), canonical, mirror);
    } finally {
      if (previous === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previous;
    }
  });
});

test('an unlisted custom mirror keeps its foreign canonical dependency', () => {
  withSeedMirror(({ canonical }) => {
    const state = refreshCatalog(createInitialState(), 'en');
    const mirror = product('custom-unlisted-mirror', 'Unlisted specialist', 'otr-otros', { mirrorOf: canonical.id });
    state.products.push(mirror);
    const next = refreshCatalog(state);
    assertDependencies(next, canonical, mirror);
    assertDependencies(applySnapshot(createInitialState(), buildSnapshot(next)), canonical, mirror);
  });
});

for (const field of ['lists', 'usage', 'productIcons', 'customProducts']) {
  test(`pending mirror ${field} keeps canonical, category and exclusive store after authoritative metadata clearing`, () => {
    const { state, canonical, mirror } = pendingState(field);
    const next = applySnapshot(state, emptySnapshot);
    assertDependencies(next, canonical, mirror);
    assertDependencies(applySnapshot(createInitialState(), buildSnapshot(next, 200)), canonical, mirror);
  });
}

test('pending mirror does not restore a locally deleted canonical product', () => {
  const { state, canonical, mirror } = pendingState();
  state.products = state.products.filter(p => p.id !== canonical.id);
  const next = applySnapshot(state, emptySnapshot);
  assert(next.products.some(p => p.id === mirror.id));
  assert(!next.products.some(p => p.id === canonical.id));
  assert(!next.stores.some(s => s.id === canonical.storeId));
});

for (const kind of ['chain', 'cycle', 'self', 'missing']) {
  test(`invalid ${kind} mirror metadata does not create retained dependency references`, () => {
    const canonical = product('custom-canonical', 'Canonical', 'otr-otros', { storeId: 'unreferenced-store' });
    const mirror = product('custom-mirror', 'Mirror', 'otr-otros', { mirrorOf: canonical.id });
    if (kind === 'chain') canonical.mirrorOf = 'custom-end';
    if (kind === 'cycle') canonical.mirrorOf = mirror.id;
    if (kind === 'self') mirror.mirrorOf = mirror.id;
    if (kind === 'missing') mirror.mirrorOf = 'missing';
    const refs = catalogReferences({ products: [canonical, mirror, product('custom-end', 'End', 'otr-otros')], lists: { inbox: list(mirror.id) } });
    assert(!refs.products.has(canonical.id));
  });
}

for (const kind of ['chain', 'cycle']) {
  test(`pending mirror never restores a remotely cleared ${kind}`, () => {
    const { state, canonical, mirror } = pendingState();
    canonical.mirrorOf = kind === 'chain' ? 'custom-end' : mirror.id;
    state.products.push(product('custom-end', 'Terminal', 'otr-otros'));
    const next = applySnapshot(state, emptySnapshot);
    assert(next.products.some(p => p.id === mirror.id));
    assert(!next.products.some(p => p.id === canonical.id));
    assert(!next.products.some(p => p.id === 'custom-end'));
    assert(!next.stores.some(s => s.id === canonical.storeId));
  });
}

test('an explicit retained seed mirror records its direct canonical dependency', () => {
  withSeedMirror(({ canonical, mirror }) => {
    const refs = catalogReferences({ retainedProducts: [mirror] });
    assert(refs.products.has(canonical.id));
    assert(refs.stores.has(canonical.storeId));
  });
});
