import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import test, { after } from 'node:test';
import { applySnapshot, buildSnapshot, refreshCatalog } from '../src/lib/catalog-locale.ts';
import { getLocalizedSeed } from '../src/lib/data/locales/index.ts';
import { LOCALES, LOCALE_LABEL, LOCALE_FLAG, countryToFlag, resolveLocale, resolveLocaleFromBrowser } from '../src/lib/i18n/locale.ts';
import { translate } from '../src/lib/i18n/ui.ts';
import { createInitialState, loadState, saveState } from '../src/lib/storage.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/au-acceptance.json', import.meta.url), 'utf8'));
const results = [];

function saveAndReload(state) {
  const previous = globalThis.localStorage;
  const cache = new Map();
  globalThis.localStorage = { getItem: key => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) };
  try {
    saveState(state);
    return refreshCatalog(loadState(), 'au');
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
}

function assertReferences(state, lists) {
  assert.deepEqual(state.lists, lists);
  for (const [storeId, list] of Object.entries(lists)) {
    assert(state.stores.some(store => store.id === storeId), `${storeId} retained`);
    for (const item of list.items) assert(state.products.some(product => product.id === item.productId), `${item.productId} retained`);
  }
}

for (const example of fixture.localeCases) {
  test(`${example.id}: ${example.testLayer}`, () => {
    const input = structuredClone(example.input);
    const before = structuredClone(input);
    const browser = example.testLayer === 'browser-locale-selection';
    const detected = browser ? resolveLocaleFromBrowser(input.browserLanguage) : resolveLocale(input.language, input.country);
    let state = { ...createInitialState(), locale: detected };
    if (example.testLayer === 'populated-share-catalogue-identity') {
      const previous = input.existingReferences;
      state.lists = structuredClone(previous.lists);
      state.products.push(...previous.customProducts);
      state.stores.push(...previous.customStores);
      state.defaultStores = structuredClone(previous.defaultStores);
    } else if (example.testLayer === 'explicit-share-catalogue-authority') {
      state = { ...state, ...getLocalizedSeed(input.catalogLocale), catalogLocale: input.catalogLocale };
      if (input.shareState === 'populated') {
        const store = state.stores[0];
        const product = state.products[0];
        state.lists[store.id] = { storeId: store.id, items: [{ id: example.id, productId: product.id,
          qty: 1, unit: product.defaultUnit, done: false, addedAt: 1 }], updatedAt: 1 };
      }
    } else {
      assert.equal(detected, example.expectedCatalogLocale, 'detected locale');
    }
    const originalLists = structuredClone(state.lists);
    const pinned = refreshCatalog(state, detected);
    assert.equal(pinned.catalogLocale, example.expectedCatalogLocale, 'initial catalogue pin');
    assertReferences(pinned, originalLists);
    const reloaded = saveAndReload(pinned);
    assert.equal(reloaded.catalogLocale, example.expectedCatalogLocale, 'persisted pin after reload on AU host');
    assertReferences(reloaded, originalLists);
    const snapshot = JSON.parse(JSON.stringify(buildSnapshot(reloaded, 10)));
    const other = applySnapshot({ ...createInitialState(), locale: 'de' }, snapshot);
    assert.equal(other.catalogLocale, example.expectedCatalogLocale, 'shared pin on another client');
    assert.equal(other.locale, 'de', 'display language stays independent');
    assertReferences(other, originalLists);
    assert.deepEqual(input, before, 'source fixture is unchanged');
    results.push({ id: example.id, layer: example.testLayer, expected: example.expectedCatalogLocale,
      actual: pinned.catalogLocale, reloaded: reloaded.catalogLocale, secondClient: other.catalogLocale, referencesUnchanged: true });
  });
}

after(() => {
  const output = process.env.TUCOMPRA_AU_LOCALE_EVIDENCE;
  if (output) writeFileSync(output, JSON.stringify({ executed: results.length, mismatches: results.filter(row => row.actual !== row.expected), cases: results }, null, 2));
});

test('AU is registered with Australia label, AU flag and shared English interface', () => {
  assert.deepEqual(LOCALES, ['es', 'en', 'us', 'fr', 'de', 'br', 'au']);
  assert.equal(LOCALE_LABEL.au, 'Australia');
  assert.equal(LOCALE_FLAG.au, countryToFlag('AU'));
  assert.equal(LOCALE_FLAG.au, '🇦🇺');
  for (const key of ['nav.stores', 'nav.greeting', 'nav.catalogHint', 'setup.title', 'stores.add', 'list.search', 'list.scan']) {
    assert.equal(translate('au', key, { name: 'Sam', label: 'Australia' }), translate('en', key, { name: 'Sam', label: 'Australia' }));
  }
});

test('every explicit catalogue remains authoritative on an Australian host', () => {
  for (const catalogLocale of LOCALES) {
    const state = refreshCatalog({ ...createInitialState(), catalogLocale, locale: 'au' }, 'au');
    assert.equal(state.catalogLocale, catalogLocale);
    assert.equal(saveAndReload(state).catalogLocale, catalogLocale);
  }
});
