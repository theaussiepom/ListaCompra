<script lang="ts">
  // Vista de la lista de una tienda concreta.
  // - Búsqueda combinada por categoría/sección + texto
  // - Crea producto libre con Enter si no hay match
  // - Cada item de la lista permite ajustar cantidad (+/-) y cambiar unidad
  //   sin abandonar la pantalla.

  import { onMount } from 'svelte';
  import { app } from '$lib/stores/app.svelte';
  import { base } from '$lib/base';
  import { t } from '$lib/i18n/ui.svelte';
  import { rankMatches, selectAutomaticMatch } from '$lib/search';
  import { createListComparators } from '$lib/listSorting';
  import type { Product, Unit } from '$lib/types';
  import MenuButton from '../ui/MenuButton.svelte';
  import LoyaltyCard from '../loyalty/LoyaltyCard.svelte';
  import ProductScanDialog from '../loyalty/ProductScanDialog.svelte';
  import ProductIcon from '../ui/ProductIcon.svelte';
  import CustomProducts from '../loyalty/CustomProducts.svelte';
  import ProductEditor from '../loyalty/ProductEditor.svelte';
  import HoldButton from '../ui/HoldButton.svelte';
  import PhotoZoom from '../ui/PhotoZoom.svelte';

  let { storeId }: { storeId: string } = $props();

  let query = $state('');
  let activeCat = $state<string | 'all'>('all');
  // Item cuyo selector "mover a otra tienda" está abierto (triaje de bandeja).
  let movingItemId = $state<string | null>(null);
  // Tarjeta de fidelización a pantalla completa (para pasarla por caja).
  let showLoyalty = $state(false);
  // Alta de producto escaneando su código de barras.
  let showScanProduct = $state(false);
  // Gestor de los productos creados por el usuario (editar / borrar).
  let showMyProducts = $state(false);
  // Producto cuya foto se está viendo en grande.
  let zoomProduct = $state<Product | null>(null);
  // Producto que se está editando desde su fila de la lista (✏️).
  let editingProduct = $state<Product | null>(null);

  const INBOX_ID = 'inbox';

  const UNITS: Unit[] = ['unidad', 'kg', 'g', 'l', 'ml', 'paquete', 'docena', 'caja'];

  const sorting = $derived(createListComparators(app.state.locale));

  // Cuántos productos "habituales" mostramos cuando no hay búsqueda.
  const HABITUALES_LIMIT = 20;

  onMount(() => app.hydrate());

  const store = $derived(app.state.stores.find((s) => s.id === storeId));
  const list = $derived(app.state.lists[storeId] ?? { storeId, items: [], updatedAt: 0 });

  // Categorías disponibles para el tipo de tienda actual, ordenadas A-Z.
  const categories = $derived(
    store
      ? app.state.categories
          .filter((c) => c.typeId === store.typeId)
          .slice()
          .sort(sorting.byCategory)
      : [],
  );

  // Productos disponibles en ESTA tienda: los de su tipo, excluyendo los que
  // son exclusivos de otra tienda (marcas propias: Hacendado, Eroski Basic…).
  const productsForType = $derived.by(() => {
    if (!store) return [];
    const catIds = new Set(categories.map((c) => c.id));
    return app.state.products.filter(
      (p) => catIds.has(p.categoryId) && (!p.storeId || p.storeId === storeId),
    );
  });

  // Cuántos productos custom hay disponibles en esta tienda (para el enlace).
  // Todos los de esta tienda: desde ahí se le pone imagen a cualquiera, no solo
  // a los escaneados.
  const myProductCount = $derived(productsForType.length);

  // Sugerencias bajo el buscador. Tres modos:
  //  - Con texto: busca en todo el catálogo del tipo de tienda (incluso si
  //    hay categoría activa, busca dentro de ella).
  //  - Sin texto + categoría: muestra los habituales de esa categoría, y si
  //    no hay habituales, los primeros 12 alfabéticos como fallback.
  //  - Sin texto + 'Todas': sólo los habituales del usuario en esta tienda.
  //    Si nunca ha comprado nada, sale vacío y el usuario usa la búsqueda.
  const filtered = $derived.by(() => {
    let pool = productsForType;
    if (activeCat !== 'all') pool = pool.filter((p) => p.categoryId === activeCat);

    if (query.trim()) {
      // Las sugerencias admiten coincidencias débiles: el usuario elige.
      return rankMatches(pool, query).slice(0, 60);
    }

    // Sin texto: ordenamos por uso descendente y cogemos los top.
    const habituales = pool
      .map((p) => ({ p, count: app.usageCount(storeId, p.id) }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count || sorting.byName(a.p, b.p))
      .slice(0, HABITUALES_LIMIT)
      .map((x) => x.p);

    if (habituales.length > 0) return habituales;

    // Fallback: si hay categoría activa pero el usuario no ha comprado nada
    // ahí todavía, mostramos los primeros 12 alfabéticos para arrancar.
    if (activeCat !== 'all') {
      return pool.slice().sort(sorting.byName).slice(0, HABITUALES_LIMIT);
    }
    return [];
  });

  const showingHabituales = $derived(query.trim() === '' && filtered.length > 0);

  // Lista actual agrupada por categoría, categorías y productos en orden A-Z.
  const grouped = $derived.by(() => {
    const byCat = new Map<string, typeof list.items>();
    for (const it of list.items) {
      const product = app.state.products.find((p) => p.id === it.productId);
      const catId = product?.categoryId ?? 'unknown';
      if (!byCat.has(catId)) byCat.set(catId, []);
      byCat.get(catId)!.push(it);
    }
    return [...byCat.entries()]
      .map(([catId, items]) => ({
        category: app.state.categories.find((c) => c.id === catId),
        items: items.slice().sort((a, b) => {
          const pa = app.state.products.find((p) => p.id === a.productId)?.name ?? '';
          const pb = app.state.products.find((p) => p.id === b.productId)?.name ?? '';
          return sorting.compareNames(pa, pb);
        }),
      }))
      .sort((a, b) =>
        sorting.byCategory(a.category, b.category),
      );
  });

  function addProduct(productId: string) {
    const p = app.state.products.find((x) => x.id === productId);
    app.addItem(storeId, {
      productId,
      qty: 1,
      unit: p?.defaultUnit ?? 'unidad',
    });
    query = '';
  }

  /** Enter exige confianza; una sugerencia pulsada conserva la elección explícita. */
  function handleQueryKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = query.trim();
    if (!q || !store) return;
    const matched = selectAutomaticMatch(productsForType, q);
    if (matched) return addProduct(matched.id);
    const created = app.createFreeProduct(q, store.typeId);
    addProduct(created.id);
  }

  function product(id: string) {
    return app.state.products.find((p) => p.id === id);
  }

  function step(itemId: string, delta: number) {
    const it = list.items.find((i) => i.id === itemId);
    if (!it) return;
    app.setItemQty(storeId, itemId, it.qty + delta);
  }

  const isInbox = $derived(storeId === INBOX_ID);

  // Tiendas disponibles para mover, sin incluir la actual.
  const moveTargets = $derived(
    app.state.stores.filter((s) => s.enabled !== false && s.id !== storeId).slice().sort(sorting.byName),
  );

  // Tienda sugerida para un producto (categoría → tipo → default), o null.
  function suggestedStore(productId: string) {
    const id = app.suggestStoreFor(productId);
    if (!id || id === storeId) return null;
    return app.state.stores.find((s) => s.id === id) ?? null;
  }

  function moveTo(itemId: string, toStoreId: string) {
    if (!toStoreId) return;
    app.moveItem(storeId, itemId, toStoreId);
    movingItemId = null;
  }

  const doneCount = $derived(list.items.filter((i) => i.done).length);

  function clearDone() {
    if (doneCount === 0) {
      alert(t('list.noneDone'));
      return;
    }
    if (!confirm(t('list.confirmClearDone', { n: doneCount }))) return;
    app.clearDone(storeId);
  }

  function clearAll() {
    if (list.items.length === 0) return;
    if (!confirm(t('list.confirmEmpty', { n: list.items.length }))) return;
    for (const it of [...list.items]) app.removeItem(storeId, it.id);
  }
</script>

{#if !store}
  <p>{t('list.storeNotFound')}</p>
{:else}
  <div class="space-y-4">
    <!-- Sticky COMPACTO: controles (volver/limpiar) SIEMPRE visibles + buscador.
         Al escribir, los resultados salen en una tira fina aquí mismo, para
         añadir sin subir. Las secciones y habituales van debajo (no sticky) y
         scrollan, así en pantallas pequeñas la lista queda visible. -->
    <div class="sticky top-0 z-30 -mx-4 px-4 pt-1 pb-2 space-y-2" style="background: var(--bg);">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <MenuButton />
          <a href="#/" class="text-sm text-muted hover:underline shrink-0">← {t('nav.stores')}</a>
          <span class="font-semibold flex items-center gap-1 min-w-0">
            {#if store.icon.kind === 'image'}
              <img src={store.icon.value.startsWith('data:') ? store.icon.value : base(store.icon.value)}
                alt="" class="size-5 object-contain shrink-0" />
            {:else if store.icon.kind === 'emoji'}
              <span class="shrink-0">{store.icon.value}</span>
            {/if}
            <span class="truncate">{store.name}</span>
          </span>
        </div>
        <div class="flex gap-1 shrink-0">
          {#if store.loyalty}
            <button onclick={() => (showLoyalty = true)}
              title={t('list.showLoyalty')}
              class="text-xs rounded-full border px-2.5 py-1.5 hover:bg-[var(--bg)] transition"
              style="border-color: var(--border);">🎟️</button>
          {/if}
          <button onclick={clearDone}
            disabled={doneCount === 0}
            class="text-xs rounded-full border px-2.5 py-1.5 hover:bg-[var(--bg)] transition disabled:opacity-40"
            style="border-color: var(--border);"
            title={t('list.clearDoneTitle')}>
            🧹<span class="hidden sm:inline"> {t('list.clearDone')}</span> {doneCount > 0 ? `(${doneCount})` : ''}
          </button>
          <button onclick={clearAll}
            disabled={list.items.length === 0}
            class="text-xs rounded-full border px-2.5 py-1.5 hover:bg-[var(--bg)] transition disabled:opacity-40"
            style="border-color: var(--border); color: #dc2626;"
            title={t('list.emptyList')}>
            🗑️
          </button>
        </div>
      </div>

      <div class="flex gap-2">
        <input
          type="text" bind:value={query} placeholder={t('list.search')}
          onkeydown={handleQueryKeydown}
          class="flex-1 rounded-xl border px-4 py-2.5 bg-transparent"
          style="border-color: var(--border);"
        />
        <button onclick={() => (showScanProduct = true)}
          title={t('list.scan')}
          class="shrink-0 rounded-xl border px-3 hover:bg-[var(--bg)] transition"
          style="border-color: var(--border);">📷</button>
      </div>

      <!-- Resultados de búsqueda: una fila con scroll horizontal (compacta). -->
      {#if query.trim()}
        {#if filtered.length > 0}
          <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {#each filtered as p (p.id)}
              <button onclick={() => addProduct(p.id)}
                class="shrink-0 rounded-full border px-3 py-1.5 text-sm hover:bg-[var(--accent)] hover:text-white transition inline-flex items-center gap-1.5"
                style="border-color: var(--border);">
                <ProductIcon product={p} size="text-base" px={18} /> {p.name}
              </button>
            {/each}
          </div>
        {:else}
          <p class="text-xs text-muted">
            {t('list.noMatches')} <kbd class="rounded border px-1.5 py-0.5 text-xs"
              style="border-color: var(--border);">Enter</kbd> {t('list.pressEnter')} "<strong>{query}</strong>".
          </p>
        {/if}
      {/if}
    </div>

    <!-- Secciones + habituales: NO sticky, solo cuando no hay búsqueda activa. -->
    {#if !query.trim()}
      <div class="card-elev p-4 space-y-3">
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-semibold uppercase tracking-wider text-muted">{t('list.section')}</span>
            {#if activeCat !== 'all'}
              <button onclick={() => (activeCat = 'all')}
                class="text-xs text-muted hover:underline">{t('list.clearSection')}</button>
            {/if}
          </div>
          <div class="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scroll-smooth">
            <button onclick={() => (activeCat = 'all')}
              class="shrink-0 w-20 h-20 rounded-2xl border-2 flex flex-col items-center justify-center gap-0.5 transition"
              class:cat-active={activeCat === 'all'}
              style="border-color: var(--border);">
              <span class="text-2xl">🗂️</span>
              <span class="text-[11px] font-medium leading-tight text-center">{t('list.allSections')}</span>
            </button>
            {#each categories as c (c.id)}
              <button onclick={() => (activeCat = c.id)}
                class="shrink-0 w-20 h-20 rounded-2xl border-2 flex flex-col items-center justify-center gap-0.5 px-1 transition"
                class:cat-active={activeCat === c.id}
                style="border-color: var(--border);">
                <span class="text-2xl">{c.icon.kind === 'emoji' ? c.icon.value : '📁'}</span>
                <span class="text-[11px] font-medium leading-tight text-center line-clamp-2">{c.name}</span>
              </button>
            {/each}
          </div>
        </div>

        {#if filtered.length > 0}
          {#if showingHabituales}
            <p class="text-xs font-semibold uppercase tracking-wider text-muted">
              {t('list.usualHeader', { where: activeCat !== 'all' ? t('list.usualSection') : t('list.usualHere') })}
            </p>
          {/if}
          <div class="flex flex-wrap gap-2">
            {#each filtered as p (p.id)}
              <button onclick={() => addProduct(p.id)}
                class="rounded-full border px-3 py-1.5 text-sm hover:bg-[var(--accent)] hover:text-white transition inline-flex items-center gap-1.5"
                style="border-color: var(--border);">
                <ProductIcon product={p} size="text-base" px={18} /> {p.name}
              </button>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-muted">{t('list.emptySection')}</p>
        {/if}

        {#if myProductCount > 0}
          <button onclick={() => (showMyProducts = true)}
            class="text-xs text-muted hover:underline">
            {t('list.myProductsLink', { n: myProductCount })}
          </button>
        {/if}
      </div>
    {/if}

    {#if isInbox && list.items.length > 0}
      <div class="card-elev p-3 text-sm flex items-start gap-2"
        style="border-left: 3px solid var(--accent);">
        <span class="text-lg leading-none">📥</span>
        <span>{t('list.inboxHint')} {t('list.moveHint')}</span>
      </div>
    {/if}

    <!-- Lista agrupada -->
    {#if list.items.length === 0}
      <p class="text-center text-muted py-12">
        {isInbox ? t('list.inboxEmpty') : t('list.emptyAll')}
      </p>
    {:else}
      <div class="space-y-4">
        {#each grouped as group (group.category?.id ?? 'x')}
          <section class="card-elev p-4">
            <h3 class="font-semibold mb-3 flex items-center gap-2">
              <span>{group.category?.icon.kind === 'emoji' ? group.category.icon.value : '📁'}</span>
              {group.category?.name ?? t('list.noCategory')}
              <span class="text-xs text-muted ml-auto">{group.items.length}</span>
            </h3>
            <ul class="divide-y" style="border-color: var(--border);">
              {#each group.items as item (item.id)}
                {@const p = product(item.productId)}
                {@const sug = suggestedStore(item.productId)}
                <li class={`flex items-center gap-3 py-2.5 flex-wrap ${item.done ? 'product-done' : ''}`}>
                  <button onclick={() => app.toggleItem(storeId, item.id)}
                    class="size-9 shrink-0 rounded-full border-2 grid place-items-center transition"
                    style={item.done
                      ? 'background: var(--accent); border-color: var(--accent); color: white;'
                      : 'border-color: var(--border);'}>
                    {item.done ? '✓' : ''}
                  </button>
                  {#if p?.icon.kind === 'image'}
                    <button onclick={() => (zoomProduct = p!)} class="shrink-0"
                      title={t('list.zoomPhoto')}>
                      <ProductIcon product={p} px={30} />
                    </button>
                  {:else}
                    <ProductIcon product={p} px={30} />
                  {/if}
                  <div class="flex-1 min-w-0">
                    <div class="product-name font-medium truncate">{p?.name ?? '?'}</div>
                    <div class="flex items-center gap-1.5 mt-1 flex-wrap">
                      <button onclick={() => step(item.id, -1)}
                        class="size-7 rounded-full border grid place-items-center hover:bg-[var(--bg)]"
                        style="border-color: var(--border);">−</button>
                      <input type="number" min="0.1" step="0.1" value={item.qty}
                        oninput={(e) => app.setItemQty(storeId, item.id, parseFloat(e.currentTarget.value) || 0)}
                        class="w-14 text-center text-sm rounded-md border px-1 py-0.5 bg-transparent"
                        style="border-color: var(--border);" />
                      <button onclick={() => step(item.id, +1)}
                        class="size-7 rounded-full border grid place-items-center hover:bg-[var(--bg)]"
                        style="border-color: var(--border);">+</button>
                      <select value={item.unit}
                        onchange={(e) => app.setItemUnit(storeId, item.id, e.currentTarget.value as Unit)}
                        class="text-xs rounded-md border px-1.5 py-0.5 bg-transparent"
                        style="border-color: var(--border);">
                        {#each UNITS as u}<option value={u}>{u}</option>{/each}
                      </select>
                    </div>
                  </div>
                  <!-- Editar el producto desde donde se está viendo: es la vía
                       corta para ponerle imagen sin buscarlo en otra pantalla.
                       Va con mantener pulsado porque los botones de la fila están
                       muy juntos y abrir el editor sin querer molesta. -->
                  {#if p}
                    <HoldButton title={t('product.holdToEdit')}
                      onHold={() => (editingProduct = p)}>✏️</HoldButton>
                  {/if}
                  <button onclick={() => (movingItemId = movingItemId === item.id ? null : item.id)}
                    class="text-muted hover:text-current text-lg shrink-0"
                    title={t('list.move')}>↪</button>
                  <button onclick={() => app.removeItem(storeId, item.id)}
                    class="text-muted hover:text-red-500 text-2xl shrink-0" title={t('list.remove')}>×</button>

                  {#if movingItemId === item.id}
                    <div class="basis-full mt-2 flex items-center gap-2 flex-wrap pl-12">
                      <span class="text-xs text-muted">{t('list.moveTo')}</span>
                      {#if sug}
                        <button onclick={() => moveTo(item.id, sug.id)}
                          class="rounded-full px-3 py-1 text-xs font-medium text-white"
                          style="background: var(--accent);"
                          title={t('list.suggestedStore')}>⭐ {sug.name}</button>
                      {/if}
                      <select onchange={(e) => moveTo(item.id, e.currentTarget.value)}
                        class="text-xs rounded-md border px-2 py-1 bg-transparent"
                        style="border-color: var(--border);">
                        <option value="">{t('list.chooseStore')}</option>
                        {#each moveTargets as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
                      </select>
                      <button onclick={() => (movingItemId = null)}
                        class="text-xs text-muted hover:underline">{t('list.cancelLower')}</button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {/if}
  </div>

  {#if showLoyalty && store.loyalty}
    <LoyaltyCard {store} onClose={() => (showLoyalty = false)} />
  {/if}

  {#if showMyProducts}
    <CustomProducts {categories} {storeId} storeName={store.name}
      onClose={() => (showMyProducts = false)} />
  {/if}

  {#if zoomProduct}
    <PhotoZoom product={zoomProduct} onClose={() => (zoomProduct = null)} />
  {/if}

  {#if editingProduct}
    <ProductEditor product={editingProduct} {categories} {storeId} storeName={store.name}
      onClose={() => (editingProduct = null)} />
  {/if}

  {#if showScanProduct}
    <ProductScanDialog
      {categories} {storeId} storeName={store.name}
      defaultCategoryId={activeCat !== 'all' ? activeCat : undefined}
      onAdd={(id) => app.addOrBumpItem(storeId, id)}
      onClose={() => (showScanProduct = false)} />
  {/if}
{/if}

<style>
  .cat-active {
    background: var(--accent);
    color: white;
    border-color: var(--accent) !important;
    box-shadow: 0 4px 12px -4px var(--accent);
  }
</style>
