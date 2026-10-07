import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';
import { createInitialState } from '../src/lib/storage.ts';
import { refreshCatalog } from '../src/lib/catalog-locale.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

async function runtime(fakeTimers = false) {
  const dir = mkdtempSync(resolve(root, 'tests/.catalog-runtime-'));
  const appPath = resolve(dir, 'app.mjs');
  const syncPath = resolve(dir, 'sync.mjs');
  function compile(relative, destination, replacements) {
    const filename = resolve(root, relative);
    let source = ts.transpileModule(readFileSync(filename, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}}).outputText;
    const resolved = value => {
      if (replacements[value]) return pathToFileURL(replacements[value]).href;
      let file = resolve(dirname(filename), value);
      if (existsSync(`${file}.ts`)) file += '.ts';
      return pathToFileURL(file).href;
    };
    source = source.replace(/from (['"])(\.[^'"]+)\1/g, (_, quote, path) => `from ${quote}${resolved(path)}${quote}`);
    source = source.replace(/import\((['"])(\.[^'"]+)\1\)/g, (_, quote, path) => `import(${quote}${resolved(path)}${quote})`);
    writeFileSync(destination, compileModule(source, {generate:'server'}).js.code);
  }
  compile('src/lib/stores/app.svelte.ts', appPath, {'../sync.svelte':syncPath});
  compile('src/lib/sync.svelte.ts', syncPath, {'./stores/app.svelte':appPath});
  const memory = new Map();
  const previous = {fetch:globalThis.fetch, localStorage:globalThis.localStorage, window:globalThis.window, document:globalThis.document, setInterval:globalThis.setInterval, clearInterval:globalThis.clearInterval, setTimeout:globalThis.setTimeout, clearTimeout:globalThis.clearTimeout};
  const intervals = new Map();
  const timeouts = new Map();
  if (fakeTimers) {
    globalThis.setInterval = (fn) => { const id = {}; intervals.set(id, fn); return id; };
    globalThis.clearInterval = (id) => intervals.delete(id);
    globalThis.setTimeout = (fn) => { const id = {}; timeouts.set(id, fn); return id; };
    globalThis.clearTimeout = (id) => timeouts.delete(id);
  }
  globalThis.localStorage = {getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
  const {app} = await import(pathToFileURL(appPath));
  const sync = await import(pathToFileURL(syncPath));
  sync.syncStatus.inHA = true;
  sync.syncStatus.activeShareId = 'shared:old';
  const respond = data => ({ok:true,json:async()=>data});
  return {app,sync,memory,respond,intervals,timeouts,cleanup:async()=>{
    await sync.stopSync();
    for (const [key,value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key]=value;
    }
    rmSync(dir,{recursive:true,force:true});
  }};
}

const snapshot = (catalogLocale='en', updatedAt=10) => ({catalogLocale,lists:{},customProducts:[],customStores:[],updatedAt});

test('actual AppStore hydration pins legacy data before differing display language is set', async()=>{
  const run = await runtime();
  try {
    const state = refreshCatalog(createInitialState(),'en');
    delete state.catalogLocale;
    state.locale='en';
    state.lists['uk-tesco']={storeId:'uk-tesco',items:[{productId:'uk-apples'}],updatedAt:1};
    run.memory.set('tucompra:state:v1',JSON.stringify(state));
    run.app.hydrate();
    run.app.setLocale('de');
    run.app.initializeCatalog('de');
    assert.equal(run.app.state.catalogLocale,'en');
    assert.equal(run.app.state.locale,'de');
    assert(run.app.state.products.some(p=>p.id==='uk-apples'));
    assert(run.app.state.stores.some(s=>s.id==='uk-tesco'));
  } finally { await run.cleanup(); }
});

test('failed pull never pushes a locally selected catalogue', async()=>{
  const run = await runtime();
  try {
    const calls=[];
    globalThis.fetch=async(_url,init)=>{calls.push(init.method??'GET');throw new Error('offline');};
    await run.sync.startSync();
    assert.deepEqual(calls,['GET']);
    assert.equal(run.sync.syncStatus.enabled,true);
    assert.equal(run.sync.syncStatus.authoritative,false);
  } finally {await run.cleanup();}
});

test('authoritative locale applies even with an older snapshot than local list edits',async()=>{
  const run = await runtime();
  try {
    run.app.state=refreshCatalog(createInitialState(),'fr');
    run.app.state.lists['fr-carrefour']={storeId:'fr-carrefour',items:[{productId:'fr-pommes'}],updatedAt:100};
    globalThis.fetch=async(_url,init)=>run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:snapshot('en',10)});
    await run.sync.startSync();
    assert.equal(run.app.state.catalogLocale,'en');
    assert(run.app.state.products.some(p=>p.id==='fr-pommes'));
    assert(run.app.state.lists['fr-carrefour']);
  }finally {await run.cleanup();}
});

for (const failure of ['flush','target pull']) {
  test(`share switch preserves current state when ${failure} fails`,async()=>{
    const run = await runtime();
    try {
      run.app.state=refreshCatalog(createInitialState(),'en');
      globalThis.fetch=async(_url,init)=>run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:snapshot('en',10)});
      await run.sync.startSync();
      run.app.state.defaultStores={supermercado:'uk-tesco'};
      run.app.persist();
      const calls=[];
      globalThis.fetch=async(_url,init)=>{
        calls.push(init.method??'GET');
        if (failure==='flush'||init.method!=='POST') throw new Error('offline');
        return run.respond({ok:true,updatedAt:JSON.parse(init.body).updatedAt});
      };
      await run.sync.switchShare('shared:new');
      assert.equal(run.sync.syncStatus.activeShareId,'shared:old');
      assert.equal(run.app.state.catalogLocale,'en');
      assert.deepEqual(run.app.state.defaultStores,{supermercado:'uk-tesco'});
      assert.deepEqual(calls,failure==='flush'?['POST']:['POST','GET']);
      if (failure==='flush') assert(run.app.state.localSync.fields.defaultStores);
    }finally {await run.cleanup();}
  });
}

test('share switch and late old-share response cannot contaminate the target catalogue',async()=>{
  const run = await runtime(true);
  try {
    run.app.state=refreshCatalog(createInitialState(),'en');
    run.app.state.lists['uk-tesco']={storeId:'uk-tesco',items:[{productId:'uk-apples'}],updatedAt:1};
    globalThis.fetch=async(_url,init)=>run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:snapshot('en',10)});
    await run.sync.startSync();
    let oldResolve;
    globalThis.fetch=async(url,init)=>{
      if (init.method==='POST') return run.respond({ok:true,updatedAt:JSON.parse(init.body).updatedAt});
      if (url.includes('shared%3Aold')) return await new Promise(resolve=>{oldResolve=resolve;});
      return run.respond({snapshot:snapshot('fr',20)});
    };
    const oldPull=[...run.intervals.values()][0]();
    await run.sync.switchShare('shared:new');
    oldResolve(run.respond({snapshot:snapshot('de',100)}));
    await oldPull;
    assert.equal(run.sync.syncStatus.activeShareId,'shared:new');
    assert.equal(run.app.state.catalogLocale,'fr');
    assert.equal(run.app.state.lists['uk-tesco'],undefined);
    assert(!run.app.state.stores.some(s=>s.id==='uk-tesco'));
  }finally {await run.cleanup();}
});

test('automatic selection of a different saved share keeps its data separate',async()=>{
  const run=await runtime();
  try {
    run.app.state=refreshCatalog(createInitialState(),'en');
    run.app.state.lists['uk-tesco']={storeId:'uk-tesco',items:[{productId:'uk-apples'}],updatedAt:100};
    run.memory.set('tucompra:shareId','personal:old');
    let onMessage;
    globalThis.window={addEventListener:(event,listener)=>{if(event==='message')onMessage=listener;},removeEventListener:()=>{},parent:{postMessage:()=>onMessage({data:{type:'tucompra-token',token:'test-token',hassUrl:'http://ha',language:'de',country:'DE'}})}};
    globalThis.document={addEventListener:()=>{},removeEventListener:()=>{}};
    globalThis.fetch=async(url,init)=>run.respond(url.endsWith('/me')?{user_id:'u1',name:'Test',is_admin:true}:url.endsWith('/shares')?{shares:[{id:'shared:new'}]}:init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:snapshot('fr',20)});
    await run.sync.hydrateAuth();
    assert.equal(run.sync.syncStatus.activeShareId,'shared:new');
    assert.equal(run.app.state.catalogLocale,'fr');
    assert.equal(run.app.state.lists['uk-tesco'],undefined);
    const cached = JSON.parse(run.memory.get('tucompra:state:v1:share:personal:old'));
    assert(cached.lists['uk-tesco']);
  }finally {await run.cleanup();}
});

test('repair: first failed pull stays armed, gates local mutation and recovers automatically', async()=>{
  const run=await runtime(true);
  try {
    const calls=[];
    let available=false;
    globalThis.fetch=async(_url,init)=>{
      calls.push(init.method??'GET');
      if (!available) throw new Error('offline');
      return run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:{...snapshot('en',10),customCategories:[]}});
    };
    await run.sync.startSync();
    assert.deepEqual(calls,['GET']);
    assert.equal(run.intervals.size,1,'recovery must remain armed');
    run.app.state.defaultStores={supermercado:'uk-tesco'};
    run.app.persist();
    await new Promise(resolve=>setImmediate(resolve));
    run.sync.schedulePush();
    await run.sync.pushNow();
    assert.deepEqual(calls,['GET'],'no POST is allowed before authority');
    available=true;
    await [...run.intervals.values()][0]();
    assert.equal(run.app.state.catalogLocale,'en');
    assert.equal(run.app.state.defaultStores.supermercado,'uk-tesco');
    assert.deepEqual(calls,['GET','GET','POST']);
    await run.sync.stopSync();
    assert.equal(run.intervals.size,0);
    assert.equal(run.timeouts.size,0);
  }finally {await run.cleanup();}
});

test('repair: pending metadata and deletions survive reload then older catalogue authority',async()=>{
  const first=await runtime(true);
  let saved;
  try {
    first.app.state=refreshCatalog(createInitialState(),'fr');
    first.app.state.products.push({id:'custom-delete',name:'Delete me',categoryId:'otr-otros',icon:{kind:'emoji',value:'⭐'},defaultUnit:'unidad'});
    first.app.persistLocalOnly();
    first.app.state.products=first.app.state.products.filter(p=>p.id!=='custom-delete');
    first.app.state.products.push({id:'custom-new',name:'New local',categoryId:'custom-category',storeId:'custom-store',icon:{kind:'emoji',value:'⭐'},defaultUnit:'unidad'});
    first.app.state.categories.push({id:'custom-category',name:'New category',typeId:'otros',icon:{kind:'emoji',value:'⭐'}});
    first.app.state.stores.push({id:'custom-store',name:'New store',typeId:'otros',icon:{kind:'emoji',value:'⭐'}});
    first.app.state.defaultStores={otros:'custom-store'};
    first.app.state.usage={'custom-store':{'custom-new':4}};
    first.app.state.productIcons={'fr-pommes':{kind:'emoji',value:'🌟'}};
    first.app.state.lists={'custom-store':{storeId:'custom-store',items:[{productId:'custom-new'}],updatedAt:200}};
    first.app.persist();
    saved=first.memory.get('tucompra:state:v1');
  }finally {await first.cleanup();}
  const run=await runtime(true);
  try {
    run.memory.set('tucompra:state:v1',saved);
    run.app.hydrate();
    const posts=[];
    globalThis.fetch=async(_url,init)=>{
      if(init.method==='POST') {const body=JSON.parse(init.body);posts.push(body.snapshot);return run.respond({ok:true,updatedAt:body.updatedAt});}
      return run.respond({snapshot:{...snapshot('en',100),customCategories:[],defaultStores:{},usage:{},productIcons:{},customProducts:[{id:'custom-delete',name:'Delete me',categoryId:'otr-otros',icon:{kind:'emoji',value:'⭐'},defaultUnit:'unidad'}]}});
    };
    await run.sync.startSync();
    assert.equal(run.app.state.catalogLocale,'en');
    assert.deepEqual(run.app.state.defaultStores,{otros:'custom-store'});
    assert.deepEqual(run.app.state.usage,{'custom-store':{'custom-new':4}});
    assert.equal(run.app.state.productIcons['fr-pommes'].value,'🌟');
    assert(run.app.state.products.some(p=>p.id==='custom-new'));
    assert(!run.app.state.products.some(p=>p.id==='custom-delete'));
    assert(run.app.state.stores.some(s=>s.id==='custom-store'));
    assert(run.app.state.categories.some(c=>c.id==='custom-category'));
    assert.equal(posts[0].catalogLocale,'en');
    assert(!posts[0].customProducts.some(p=>p.id==='custom-delete'));
    assert(!('localSync' in posts[0]));
  }finally {await run.cleanup();}
});

test('repair: first-ever local mutation is recorded and saved synchronously',async()=>{
  const run=await runtime(true);
  try {
    run.app.createCustomProduct('First item','otr-otros');
    const saved=JSON.parse(run.memory.get('tucompra:state:v1'));
    assert(saved.localSync.fields.customProducts);
    assert(saved.products.some(p=>p.name==='First item'));
    assert(!createInitialState().products.some(p=>p.name==='First item'));
    await new Promise(resolve=>setImmediate(resolve));
  }finally {await run.cleanup();}
});

test('repair: focus and visibility recovery cannot bypass authority and stop removes retries',async()=>{
  const run=await runtime(true);
  try {
    const listeners=new Map();
    globalThis.window={addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)};
    globalThis.document={visibilityState:'visible',addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)};
    const calls=[];
    globalThis.fetch=async(_url,init)=>{calls.push(init.method??'GET');throw new Error('offline');};
    await run.sync.startSync();
    await listeners.get('focus')();
    await listeners.get('visibilitychange')();
    assert.deepEqual(calls,['GET','GET','GET']);
    assert.equal(run.sync.syncStatus.authoritative,false);
    const obsoleteRetry=[...run.intervals.values()][0];
    await run.sync.stopSync();
    await obsoleteRetry();
    assert.deepEqual(calls,['GET','GET','GET']);
    assert.equal(listeners.size,0);
    assert.equal(run.intervals.size,0);
  }finally {await run.cleanup();}
});

test('repair: stopping during startup cannot resurrect the transport',async()=>{
  const run=await runtime(true);
  try {
    let calls=0;
    globalThis.fetch=async()=>{calls++;return run.respond({snapshot:snapshot('en',10)});};
    const starting=run.sync.startSync();
    await run.sync.stopSync();
    await starting;
    assert.equal(calls,0);
    assert.equal(run.intervals.size,0);
    assert.equal(run.sync.syncStatus.enabled,false);
    assert.equal(run.sync.syncStatus.authoritative,false);
  }finally {await run.cleanup();}
});

test('repair: late GET from stopped session cannot contaminate restarted same share',async()=>{
  const run=await runtime(true);
  try {
    let oldResolve;
    const calls=[];
    globalThis.fetch=async(_url,init)=>{
      calls.push(init.method??'GET');
      if(calls.length===1) return new Promise(resolve=>{oldResolve=resolve;});
      return run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:snapshot('fr',20)});
    };
    const old=run.sync.startSync();
    await new Promise(resolve=>setImmediate(resolve));
    await run.sync.stopSync();
    await run.sync.startSync();
    oldResolve(run.respond({snapshot:snapshot('de',100)}));
    await old;
    assert.equal(run.app.state.catalogLocale,'fr');
    assert.deepEqual(calls,['GET','GET','POST']);
    assert.equal(run.intervals.size,1);
  }finally {await run.cleanup();}
});

test('repair: acknowledgement of an in-flight POST cannot erase a later mutation',async()=>{
  const run=await runtime(true);
  try {
    globalThis.fetch=async(_url,init)=>run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:{...snapshot('en',10),customCategories:[]}});
    await run.sync.startSync();
    run.app.setDefaultStore('supermercado','uk-tesco');
    let finish,firstBody;
    globalThis.fetch=async(_url,init)=>{firstBody=JSON.parse(init.body);return new Promise(resolve=>{finish=resolve;});};
    const sending=run.sync.pushNow();
    run.app.setDefaultStore('supermercado','uk-asda');
    const newestRevision=run.app.state.localSync.fields.defaultStores;
    finish(run.respond({ok:true,updatedAt:firstBody.updatedAt}));
    await sending;
    assert.equal(run.app.state.localSync.fields.defaultStores,newestRevision);
    assert.equal(JSON.parse(run.memory.get('tucompra:state:v1')).defaultStores.supermercado,'uk-asda');
    assert(firstBody.snapshot.defaultStores.supermercado==='uk-tesco');
    const bodies=[];
    globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);bodies.push(body);return run.respond({ok:true,updatedAt:body.updatedAt});};
    await run.sync.pushNow();
    assert.equal(bodies[0].snapshot.defaultStores.supermercado,'uk-asda');
    assert.deepEqual(run.app.state.localSync.fields,{});
    await new Promise(resolve=>setImmediate(resolve));
  }finally {await run.cleanup();}
});

for(const outcome of ['failed','not accepted']) {
  test(`repair: ${outcome} POST retains pending changes and retries via GET before POST`,async()=>{
    const run=await runtime(true);
    try {
      globalThis.fetch=async(_url,init)=>run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:{...snapshot('en',10),customCategories:[]}});
      await run.sync.startSync();
      run.app.setDefaultStore('supermercado','uk-tesco');
      globalThis.fetch=async(_url,init)=>{
        if(outcome==='failed') throw new Error('offline');
        return run.respond({ok:true,updatedAt:JSON.parse(init.body).updatedAt+100});
      };
      assert.equal(await run.sync.pushNow(),false);
      assert(run.app.state.localSync.fields.defaultStores);
      assert.equal(run.sync.syncStatus.authoritative,false);
      const methods=[];
      globalThis.fetch=async(_url,init)=>{
        methods.push(init.method??'GET');
        return run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:{...snapshot('en',20),customCategories:[],defaultStores:{}}});
      };
      await [...run.intervals.values()][0]();
      assert.deepEqual(methods,['GET','POST']);
      assert.equal(run.app.state.defaultStores.supermercado,'uk-tesco');
      assert.deepEqual(run.app.state.localSync.fields,{});
      await new Promise(resolve=>setImmediate(resolve));
    }finally {await run.cleanup();}
  });
}

test('repair: queued POST captures current state after previous acknowledgement',async()=>{
  const run=await runtime(true);
  const realNow=Date.now;
  try {
    Date.now=()=>100;
    globalThis.fetch=async(_url,init)=>run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:{...snapshot('en',10),customCategories:[]}});
    await run.sync.startSync();
    const bodies=[],completions=[];
    globalThis.fetch=async(_url,init)=>{bodies.push(JSON.parse(init.body));return new Promise(resolve=>completions.push(resolve));};
    run.app.setDefaultStore('supermercado','uk-tesco');
    const first=run.sync.pushNow();
    run.app.setDefaultStore('supermercado','uk-asda');
    const queued=run.sync.pushNow();
    assert.equal(bodies.length,1);
    completions[0](run.respond({ok:true,updatedAt:bodies[0].updatedAt}));
    await first;
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(bodies.length,2);
    assert.equal(bodies[1].snapshot.defaultStores.supermercado,'uk-asda');
    assert(bodies[1].updatedAt>bodies[0].updatedAt);
    completions[1](run.respond({ok:true,updatedAt:bodies[1].updatedAt}));
    await queued;
    assert.deepEqual(run.app.state.localSync.fields,{});
  }finally {Date.now=realNow;await run.cleanup();}
});

test('repair: old POST acknowledgement cannot clear pending edits in a restarted session',async()=>{
  const run=await runtime(true);
  try {
    globalThis.fetch=async(_url,init)=>run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:{...snapshot('en',10),customCategories:[]}});
    await run.sync.startSync();
    run.app.setDefaultStore('supermercado','uk-tesco');
    let oldBody,oldFinish;
    globalThis.fetch=async(_url,init)=>{oldBody=JSON.parse(init.body);return new Promise(resolve=>{oldFinish=resolve;});};
    const old=run.sync.pushNow();
    await run.sync.stopSync();
    run.app.setDefaultStore('supermercado','uk-asda');
    const currentRevision=run.app.state.localSync.fields.defaultStores;
    let newBody,newFinish;
    globalThis.fetch=async(_url,init)=>{
      if(init.method!=='POST') return run.respond({snapshot:{...snapshot('fr',20),customCategories:[]}});
      newBody=JSON.parse(init.body);return new Promise(resolve=>{newFinish=resolve;});
    };
    const restarted=run.sync.startSync();
    await new Promise(resolve=>setImmediate(resolve));
    oldFinish(run.respond({ok:true,updatedAt:oldBody.updatedAt}));
    assert.equal(await old,false);
    assert.equal(run.app.state.localSync.fields.defaultStores,currentRevision);
    assert.equal(run.app.state.catalogLocale,'fr');
    newFinish(run.respond({ok:true,updatedAt:newBody.updatedAt}));
    await restarted;
    assert.deepEqual(run.app.state.localSync.fields,{});
  }finally {await run.cleanup();}
});

test('repair: clean remote metadata advances despite a pending local list with newer time',async()=>{
  const run=await runtime(true);
  try {
    let remote={...snapshot('en',10),customCategories:[],defaultStores:{}};
    let confirmedAt=0;
    globalThis.fetch=async(_url,init)=>{
      if(init.method==='POST') {confirmedAt=JSON.parse(init.body).updatedAt;return run.respond({ok:true,updatedAt:confirmedAt});}
      return run.respond({snapshot:remote});
    };
    await run.sync.startSync();
    run.app.state.lists['uk-tesco']={storeId:'uk-tesco',items:[{productId:'uk-apples'}],updatedAt:Date.now()+100000};
    run.app.persist();
    remote={...snapshot('en',confirmedAt+1),customCategories:[],defaultStores:{farmacia:'uk-boots'}};
    await [...run.intervals.values()][0]();
    assert.equal(run.app.state.defaultStores.farmacia,'uk-boots');
    assert.equal(run.app.state.lists['uk-tesco'].items[0].productId,'uk-apples');
    await new Promise(resolve=>setImmediate(resolve));
  }finally {await run.cleanup();}
});

test('repair: GET captured before accepted POST cannot roll back acknowledged metadata',async()=>{
  const run=await runtime(true);
  const realNow=Date.now;
  try {
    Date.now=()=>100;
    globalThis.fetch=async(_url,init)=>run.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:{...snapshot('en',10),customCategories:[],defaultStores:{}}});
    await run.sync.startSync();
    let finishGet;
    globalThis.fetch=async(_url,init)=>{
      if(init.method!=='POST') return new Promise(resolve=>{finishGet=resolve;});
      return run.respond({ok:true,updatedAt:JSON.parse(init.body).updatedAt});
    };
    const delayed=[...run.intervals.values()][0]();
    Date.now=()=>200;
    run.app.setDefaultStore('supermercado','uk-asda');
    assert.equal(await run.sync.pushNow(),true);
    assert.deepEqual(run.app.state.localSync.fields,{});
    finishGet(run.respond({snapshot:{...snapshot('en',150),customCategories:[],defaultStores:{supermercado:'uk-tesco'}}}));
    await delayed;
    assert.equal(run.app.state.defaultStores.supermercado,'uk-asda');
    await new Promise(resolve=>setImmediate(resolve));
  }finally {Date.now=realNow;await run.cleanup();}
});


test('repair: edits during share transition survive cached reload and return to their share',async()=>{
  const first=await runtime(true);
  let saved;
  try {
    first.app.state=refreshCatalog(createInitialState(),'en');
    globalThis.fetch=async(_url,init)=>first.respond(init.method==='POST'?{ok:true,updatedAt:JSON.parse(init.body).updatedAt}:{snapshot:snapshot('en',10)});
    await first.sync.startSync();
    let targetResolve;
    globalThis.fetch=async(_url,init)=>{
      if(init.method==='POST') return first.respond({ok:true,updatedAt:JSON.parse(init.body).updatedAt});
      if(!targetResolve) return new Promise(resolve=>{targetResolve=resolve;});
      return first.respond({snapshot:snapshot('fr',20)});
    };
    const switching=first.sync.switchShare('shared:new');
    while(!targetResolve) await new Promise(resolve=>setImmediate(resolve));
    first.app.state.defaultStores={supermercado:'uk-tesco'};
    first.app.persist();
    targetResolve(first.respond({snapshot:snapshot('fr',20)}));
    await switching;
    assert.equal(first.sync.syncStatus.activeShareId,'shared:new');
    assert.deepEqual(first.app.state.defaultStores??{},{});
    const cached=JSON.parse(first.memory.get('tucompra:state:v1:share:shared:old'));
    assert(cached.localSync.fields.defaultStores);
    saved=new Map(first.memory);
  } finally {await first.cleanup();}
  const run=await runtime(true);
  try {
    for(const [key,value] of saved) run.memory.set(key,value);
    run.app.hydrate();
    run.sync.syncStatus.activeShareId='shared:new';
    const posts=[];
    globalThis.fetch=async(url,init)=>{
      if(init.method==='POST') {
        const body=JSON.parse(init.body);
        posts.push({url,snapshot:body.snapshot});
        return run.respond({ok:true,updatedAt:body.updatedAt});
      }
      return run.respond({snapshot:{...snapshot(url.includes('shared%3Aold')?'en':'fr',10),customCategories:[],defaultStores:{}}});
    };
    await run.sync.startSync();
    await run.sync.switchShare('shared:old');
    assert.equal(run.sync.syncStatus.activeShareId,'shared:old');
    assert.deepEqual(run.app.state.defaultStores,{supermercado:'uk-tesco'});
    assert(posts.some(post=>post.url.includes('shared%3Aold')&&post.snapshot.defaultStores.supermercado==='uk-tesco'));
    assert.deepEqual(run.app.state.localSync.fields,{});
  } finally {await run.cleanup();}
});
