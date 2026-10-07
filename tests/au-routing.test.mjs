import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getLocalizedSeed } from '../src/lib/data/locales/index.ts';
import { selectAutomaticMatch } from '../src/lib/search.ts';
import { suggestStoreFor } from '../src/lib/storeRouting.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/au-acceptance.json', import.meta.url), 'utf8'));
const seed = getLocalizedSeed('au');
const executions = fixture.routingCases.flatMap((entry) => [
  entry,
  ...(entry.configuredStoreCase ? [{ ...entry, ...entry.configuredStoreCase }] : []),
  ...(entry.suppliedStructuredPayloadCase ? [{ ...entry.suppliedStructuredPayloadCase,
    request: entry.suppliedStructuredPayloadCase.payload.name, matchingMode: 'name' }] : []),
]);

test('AU routing covers 145 cases, 286 executions, four explicit rows and three supplied payloads', () => {
  assert.equal(fixture.routingCases.length, 145);
  assert.equal(executions.length, 286);
  assert.equal(executions.filter((entry) => entry.matchingMode === 'product-id').length, 4);
  assert.equal(executions.filter((entry) => entry.payload).length, 3);
});

for (const entry of executions) {
  test(`${entry.id}: ${entry.request} (${entry.matchingMode === 'product-id' ? 'explicit row' : 'automatic name'})`, () => {
    const stores = seed.stores.filter((store) => entry.fixture.activeStoreIds.includes(store.id));
    const product = entry.matchingMode === 'product-id'
      ? seed.products.find((candidate) => candidate.id === entry.inputProductId)
      : selectAutomaticMatch(seed.products, entry.request);
    const storeId = product ? suggestStoreFor(product, seed.categories, stores, entry.fixture.defaultStores) ?? null : null;
    const typeId = product ? seed.categories.find((category) => category.id === product.categoryId)?.typeId ?? null : null;
    assert.equal(product?.id ?? null, entry.expectedProductId);
    assert.equal(storeId, entry.expectedStoreId);
    assert.equal(typeId, entry.expectedStoreType);
    assert.equal(storeId ? 'store' : 'inbox', entry.expectedDisposition);
    assert.equal(product ? 'match-existing-product' : 'preserve-raw-request', entry.expectedAction);
    if (entry.expectedPreservedRequest !== undefined) {
      assert.equal(product, null);
      assert.equal(entry.request.trim(), entry.expectedPreservedRequest);
    }
  });
}
