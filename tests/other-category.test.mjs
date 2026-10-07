import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalizedSeed } from '../src/lib/data/locales/index.ts';
import { LOCALES } from '../src/lib/i18n/locale.ts';
import { ensureFallbackCategory } from '../src/lib/categories.ts';

for (const locale of LOCALES) {
  test(`free products reuse stable fallback categories in ${locale}`, () => {
    const { categories, storeTypes } = getLocalizedSeed(locale);
    const before = structuredClone(categories);
    for (const type of storeTypes) {
      const category = ensureFallbackCategory(categories, type.id);
      assert.equal(category.typeId, type.id);
      assert.ok(before.some((c) => c.id === category.id));
      assert.equal(ensureFallbackCategory(categories, type.id), category);
    }
    assert.deepEqual(categories, before);
    assert.equal(ensureFallbackCategory(categories, 'otros').id, 'otr-otros');
  });
}

test('a custom category is preserved when the seeded fallback exists', () => {
  const { categories } = getLocalizedSeed('en');
  const custom = { id: 'custom-category', typeId: 'supermercado', name: 'Otros', icon: { kind: 'emoji', value: '⭐' } };
  categories.unshift(custom);
  assert.equal(ensureFallbackCategory(categories, 'supermercado').id, 'sup-otros');
  assert.equal(categories[0], custom);
});

test('custom store types reuse their existing category and create only one fallback', () => {
  const { categories } = getLocalizedSeed('fr');
  const custom = { id: 'custom-gifts', typeId: 'gifts', name: 'Otros', icon: { kind: 'emoji', value: '🎁' } };
  categories.push(custom);
  assert.equal(ensureFallbackCategory(categories, 'gifts'), custom);
  const count = categories.length;
  const created = ensureFallbackCategory(categories, 'custom-type');
  assert.equal(created.typeId, 'custom-type');
  assert.equal(created.name, categories.find((c) => c.id === 'otr-otros').name);
  created.name = 'My custom fallback';
  assert.equal(ensureFallbackCategory(categories, 'custom-type'), created);
  assert.equal(categories.length, count + 1);
});
