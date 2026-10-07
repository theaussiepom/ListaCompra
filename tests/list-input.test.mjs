import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as search from '../src/lib/search.ts';

// Ejecuta los handlers reales del componente con el almacenamiento aislado.
const component = readFileSync(new URL('../src/components/list/ListView.svelte', import.meta.url), 'utf8');
const script = component.slice(component.indexOf('>') + 1, component.indexOf('</script>'));
const ast = ts.createSourceFile('ListView.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const handlers = ast.statements.filter((node) => ts.isFunctionDeclaration(node)
  && ['addProduct', 'handleQueryKeydown'].includes(node.name?.text)).map((node) => node.getText(ast)).join('\n');
const compiled = ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const bindHandlers = new Function('context', `
  const { app, store, productsForType, filtered, norm, selectAutomaticMatch } = context;
  const storeId = store.id;
  let query = context.query;
  ${compiled}
  return { keydown: handleQueryKeydown, clickSuggestion: addProduct, query: () => query };
`);

function listInput(products, query) {
  const items = [];
  const created = [];
  const app = {
    state: { products: [...products] },
    addItem: (storeId, item) => items.push({ storeId, ...item }),
    createFreeProduct(name, typeId) {
      const product = { id: `custom-${created.length}`, name, categoryId: typeId, defaultUnit: 'unidad' };
      created.push(product);
      app.state.products.push(product);
      return product;
    },
  };
  const suggestions = search.rankMatches(products, query);
  const handlers = bindHandlers({ app, store: { id: 'market', typeId: 'supermercado' },
    productsForType: products, filtered: suggestions, query, ...search });
  return {
    ...handlers, items, created, suggestions,
    enter: () => handlers.keydown({ key: 'Enter', preventDefault() {} }),
  };
}

const cases = [
  { name: 'canonical exact', query: 'MILK', products: [{ id: 'milk', name: 'Milk', defaultUnit: 'l' }], expected: 'milk' },
  { name: 'two-code-point Unicode prefix remains literal', query: '💊a', products: [{ id: 'medicine', name: '💊a medicine' }] },
  { name: 'unique whole-word prefix', query: 'milk', products: [{ id: 'whole', name: 'Milk whole' }], expected: 'whole' },
  { name: 'prefix with substring competitor', query: 'milk', products: [{ id: 'whole', name: 'Milk whole' }, { id: 'almond', name: 'Almond milk' }] },
  { name: 'soda has competing intent', query: 'soda', products: [{ id: 'water', name: 'Soda water' }, { id: 'baking', name: 'Baking soda' }] },
  { name: 'litter has competing intent', query: 'litter', products: [{ id: 'liners', name: 'Litter tray liners' }, { id: 'cat', name: 'Cat litter' }] },
  { name: 'safe prefix ignores subsequence noise', query: 'mint', products: [{ id: 'tea', name: 'Mint tea' }, { id: 'paste', name: 'Mild nut paste' }], expected: 'tea' },
  { name: 'weak substring', query: 'detergent', products: [{ id: 'laundry', name: 'Laundry detergent' }] },
  { name: 'subsequence', query: 'aBc', products: [{ id: 'cabbage', name: 'A bright cabbage' }] },
  { name: 'prefix ambiguity', query: 'milk', products: [{ id: 'whole', name: 'Milk whole' }, { id: 'skim', name: 'Milk skimmed' }] },
  { name: 'canonical identity tie', query: 'bread', products: [{ id: 'bakery', name: 'Bread' }, { id: 'market', name: 'Bread' }] },
  { name: 'unknown literal case and internal whitespace', query: '  MiXeD  Brand\tNight  ', products: [{ id: 'milk', name: 'Milk' }] },
];

for (const fixture of cases) {
  test(`Enter: ${fixture.name}`, () => {
    const ui = listInput(fixture.products, fixture.query);
    ui.enter();
    if (fixture.expected) {
      assert.equal(ui.items[0].productId, fixture.expected);
      assert.equal(ui.created.length, 0);
      assert.equal(ui.items[0].unit, fixture.products.find((p) => p.id === fixture.expected).defaultUnit ?? 'unidad');
    } else {
      assert.equal(ui.created[0]?.name, fixture.query.trim());
      assert.equal(ui.items[0].productId, ui.created[0].id);
    }
    assert.equal(ui.query(), '');
  });
}

test('explicitly clicking a weak suggestion still adds that product', () => {
  const ui = listInput([{ id: 'laundry', name: 'Laundry detergent', defaultUnit: 'l' }], 'detergent');
  assert.equal(ui.suggestions[0].id, 'laundry');
  ui.clickSuggestion(ui.suggestions[0].id);
  assert.deepEqual(ui.items, [{ storeId: 'market', productId: 'laundry', qty: 1, unit: 'l' }]);
  assert.deepEqual(ui.created, []);
  assert.equal(ui.query(), '');
});

test('non-Enter keys and blank queries do not add a product', () => {
  const ui = listInput([], '  ');
  ui.enter();
  ui.keydown({ key: 'Escape', preventDefault() { assert.fail('unexpected prevention'); } });
  assert.deepEqual(ui.items, []);
  assert.deepEqual(ui.created, []);
});

test('explicitly clicking a competing prefix suggestion still chooses its product', () => {
  const ui = listInput([{ id: 'liners', name: 'Litter tray liners' }, { id: 'cat', name: 'Cat litter' }], 'litter');
  assert.deepEqual(ui.suggestions.map((p) => p.id), ['liners', 'cat']);
  ui.clickSuggestion(ui.suggestions[0].id);
  assert.equal(ui.items[0].productId, 'liners');
  assert.deepEqual(ui.created, []);
});
