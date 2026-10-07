import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'svelte/compiler';
import { createListComparators } from '../src/lib/listSorting.ts';
import { LOCALES } from '../src/lib/i18n/locale.ts';

const source = readFileSync(new URL('../src/components/list/ListView.svelte', import.meta.url), 'utf8');
const component = parse(source, { modern: true });
const declarations = component.instance.content.body
  .filter((node) => node.type === 'VariableDeclaration').flatMap((node) => node.declarations);
function derivedExpression(name) {
  const expression = declarations.find((node) => node.id.name === name).init.arguments[0];
  return source.slice(expression.start, expression.end);
}
const deriveSorting = new Function('app', 'createListComparators', `return (${derivedExpression('sorting')});`);
const deriveMoveTargets = new Function('app', 'storeId', 'sorting', `return (${derivedExpression('moveTargets')});`);

for (const locale of LOCALES) {
  test(`actual ListView move targets use ${locale} sorting and exclude unavailable destinations`, () => {
    const stores = [
      { id: 'current', name: 'A current store', enabled: true },
      { id: 'disabled', name: 'A disabled store', enabled: false },
      { id: 'nz', name: 'nz', enabled: true },
      { id: 'other', name: 'Otros' },
      { id: 'zebra', name: 'Zebra', enabled: true },
      { id: 'enye', name: 'ño' },
    ];
    const before = structuredClone(stores);
    const app = { state: { stores, locale } };
    const sorting = deriveSorting(app, createListComparators);
    const targets = deriveMoveTargets(app, 'current', sorting);
    assert.deepEqual(targets.map((store) => store.id),
      locale === 'es' ? ['nz', 'enye', 'other', 'zebra'] : ['enye', 'nz', 'other', 'zebra']);
    assert.deepEqual(stores, before);
  });
}
