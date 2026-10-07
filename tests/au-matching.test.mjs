import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { LOCALIZED_PRODUCTS } from '../src/lib/data/locales/index.ts';
import { selectAutomaticMatch } from '../src/lib/search.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/au-acceptance.json', import.meta.url), 'utf8'));
const products = LOCALIZED_PRODUCTS.au;

test('AU matching replays all 581 authoritative cases', () => {
  assert.equal(fixture.matchingCases.length, 581);
  assert.equal(products.length, 1518);
});

for (const entry of fixture.matchingCases) {
  test(`${entry.id}: ${entry.request}`, () => {
    const product = selectAutomaticMatch(products, entry.request);
    assert.equal(product?.id ?? null, entry.expectedProductId);
    assert.equal(product ? 'match-existing-product' : 'preserve-raw-request', entry.expectedAction);
    assert.equal(entry.forbiddenProductIds?.includes(product?.id) ?? false, false);
    if (entry.expectedPreservedRequest !== undefined) {
      assert.equal(product, null);
      assert.equal(entry.request.trim(), entry.expectedPreservedRequest);
    }
  });
}

const regressions = [
  ['beef mince', 'au-beef-mince'], ['chicken breast', 'au-chicken-breast'],
  ['prawns', 'au-prawns'], ['bread', 'au-bread'], ['scotch fillet', 'au-scotch-fillet'],
  ['beef cheeks', 'au-beef-cheeks'], ['wholemeal bread', 'au-wholemeal-bread'],
  ['smoked salmon', 'au-smoked-salmon'], ['tuna', 'au-tuna'], ['salmon', 'au-salmon'],
  ['steak', 'au-steak'], ['tea towel', 'au-tea-towel'], ['soda', null], ['litter', null],
];
for (const [query, expected] of regressions) {
  test(`AU regression: ${query}${expected === null ? ' remains unresolved' : ' resolves canonical'}`, () => {
    assert.equal(selectAutomaticMatch(products, query)?.id ?? null, expected);
  });
}

const synonyms = [
  ['capsicum', 'bell pepper', 'au-capsicum'], ['zucchini', 'courgette', 'au-zucchini'],
  ['eggplant', 'aubergine', 'au-eggplant'], ['coriander', 'cilantro', 'au-coriander'],
  ['rockmelon', 'cantaloupe', 'au-rockmelon'], ['prawns', 'shrimp', 'au-prawns'],
  ['nappies', 'diapers', 'au-nappies'], ['cling wrap', 'plastic wrap', 'au-cling-wrap'],
  ['alfoil', 'aluminium foil', 'au-aluminium-foil'],
];
for (const [first, second, expected] of synonyms) {
  test(`AU synonyms: ${first} / ${second}`, () => {
    for (const query of [first, second]) assert.equal(selectAutomaticMatch(products, query)?.id ?? null, expected);
  });
}
