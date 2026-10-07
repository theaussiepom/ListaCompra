import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rankMatches, rankScoredMatches, selectAutomaticMatch } from '../src/lib/search.ts';
import { exportProduct } from '../scripts/catalog-product.ts';
import { mk } from '../src/lib/data/locales/products/_mk.ts';
import { createInitialState, loadState, saveState } from '../src/lib/storage.ts';

const cases = JSON.parse(readFileSync(new URL('./fixtures/product-aliases.json', import.meta.url), 'utf8'));

for (const fixture of cases) {
  test(fixture.name, () => {
    for (const products of [fixture.products, [...fixture.products].reverse()]) {
      assert.deepEqual(rankScoredMatches(products, fixture.query).map(({ score, source, it }) => [score, source, it.id]), fixture.matches);
      assert.deepEqual(rankMatches(products, fixture.query).map((p) => p.id), fixture.matches.map(([, , id]) => id));
      assert.equal(selectAutomaticMatch(products, fixture.query)?.id ?? null, fixture.automatic);
    }
  });
}

test('export retains aliases and excludes research metadata', () => {
  const product = mk('test')('coffee', 'Coffee', 'food', '☕', 'unidad', ['Café']);
  assert.deepEqual(exportProduct({ ...product, rationale: 'test only' }), {
    id: 'test-coffee', name: 'Coffee', categoryId: 'food', defaultUnit: 'unidad', aliases: ['Café'],
  });
  assert.equal('aliases' in exportProduct(mk('test')('milk', 'Milk', 'food', '🥛')), false);
});

test('local storage preserves optional aliases and legacy products', () => {
  const previous = globalThis.localStorage;
  let saved;
  globalThis.localStorage = { setItem: (_key, value) => { saved = value; }, getItem: () => saved };
  try {
    const state = createInitialState();
    state.products = [mk('custom')('coffee', 'Coffee', 'food', '☕', 'unidad', ['Café']),
      mk('custom')('milk', 'Milk', 'food', '🥛')];
    saveState(state);
    assert.deepEqual(loadState().products, state.products);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});
