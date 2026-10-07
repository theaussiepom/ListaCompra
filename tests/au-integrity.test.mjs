import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LOCALES } from '../src/lib/i18n/locale.ts';
import { getLocalizedSeed, LOCALIZED_PRODUCTS, LOCALIZED_STORES } from '../src/lib/data/locales/index.ts';
import { validateProducts } from '../src/lib/productConcept.ts';
import { exportProducts } from '../scripts/catalog-product.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/au-acceptance.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(readFileSync(new URL('../custom_components/tucompra/catalog.json', import.meta.url), 'utf8'));
const products = LOCALIZED_PRODUCTS.au;
const stores = LOCALIZED_STORES.au;
const seed = getLocalizedSeed('au');
const hash = value => createHash('sha256').update(value).digest('hex');
// Las claves no cambian el contrato; el orden de los arrays sí.
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const contentHash = value => hash(JSON.stringify(canonical(value)));
const aliasPairs = items => items.flatMap(p => (p.aliases ?? []).map(term => ({ term, productId: p.id })));
const orderedPairs = pairs => pairs.map(p => `${p.productId}\0${p.term}`).sort();

test('AU registers exactly seven locales and preserves the full reviewed Product array', () => {
  assert.deepEqual(LOCALES, ['es', 'en', 'us', 'fr', 'de', 'br', 'au']);
  assert.deepEqual(Object.keys(catalog.locales), LOCALES);
  assert.equal(products.length, 1518);
  assert.equal(contentHash(products), fixture.productsSha256, 'complete native Product fields and array order');
  assert.equal(hash(JSON.stringify(products.map(p => p.id))), fixture.integrity.sourceProductOrderSha256);
  assert.equal(new Set(products.map(p => p.id)).size, 1518);
});

test('AU canonical prefix and mirror suffix exactly match the 233 reviewed relationships', () => {
  const mirrors = products.filter(p => p.mirrorOf !== undefined);
  assert.equal(mirrors.length, 233);
  assert(products.slice(0, 1285).every(p => p.mirrorOf === undefined));
  assert(products.slice(1285).every(p => p.mirrorOf !== undefined));
  assert.deepEqual(mirrors.map(p => ({ productId: p.id, canonicalProductId: p.mirrorOf })), fixture.integrity.mirrorRelationships);
  assert.doesNotThrow(() => validateProducts(products));
  const byId = new Map(products.map(p => [p.id, p]));
  for (const p of mirrors) {
    assert.notEqual(p.mirrorOf, p.id, p.id);
    assert(byId.has(p.mirrorOf), p.id);
    assert.equal(byId.get(p.mirrorOf).mirrorOf, undefined, p.id);
    assert.equal(p.aliases, undefined, p.id);
  }
});

test('AU products contain only native configured fields, valid categories and units', () => {
  const categories = new Set(seed.categories.map(c => c.id));
  const fields = new Set(fixture.integrity.supportedProductFields);
  const units = new Set(fixture.integrity.supportedUnits);
  for (const p of products) {
    assert(Object.keys(p).every(key => fields.has(key)), p.id);
    assert(categories.has(p.categoryId), p.id);
    assert(units.has(p.defaultUnit), p.id);
    assert.equal(p.barcode, undefined, p.id);
    assert.equal(p.icon.kind, 'emoji', p.id);
  }
});

test('AU aliases exactly reconcile to 450 safe mappings and exclude all 213 deferred pairs', () => {
  const actual = aliasPairs(products);
  assert.equal(actual.length, 450);
  assert.equal(products.filter(p => p.aliases?.length).length, 254);
  assert.deepEqual(orderedPairs(actual), orderedPairs(fixture.aliases.runtimeSafe));
  const emitted = new Set(orderedPairs(actual));
  assert.equal(fixture.aliases.deferred.length, 213);
  for (const pair of orderedPairs(fixture.aliases.deferred)) assert(!emitted.has(pair), pair);
  for (const p of products.filter(p => p.aliases?.length)) assert.equal(p.mirrorOf, undefined, p.id);
});

test('AU emits exactly the nine reviewed active stores and no deferred candidates', () => {
  assert.deepEqual(stores, fixture.stores.active);
  assert.equal(stores.length, 9);
  assert.equal(fixture.stores.deferredIds.length, 48);
  const emitted = new Set(stores.map(s => s.id));
  for (const id of fixture.stores.deferredIds) assert(!emitted.has(id), id);
  assert(!emitted.has('au-kmart'));
  assert(!emitted.has('au-ikea'));
  assert(stores.every(s => s.enabled === true));
});

test('AU effective labels exactly cover all 14 store types and 75 categories', () => {
  const labels = {
    storeTypes: Object.fromEntries(seed.storeTypes.map(t => [t.id, t.name])),
    categories: Object.fromEntries(seed.categories.map(c => [c.id, c.name])),
  };
  assert.equal(Object.keys(labels.storeTypes).length, 14);
  assert.equal(Object.keys(labels.categories).length, 75);
  assert.deepEqual(labels, fixture.labels);
});

test('AU backend export preserves all products, aliases, mirrors and active stores', () => {
  assert.deepEqual(catalog.locales.au.products, exportProducts(products));
  assert.equal(contentHash(catalog.locales.au.products), fixture.exportedProductsSha256);
  assert.equal(catalog.locales.au.products.filter(p => p.mirrorOf !== undefined).length, 233);
  assert.deepEqual(orderedPairs(aliasPairs(catalog.locales.au.products)), orderedPairs(fixture.aliases.runtimeSafe));
  assert.deepEqual(catalog.locales.au.stores, stores.map(({ id, name, typeId, order }) => ({ id, name, typeId, ...(order !== undefined ? { order } : {}) })));
});

for (const [locale, expected] of Object.entries(fixture.existingLocaleBlockSha256)) {
  test(`AU leaves the ${locale} export block byte-for-byte unchanged from the foundation`, () => {
    assert.equal(hash(JSON.stringify(catalog.locales[locale])), expected);
  });
}
