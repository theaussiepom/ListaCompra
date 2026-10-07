import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { getLocalizedSeed } from '../src/lib/data/locales/index.ts';
import { createListComparators } from '../src/lib/listSorting.ts';
import * as search from '../src/lib/search.ts';

const seed = getLocalizedSeed('au');
const source = readFileSync(new URL('../src/components/list/ListView.svelte', import.meta.url), 'utf8');
const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'));
const ast = ts.createSourceFile('ListView.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const statements = ast.statements.filter((node) => (
  ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
    ['categories', 'productsForType', 'filtered'].includes(declaration.name.getText(ast)))
) || (ts.isFunctionDeclaration(node) && ['addProduct', 'handleQueryKeydown'].includes(node.name?.text)));
assert.equal(statements.length, 5);
const compiled = ts.transpileModule(statements.map((node) => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
// Ejecuta filtros y handlers del componente, aislando solo el almacenamiento.
const bind = new Function('context', `
  const { app, store, sorting, rankMatches, selectAutomaticMatch } = context;
  const storeId = store.id;
  let query = context.query;
  const activeCat = 'all';
  const HABITUALES_LIMIT = 20;
  const $derived = Object.assign((value) => value, { by: (callback) => callback() });
  ${compiled}
  return { productsForType, suggestions: filtered, click: addProduct,
    enter: () => handleQueryKeydown({ key: 'Enter', preventDefault() {} }), query: () => query };
`);

function listInput(storeId, query) {
  const items = [];
  const created = [];
  const app = {
    state: { ...seed, products: [...seed.products] },
    addItem: (destination, item) => items.push({ storeId: destination, ...item }),
    createFreeProduct(name, typeId) {
      const product = { id: `custom-${created.length}`, name, categoryId: `${typeId}-otros`, defaultUnit: 'unidad' };
      created.push(product);
      app.state.products.push(product);
      return product;
    },
  };
  const store = seed.stores.find((candidate) => candidate.id === storeId);
  assert.ok(store);
  return { ...bind({ app, store, query, sorting: createListComparators('au'), ...search }), items, created };
}

for (const [storeId, mirrorId] of [
  ['au-butcher', 'au-butcher-beef-mince'], ['au-bakery', 'au-bakery-bread'],
  ['au-seafood-shop', 'au-seafood-shop-salmon'],
]) {
  const mirror = seed.products.find((product) => product.id === mirrorId);
  test(`AU ${storeId}: real specialist pool and explicit click retain ${mirrorId}`, () => {
    const ui = listInput(storeId, mirror.name);
    assert.ok(ui.productsForType.some((product) => product.id === mirror.id));
    assert.equal(ui.productsForType.some((product) => product.id === mirror.mirrorOf), false);
    assert.ok(ui.suggestions.some((product) => product.id === mirror.id));
    ui.click(mirror.id);
    assert.deepEqual(ui.items, [{ storeId, productId: mirror.id, qty: 1, unit: mirror.defaultUnit }]);
    assert.deepEqual(ui.created, []);
    assert.equal(ui.query(), '');
  });

  test(`AU ${storeId}: Enter preserves literal input rather than choosing a hidden canonical product`, () => {
    const query = `  ${mirror.name.toUpperCase().replaceAll(' ', '  ')}  `;
    const ui = listInput(storeId, query);
    assert.equal(search.selectAutomaticMatch(ui.productsForType, query), null);
    ui.enter();
    assert.equal(ui.created[0]?.name, query.trim());
    assert.deepEqual(ui.items, [{ storeId, productId: ui.created[0].id, qty: 1, unit: 'unidad' }]);
    assert.notEqual(ui.items[0].productId, mirror.mirrorOf);
    assert.equal(ui.query(), '');
  });

  test(`AU ${mirror.name}: complete global concept and supermarket Enter select canonical`, () => {
    assert.equal(search.selectAutomaticMatch(seed.products, mirror.name)?.id, mirror.mirrorOf);
    const ui = listInput('au-woolworths', mirror.name);
    ui.enter();
    const canonical = seed.products.find((product) => product.id === mirror.mirrorOf);
    assert.deepEqual(ui.items, [{ storeId: 'au-woolworths', productId: canonical.id, qty: 1, unit: canonical.defaultUnit }]);
    assert.deepEqual(ui.created, []);
  });
}
