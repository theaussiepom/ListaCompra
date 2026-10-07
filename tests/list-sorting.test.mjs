import assert from 'node:assert/strict';
import test from 'node:test';
import { createListComparators } from '../src/lib/listSorting.ts';
import { ensureFallbackCategory, isFallbackCategory } from '../src/lib/categories.ts';
import { getLocalizedSeed } from '../src/lib/data/locales/index.ts';
import { LOCALES } from '../src/lib/i18n/locale.ts';

for (const locale of LOCALES) {
  test(`translated fallback category sorts last in ${locale}`, () => {
    const categories = getLocalizedSeed(locale).categories.filter((c) => c.typeId === 'supermercado');
    const original = structuredClone(categories);
    const sorted = categories.slice().sort(createListComparators(locale).byCategory);
    assert.equal(sorted.at(-1).id, 'sup-otros');
    assert.deepEqual(categories, original);
  });

  test(`name sorting follows ${locale} display collation`, () => {
    const sorting = createListComparators(locale);
    const expected = locale === 'es' ? ['nz', 'ño'] : ['ño', 'nz'];
    assert.deepEqual(['ño', 'nz'].sort(sorting.compareNames), expected);
    assert.deepEqual([{ name: 'ño' }, { name: 'nz' }].sort(sorting.byName).map((p) => p.name), expected);
    assert.equal(sorting.compareNames('CAFE', 'café'), 0);
  });
}

test('fallback semantics follow stable identity after renaming, not translated labels', () => {
  const categories = getLocalizedSeed('en').categories;
  const fallback = { ...ensureFallbackCategory(categories, 'supermercado'), name: 'A renamed section' };
  const custom = { id: 'custom-other', typeId: 'supermercado', name: 'Other' };
  const vegetables = { id: 'sup-verduras', typeId: 'supermercado', name: 'Vegetables' };
  assert.equal(isFallbackCategory(fallback), true);
  assert.equal(isFallbackCategory(custom), false);
  assert.deepEqual([fallback, vegetables, custom].sort(createListComparators('en').byCategory).map((c) => c.id),
    ['custom-other', 'sup-verduras', 'sup-otros']);
});

test('custom store-type fallback also sorts last by its stable identity', () => {
  const categories = getLocalizedSeed('fr').categories;
  const fallback = ensureFallbackCategory(categories, 'gifts');
  const ordinary = { id: 'custom-gifts', typeId: 'gifts', name: 'Zebra' };
  assert.equal(isFallbackCategory(fallback), true);
  assert.deepEqual([fallback, ordinary].sort(createListComparators('fr').byCategory), [ordinary, fallback]);
});

test('product names do not inherit category-only Other-last semantics', () => {
  const products = [{ name: 'Zanahoria' }, { name: 'Otros' }];
  assert.deepEqual(products.sort(createListComparators('es').byName).map((p) => p.name), ['Otros', 'Zanahoria']);
  assert.deepEqual(['ño', 'nz'].sort(createListComparators().compareNames), ['ño', 'nz']);
});
