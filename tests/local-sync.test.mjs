import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState } from '../src/lib/storage.ts';
import { applySnapshot, buildSnapshot, refreshCatalog } from '../src/lib/catalog-locale.ts';
import { acknowledgeChanges, hasPendingChanges, pendingAtSend, recordLocalChanges } from '../src/lib/local-sync.ts';

function localState() {
  const state=refreshCatalog(createInitialState(),'fr');
  state.products.push({id:'custom-p',name:'Local product',categoryId:'custom-cat',storeId:'custom-shop',defaultUnit:'unidad',icon:{kind:'emoji',value:'⭐'}});
  state.categories.push({id:'custom-cat',name:'Local category',typeId:'otros',icon:{kind:'emoji',value:'⭐'}});
  state.stores.push({id:'custom-shop',name:'Local shop',typeId:'otros',icon:{kind:'emoji',value:'⭐'}});
  state.lists.inbox={storeId:'inbox',items:[{productId:'custom-p',qty:1}],updatedAt:10};
  return state;
}
const empty=(updatedAt=30)=>({catalogLocale:'en',lists:{},customProducts:[],customStores:[],customCategories:[],defaultStores:{},usage:{},productIcons:{},updatedAt});

test('pending list wins regardless of wall clock and retains its full dependency chain',()=>{
  const state=localState();
  const previous=structuredClone(state);
  state.lists.inbox.items[0].qty=2;
  state.lists.inbox.updatedAt=20;
  recordLocalChanges(state,previous);
  assert.deepEqual(state.localSync.fields,{});
  const next=applySnapshot(state,empty());
  assert.equal(next.catalogLocale,'en');
  assert.equal(next.lists.inbox.items[0].qty,2);
  assert(next.products.some(p=>p.id==='custom-p'));
  assert(next.categories.some(c=>c.id==='custom-cat'));
  assert(next.stores.some(s=>s.id==='custom-shop'));
});

for (const [field,change] of [
  ['customProducts',state=>{state.products.find(p=>p.id==='custom-p').name='Renamed';}],
  ['defaultStores',state=>{state.defaultStores={otros:'custom-shop'};}],
  ['usage',state=>{state.usage={'custom-shop':{'custom-p':2}};}],
  ['productIcons',state=>{state.productIcons={'custom-p':{kind:'emoji',value:'🌟'}};}],
]) {
  test(`pending ${field} keeps required local objects when remote content omits them`,()=>{
    const state=localState();
    state.lists={};
    const previous=structuredClone(state);
    change(state);
    recordLocalChanges(state,previous);
    const next=applySnapshot(state,empty());
    assert.equal(next.catalogLocale,'en');
    assert(next.stores.some(s=>s.id==='custom-shop'));
    if(field!=='defaultStores') {
      assert(next.products.some(p=>p.id==='custom-p'));
      assert(next.categories.some(c=>c.id==='custom-cat'));
    }
  });
}

test('persisted collection and list deletions remain deleted under remote authority',()=>{
  const state=localState();
  state.defaultStores={otros:'custom-shop'};
  state.usage={'custom-shop':{'custom-p':2}};
  state.productIcons={'custom-p':{kind:'emoji',value:'🌟'}};
  const previous=structuredClone(state);
  const incoming=buildSnapshot(previous,100);
  incoming.catalogLocale='en';
  state.products=state.products.filter(p=>p.id!=='custom-p');
  state.stores=state.stores.filter(s=>s.id!=='custom-shop');
  state.categories=state.categories.filter(c=>c.id!=='custom-cat');
  state.lists={};state.defaultStores={};state.usage={};state.productIcons={};
  recordLocalChanges(state,previous);
  const reloaded=JSON.parse(JSON.stringify(state));
  const next=applySnapshot(reloaded,incoming);
  assert.equal(next.catalogLocale,'en');
  assert(!next.products.some(p=>p.id==='custom-p'));
  assert(!next.stores.some(s=>s.id==='custom-shop'));
  assert(!next.categories.some(c=>c.id==='custom-cat'));
  for(const field of ['lists','defaultStores','usage','productIcons']) assert.deepEqual(next[field],{});
  assert(hasPendingChanges(next));
  assert(!('localSync' in buildSnapshot(next)));
});

test('acknowledgement clears only revisions actually sent, retaining later same-field edits',()=>{
  const state=localState();
  let previous=structuredClone(state);
  state.defaultStores={otros:'custom-shop'};
  recordLocalChanges(state,previous);
  const sent=pendingAtSend(state);
  previous=structuredClone(state);
  state.defaultStores={};
  state.productIcons={'custom-p':{kind:'emoji',value:'🌟'}};
  recordLocalChanges(state,previous);
  acknowledgeChanges(state,sent);
  assert(hasPendingChanges(state));
  assert(state.localSync.fields.defaultStores>sent.fields.defaultStores);
  assert(state.localSync.fields.productIcons);
  acknowledgeChanges(state,pendingAtSend(state));
  assert(!hasPendingChanges(state));
  const next=applySnapshot(state,empty(100));
  assert.equal(next.catalogLocale,'en');
  assert(!next.products.some(p=>p.id==='custom-p'));
  assert(!next.stores.some(s=>s.id==='custom-shop'));
  assert(!next.categories.some(c=>c.id==='custom-cat'));
  assert.deepEqual(next.productIcons,{});
});

test('clean metadata accepts newer remote values while unrelated local list remains pending',()=>{
  const state=localState();
  const previous=structuredClone(state);
  state.lists.inbox.items[0].qty=2;
  state.lists.inbox.updatedAt=200;
  recordLocalChanges(state,previous);
  const next=applySnapshot(state,{...empty(100),defaultStores:{farmacia:'uk-boots'}});
  assert.deepEqual(next.defaultStores,{farmacia:'uk-boots'});
  assert.equal(next.lists.inbox.items[0].qty,2);
  assert.deepEqual(applySnapshot(next,{...empty(100),defaultStores:{farmacia:'uk-boots'}}),next);
});
