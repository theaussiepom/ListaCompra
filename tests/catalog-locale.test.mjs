import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applySnapshot, buildSnapshot, catalogReferences, inferCatalogLocale, refreshCatalog } from '../src/lib/catalog-locale.ts';
import { createInitialState, loadState, saveState } from '../src/lib/storage.ts';
import { getLocalizedSeed, LOCALIZED_PRODUCTS } from '../src/lib/data/locales/index.ts';
import { LOCALES, resolveLocale } from '../src/lib/i18n/locale.ts';

const cases = JSON.parse(readFileSync(new URL('./fixtures/catalog-locale.json', import.meta.url), 'utf8'));
for (const fixture of cases) {
  test(`locale migration parity: ${fixture.name}`, () => {
    assert.equal(inferCatalogLocale(fixture.data, fixture.fallback), fixture.expected);
  });
}

test('all seven resolver selections initialize empty state and remain pinned', () => {
  for (const [language, country, expected] of [['es', 'ES', 'es'], ['en', 'GB', 'en'], ['en', 'US', 'us'], ['fr', 'FR', 'fr'], ['de', 'DE', 'de'], ['pt', 'BR', 'br'], ['en', 'AU', 'au']]) {
    const state = refreshCatalog(createInitialState(), resolveLocale(language, country));
    assert.equal(state.catalogLocale, expected);
    assert.deepEqual(refreshCatalog(state, 'es'), state);
    assert.equal(state.products[0].id, LOCALIZED_PRODUCTS[expected][0].id);
  }
  assert.deepEqual(LOCALES, ['es', 'en', 'us', 'fr', 'de', 'br', 'au']);
});

function populatedState() {
  const seed = getLocalizedSeed('en');
  const product = seed.products[0];
  const french = getLocalizedSeed('fr');
  const foreign = french.products[0];
  const store = {...seed.stores[0], edited: true, name: 'My Tesco', loyalty: {code: '1234', format: 'qr'}};
  const custom = {id: 'custom-one', name: 'Special', categoryId: 'custom-category', storeId: french.stores[0].id, icon: {kind:'emoji', value:'⭐'}, defaultUnit: 'unidad'};
  return {
    ...createInitialState(), ...seed, locale: 'en',
    stores: [store, ...seed.stores.slice(1), french.stores[0]],
    products: [...seed.products, foreign, custom],
    categories: [...seed.categories, {id:'custom-category', name:'Custom', typeId:'supermercado', icon:{kind:'emoji',value:'⭐'}}],
    lists: {[store.id]: {storeId:store.id, items:[{id:'i1', productId:product.id, qty:2, unit:'l', done:false, addedAt:1}, {id:'i2', productId:foreign.id, qty:1, unit:'unidad', done:true, addedAt:1}], updatedAt:10}},
    defaultStores: {supermercado: store.id}, usage: {[store.id]: {[foreign.id]: 4}},
    productIcons: {[foreign.id]: {kind:'emoji',value:'🌟'}},
  };
}

test('mixed populated legacy state retains every reference through reload and a second client', () => {
  const legacy = populatedState();
  const migrated = refreshCatalog(legacy, 'de');
  assert.equal(migrated.catalogLocale, 'en');
  assert.deepEqual(refreshCatalog(migrated, 'fr'), migrated);
  for (const key of ['lists','defaultStores','usage','productIcons']) assert.deepEqual(migrated[key], legacy[key]);
  const snapshot = JSON.parse(JSON.stringify(buildSnapshot(migrated, 20)));
  const other = applySnapshot({...createInitialState(), locale:'de'}, snapshot);
  assert.equal(other.catalogLocale, 'en');
  assert.equal(other.locale, 'de');
  for (const key of ['lists','defaultStores','usage','productIcons']) assert.deepEqual(other[key], legacy[key]);
  assert.deepEqual(other.stores.find(s => s.id === 'uk-tesco'), legacy.stores[0]);
  assert.equal(other.products.find(p => p.id === 'custom-one').storeId, 'fr-carrefour');
  assert(other.categories.some(c => c.id === 'custom-category'));
  const refs = catalogReferences(other);
  for (const id of refs.products) assert(other.products.some(p => p.id === id), id);
  for (const id of refs.stores) assert(other.stores.some(s => s.id === id), id);
  const cache = new Map();
  globalThis.localStorage = {getItem: key => cache.get(key) ?? null, setItem: (key,value) => cache.set(key,value)};
  try {
    saveState(other);
    assert.deepEqual(refreshCatalog(loadState(), 'br'), other);
  } finally { delete globalThis.localStorage; }
});

test('referenced foreign products and stores can be recovered from registry-only legacy snapshots', () => {
  const p = LOCALIZED_PRODUCTS.fr[0];
  const snap = {catalogLocale:'en', lists:{'fr-carrefour':{storeId:'fr-carrefour',items:[{productId:p.id}],updatedAt:1}}, customProducts:[], customStores:[], updatedAt:2};
  const state = applySnapshot(createInitialState(), snap);
  assert(state.products.some(product => product.id === p.id));
  assert(state.stores.some(store => store.id === 'fr-carrefour'));
  assert.deepEqual(refreshCatalog(state), state);
});

test('obsolete local seed objects and custom products survive migration', () => {
  const state = populatedState();
  state.products.push({id:'retired-product',name:'Old product', categoryId:'otr-otros', defaultUnit:'unidad',icon:{kind:'emoji',value:'📦'}});
  state.stores.push({id:'retired-shop',name:'Old shop',typeId:'otros',icon:{kind:'emoji',value:'📦'}});
  const migrated = refreshCatalog(state, 'es');
  const other = applySnapshot(createInitialState(), buildSnapshot(migrated));
  assert(other.products.some(p => p.id === 'retired-product'));
  assert(other.stores.some(s => s.id === 'retired-shop'));
});

test('newer snapshots honor custom product, store and category deletion on a second client', () => {
  const state = populatedState();
  state.stores.push({id:'custom-shop',name:'Custom shop',typeId:'otros',icon:{kind:'emoji',value:'🏬'}});
  state.lists['custom-shop'] = {storeId:'custom-shop',items:[{productId:'custom-one'}],updatedAt:10};
  const snap = buildSnapshot(refreshCatalog(state), 20);
  const staleClient = applySnapshot(createInitialState(), snap);
  const deleted = {...snap, updatedAt:30, customProducts:[], customStores:snap.customStores.filter(s=>s.id!=='custom-shop'),customCategories:[], lists:Object.fromEntries(Object.entries(snap.lists).filter(([id])=>id!=='custom-shop'))};
  const next = applySnapshot(staleClient, deleted);
  assert(!next.products.some(p=>p.id==='custom-one'));
  assert(!next.stores.some(s=>s.id==='custom-shop'));
  assert(!next.categories.some(c=>c.id==='custom-category'));
  assert(!next.lists['custom-shop']);
  assert(!buildSnapshot(next).customProducts.some(p=>p.id==='custom-one'));
});

test('initial empty server pin preserves populated local legacy data', () => {
  const legacy = populatedState();
  const next = applySnapshot(legacy, {catalogLocale:'en',lists:{},customProducts:[],customStores:[],updatedAt:0}, true);
  assert.deepEqual(next.lists, legacy.lists);
  assert(next.products.some(p=>p.id==='custom-one'));
  assert(next.categories.some(c=>c.id==='custom-category'));
  assert.deepEqual(next.stores.find(s=>s.id==='uk-tesco').loyalty, legacy.stores[0].loyalty);
});

test('clearing an override restores a retained foreign seed icon locally and on a second client', () => {
  const state = refreshCatalog(populatedState());
  const foreign = LOCALIZED_PRODUCTS.fr[0];
  assert.notDeepEqual(state.products.find(p=>p.id===foreign.id).icon, foreign.icon);
  state.productIcons = {};
  const restored = refreshCatalog(state);
  assert.deepEqual(restored.products.find(p=>p.id===foreign.id).icon, foreign.icon);
  assert.deepEqual(applySnapshot(state,buildSnapshot(restored,50)).products.find(p=>p.id===foreign.id).icon,foreign.icon);
});

test('unsent local list preserves its custom product category and exclusive store',()=>{
  const state=populatedState();
  state.stores.push({id:'custom-shop',name:'Private',typeId:'supermercado',icon:{kind:'emoji',value:'🏬'}});
  state.products.find(p=>p.id==='custom-one').storeId='custom-shop';
  state.lists.inbox={storeId:'inbox',items:[{productId:'custom-one'}],updatedAt:100};
  const incoming={catalogLocale:'en',lists:{},customProducts:[],customStores:[],customCategories:[],updatedAt:50};
  const next=applySnapshot(state,incoming);
  assert(next.products.some(p=>p.id==='custom-one'));
  assert(next.categories.some(c=>c.id==='custom-category'));
  assert(next.stores.some(s=>s.id==='custom-shop'));
});

test('legacy snapshots without custom category metadata preserve existing local categories',()=>{
  const state=refreshCatalog(populatedState());
  const snap=buildSnapshot(state,50);
  delete snap.customCategories;
  const next=applySnapshot(state,snap);
  assert(next.categories.some(c=>c.id==='custom-category'));
});

test('positive-timestamp legacy snapshot preserves unshared store metadata and referenced dependencies',()=>{
  const state=refreshCatalog(populatedState());
  state.stores.find(s=>s.id==='uk-asda').enabled=false;
  state.stores.find(s=>s.id==='uk-aldi').order=100;
  state.stores.push({id:'custom-shop',name:'Private',typeId:'supermercado',icon:{kind:'emoji',value:'🏬'}});
  state.products.find(p=>p.id==='custom-one').storeId='custom-shop';
  state.lists.inbox={storeId:'inbox',items:[{productId:'custom-one'}],updatedAt:1};
  const snapshot=buildSnapshot(state,50);
  delete snapshot.customCategories;
  snapshot.customStores=[];
  const next=applySnapshot(state,snapshot);
  assert.equal(next.stores.find(s=>s.id==='uk-asda').enabled,false);
  assert.equal(next.stores.find(s=>s.id==='uk-aldi').order,100);
  assert(next.stores.find(s=>s.id==='uk-tesco').loyalty);
  assert(next.stores.some(s=>s.id==='custom-shop'));
  assert(next.categories.some(c=>c.id==='custom-category'));
});

test('clearing local data also removes per-share transition caches',async()=>{
  const {clearState,saveShareState}=await import('../src/lib/storage.ts');
  const values=new Map([['unrelated','keep']]);
  globalThis.localStorage={get length(){return values.size;},key:index=>[...values.keys()][index],setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  try {
    saveState(createInitialState());
    saveShareState('shared:one',createInitialState());
    clearState();
    assert.deepEqual([...values],[['unrelated','keep']]);
  }finally {delete globalThis.localStorage;}
});

test('repair: referenced untouched seed stores never become shared custom overrides',()=>{
  const state=refreshCatalog(createInitialState(),'en');
  state.lists['uk-tesco']={storeId:'uk-tesco',items:[],updatedAt:1};
  state.defaultStores={farmacia:'uk-boots'};
  const snap=buildSnapshot(state,10);
  assert(!snap.customStores.some(s=>s.id==='uk-tesco'));
  assert(!snap.customStores.some(s=>s.id==='uk-boots'));
});

test('repair: untouched foreign seed metadata refreshes from current registry',()=>{
  const state=refreshCatalog(createInitialState(),'en');
  const foreign=getLocalizedSeed('fr').stores[0];
  state.stores.push({...foreign,name:'Stale name',icon:{kind:'emoji',value:'OLD'}});
  state.lists[foreign.id]={storeId:foreign.id,items:[],updatedAt:1};
  const refreshed=refreshCatalog(state);
  assert.equal(refreshed.stores.find(s=>s.id===foreign.id).name,foreign.name);
  assert.deepEqual(refreshed.stores.find(s=>s.id===foreign.id).icon,foreign.icon);
  const snap=buildSnapshot(refreshed,2);
  assert(!snap.customStores.some(s=>s.id===foreign.id));
  assert.deepEqual(applySnapshot(createInitialState(),snap).stores.find(s=>s.id===foreign.id),foreign);
});

test('repair: real seed customizations sync while normal seed metadata stays fresh',()=>{
  const state=refreshCatalog(createInitialState(),'en');
  const seed=getLocalizedSeed('en');
  const overrides=[
    {...seed.stores[0],edited:true,name:'My shop'},
    {...seed.stores[1],loyalty:{code:'123',format:'qr'}},
    {...seed.stores[2],enabled:false},
    {...seed.stores[3],order:100},
    {id:'custom-shop',name:'Custom',typeId:'otros',icon:{kind:'emoji',value:'🏬'}},
  ];
  for(const store of overrides) {
    state.stores=state.stores.filter(s=>s.id!==store.id);
    state.stores.push(store);
  }
  const snap=buildSnapshot(state,10);
  for(const store of overrides) assert(snap.customStores.some(s=>s.id===store.id));
  const other=applySnapshot(createInitialState(),JSON.parse(JSON.stringify(snap)));
  assert.equal(other.stores.find(s=>s.id===overrides[0].id).name,'My shop');
  assert.deepEqual(other.stores.find(s=>s.id===overrides[1].id).loyalty,{code:'123',format:'qr'});
  assert.equal(other.stores.find(s=>s.id===overrides[2].id).enabled,false);
  assert.equal(other.stores.find(s=>s.id===overrides[3].id).order,100);
  assert(other.stores.some(s=>s.id==='custom-shop'));
});

test('repair: simulated seed update replaces old serialized foreign name and icon',()=>{
  const foreign=getLocalizedSeed('fr').stores[0];
  const before={name:foreign.name,icon:foreign.icon};
  const old={...foreign};
  const state=refreshCatalog(createInitialState(),'en');
  state.stores.push(old);
  state.lists[foreign.id]={storeId:foreign.id,items:[],updatedAt:1};
  try {
    foreign.name='Current release name';foreign.icon={kind:'emoji',value:'NEW'};
    const legacy={catalogLocale:'en',lists:state.lists,customProducts:[],customStores:[old],customCategories:[],updatedAt:2};
    const next=applySnapshot(state,legacy);
    assert.equal(next.stores.find(s=>s.id===foreign.id).name,'Current release name');
    assert.equal(next.stores.find(s=>s.id===foreign.id).icon.value,'NEW');
    assert(!buildSnapshot(next).customStores.some(s=>s.id===foreign.id));
  }finally {Object.assign(foreign,before);}
});
