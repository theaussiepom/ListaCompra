import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rankMatches, selectAutomaticMatch } from '../src/lib/search.ts';
import * as catalogExport from '../scripts/catalog-product.ts';
import { validateProducts } from '../src/lib/productConcept.ts';
import { mk } from '../src/lib/data/locales/products/_mk.ts';
import { createInitialState, loadState, saveState } from '../src/lib/storage.ts';

const cases = JSON.parse(readFileSync(new URL('./fixtures/product-mirrors.json', import.meta.url), 'utf8'));
for (const fixture of cases) {
  test(`mirror: ${fixture.name}`, () => {
    for (const products of [fixture.products, [...fixture.products].reverse()]) {
      assert.equal(selectAutomaticMatch(products, fixture.query)?.id ?? null, fixture.automatic);
      if (fixture.ranked) assert.deepEqual(rankMatches(products, fixture.query).map((p) => p.id), fixture.ranked);
    }
  });
  test(`export validation: ${fixture.name}`, () => {
    const run = () => catalogExport.exportProducts(fixture.products);
    if (fixture.valid) assert.doesNotThrow(run);
    else assert.throws(run, /Invalid mirrorOf|Duplicate product ID/);
    if (fixture.products.some((product) => product.mirrorOf !== undefined)) {
      if (fixture.valid) assert.deepEqual(catalogExport.exportSeedProducts(fixture.products), run());
      else assert.throws(() => catalogExport.exportSeedProducts(fixture.products), /Invalid mirrorOf|Duplicate product ID/);
    }
  });
}

test('export retains native mirrorOf only and never copies canonical aliases', () => {
  const canonical = mk('test')('coffee', 'Coffee', 'market', '☕', 'kg', ['Morning drink']);
  const mirror = mk('test')('specialist-coffee', 'Coffee', 'specialist', '🫖', 'g', undefined, canonical.id);
  assert.equal(mirror.mirrorOf, canonical.id);
  const exported = catalogExport.exportProducts([canonical, { ...mirror, storeId: 'specialist', research: 'not runtime' }]);
  assert.deepEqual(exported, [
    { id: canonical.id, name: 'Coffee', categoryId: 'market', defaultUnit: 'kg', aliases: ['Morning drink'] },
    { id: mirror.id, name: 'Coffee', categoryId: 'specialist', defaultUnit: 'g', storeId: 'specialist', mirrorOf: canonical.id },
  ]);
  assert.equal('mirrorOf' in catalogExport.exportProduct(canonical), false);
  assert.equal('aliases' in exported[1], false);
});

test('each exported locale must contain its own canonical target', () => {
  assert.throws(() => catalogExport.exportProducts([{ id: 'mirror', name: 'Coffee', mirrorOf: 'foreign-canonical' }]), /Invalid mirrorOf/);
});

test('catalogue IDs must be nonempty and unique even without mirrors', () => {
  for (const id of [undefined, '', ' ', null, 7]) assert.throws(() => validateProducts([{ id }]), /Product ID/);
  assert.throws(() => validateProducts([{ id: 'same' }, { id: 'same' }]), /Duplicate product ID/);
});

test('legacy seed projection is unchanged until mirror metadata requires strict IDs', () => {
  const legacy = [{ id: 'legacy', name: 'Tea', categoryId: 'drinks' }, { id: 'legacy', name: 'Tea', categoryId: 'specialist' }];
  assert.deepEqual(catalogExport.exportSeedProducts(legacy), legacy.map(catalogExport.exportProduct));
  assert.throws(() => catalogExport.exportSeedProducts([...legacy, { id: 'mirror', name: 'Tea', mirrorOf: 'legacy' }]), /Duplicate product ID/);
});

test('storage retains mirror identity and row-specific category, store, icon and unit', () => {
  const previous = globalThis.localStorage;
  let saved;
  globalThis.localStorage = { setItem: (_key, value) => { saved = value; }, getItem: () => saved };
  try {
    const state = createInitialState();
    state.products = [mk('test')('canonical', 'Coffee', 'market', '☕', 'kg'),
      { ...mk('test')('mirror', 'Specialty coffee', 'specialist', '🫖', 'g', undefined, 'test-canonical'), storeId: 'specialist' }];
    saveState(state);
    assert.deepEqual(loadState().products, state.products);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
