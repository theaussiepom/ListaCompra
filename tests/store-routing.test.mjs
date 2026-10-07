import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getDefaultStore, suggestStoreFor } from '../src/lib/storeRouting.ts';
import { getLocalizedSeed } from '../src/lib/data/locales/index.ts';
import { LOCALES } from '../src/lib/i18n/locale.ts';

const cases = JSON.parse(readFileSync(new URL('./fixtures/store-routing.json', import.meta.url), 'utf8'));
const categories = [{ id: 'dairy', typeId: 'market' }];

for (const fixture of cases) {
  for (const id of ['seed-test', 'custom-test']) {
    test(`${id}: ${fixture.name}`, () => {
      const product = {
        id,
        categoryId: fixture.unknownCategory ? 'unknown' : 'dairy',
        ...(fixture.exclusive ? { storeId: fixture.exclusive } : {}),
      };
      assert.equal(
        suggestStoreFor(product, categories, fixture.stores, fixture.defaults) ?? null,
        fixture.expected,
      );
      if (!fixture.exclusive) {
        assert.equal(getDefaultStore('market', fixture.stores, fixture.defaults) ?? null, fixture.expected);
      }
    });
  }
}

for (const locale of LOCALES) {
  test(`${locale}: defaults respect the existing catalogue types`, () => {
    const seed = getLocalizedSeed(locale);
    for (const type of seed.storeTypes) {
      const matching = seed.stores.filter((s) => s.typeId === type.id && s.enabled !== false);
      const other = seed.stores.find((s) => s.typeId !== type.id);
      assert.equal(
        getDefaultStore(type.id, seed.stores, other ? { [type.id]: other.id } : {}),
        matching.length === 1 ? matching[0].id : undefined,
      );
      for (const store of matching) {
        assert.equal(getDefaultStore(type.id, seed.stores, { [type.id]: store.id }), store.id);
      }
    }
  });
}
