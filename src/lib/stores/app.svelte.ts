// Store global con Svelte 5 runes. Una única fuente de verdad para toda la app.
// Se hidrata desde LocalStorage al iniciar y se autoguarda al cambiar.

import type { AppState, IconRef, ListItem, Product, ShoppingList, Store, UserProfile } from '../types';
import { createInitialState, loadState, saveState } from '../storage';
import { getLocalizedSeed, LOCALIZED_STORES } from '../data/locales';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../i18n/locale';
import { getDefaultStore, suggestStoreFor } from '../storeRouting';

// IDs de tienda de TODOS los locales: sirve para distinguir "tienda de seed
// (de cualquier idioma)" de "tienda custom del usuario".
const ALL_SEED_STORE_IDS = new Set(
  LOCALES.flatMap((l) => LOCALIZED_STORES[l].map((s) => s.id)),
);

class AppStore {
  state = $state<AppState>(createInitialState());
  hydrated = $state(false);

  /** Re-sincroniza el seed (tipos, tiendas, categorías, productos) con el locale
   *  actual. Preserva las customizaciones del usuario (tiendas/productos creados
   *  por él, enabled/order de tiendas seed, listas). Al cambiar de locale, las
   *  tiendas/productos del locale anterior se retiran (no son custom). */
  private refreshSeed(): void {
    const seed = getLocalizedSeed(this.state.locale ?? DEFAULT_LOCALE);
    const seedStoreIds = new Set(seed.stores.map((s) => s.id));
    const seedCategoryIds = new Set(seed.categories.map((c) => c.id));

    // Tiendas:
    //  - Editadas por el usuario (edited) del locale actual: se respetan.
    //  - Seed normales del locale actual: refresh preservando order/enabled.
    //  - Custom del usuario (id que no es seed de NINGÚN locale): se mantienen.
    //  - Tiendas seed de OTROS locales: se descartan (cambio de idioma limpio).
    const localById = new Map(this.state.stores.map((s) => [s.id, s]));
    const customStores = this.state.stores.filter((s) => !ALL_SEED_STORE_IDS.has(s.id));
    const editedSeedStores = this.state.stores.filter(
      (s) => seedStoreIds.has(s.id) && s.edited,
    );
    const editedSeedIds = new Set(editedSeedStores.map((s) => s.id));

    this.state.stores = [
      ...seed.stores
        .filter((s) => !editedSeedIds.has(s.id))
        .map((s) => {
          const local = localById.get(s.id);
          return { ...s, order: local?.order ?? s.order, enabled: local?.enabled ?? s.enabled };
        }),
      ...editedSeedStores,
      ...customStores,
    ];

    // Categorías y productos: refresco completo del seed localizado; preservamos
    // los custom (categorías no-seed, productos con prefijo custom-).
    const customCategories = this.state.categories.filter((c) => !seedCategoryIds.has(c.id));
    this.state.categories = [...seed.categories, ...customCategories];

    const customProducts = this.state.products.filter((p) => p.id.startsWith('custom-'));
    this.state.products = [...seed.products, ...customProducts];

    // Iconos elegidos por el usuario: se aplican DESPUÉS de rehacer el seed,
    // que es lo que les permite sobrevivir al arranque y al cambio de idioma.
    const icons = this.state.productIcons;
    if (icons && Object.keys(icons).length > 0) {
      this.state.products = this.state.products.map((p) =>
        icons[p.id] ? { ...p, icon: icons[p.id] } : p,
      );
    }

    this.state.storeTypes = seed.storeTypes;
  }

  /** Fija el icono de un producto (del seed o custom). `null` lo devuelve al
   *  original: el emoji del seed, o la foto de Open Food Facts si se escaneó. */
  setProductIcon(id: Product['id'], icon: IconRef | null): void {
    this.state.productIcons ??= {};
    if (icon) this.state.productIcons[id] = icon;
    else delete this.state.productIcons[id];
    this.refreshSeed();
    this.persist();
  }

  /** ¿Tiene este producto un icono puesto por el usuario? */
  hasCustomIcon(id: Product['id']): boolean {
    return !!this.state.productIcons?.[id];
  }

  /** Cambia el locale (idioma/cultura del catálogo) y re-seedea. */
  setLocale(locale: Locale): void {
    if ((this.state.locale ?? DEFAULT_LOCALE) === locale) return;
    this.state.locale = locale;
    this.refreshSeed();
    this.persist();
  }

  hydrate(): void {
    if (this.hydrated) return;
    this.state = loadState();
    this.refreshSeed();
    this.hydrated = true;
    saveState(this.state);
  }

  /** Persiste a LocalStorage y, si la sync está activa, agenda un push a HA. */
  persist(): void {
    saveState(this.state);
    // Importación dinámica para no romper SSR ni cargar el bundle de sync
    // si el usuario aún no ha entrado en la app.
    import('../sync.svelte').then((m) => m.schedulePush()).catch(() => {});
  }

  /** Guarda en LocalStorage SIN disparar push. Se usa al aplicar un snapshot
   *  remoto, para no reenviar de vuelta lo que acabamos de recibir. */
  persistLocalOnly(): void {
    saveState(this.state);
  }

  // -------- Perfil --------
  setProfile(p: UserProfile): void {
    this.state.profile = p;
    this.persist();
  }

  signOut(): void {
    this.state.profile = undefined;
    this.persist();
  }

  // -------- Tiendas --------
  upsertStore(s: Store): void {
    const idx = this.state.stores.findIndex((x) => x.id === s.id);
    if (idx >= 0) this.state.stores[idx] = s;
    else this.state.stores.push(s);
    this.persist();
  }

  removeStore(id: string): void {
    this.state.stores = this.state.stores.filter((s) => s.id !== id);
    delete this.state.lists[id];
    // Si era la tienda por defecto de algún tipo, limpia esa preferencia.
    if (this.state.defaultStores) {
      for (const [typeId, storeId] of Object.entries(this.state.defaultStores)) {
        if (storeId === id) delete this.state.defaultStores[typeId];
      }
    }
    this.persist();
  }

  // -------- Tienda por defecto por tipo (enrutado por voz) --------
  /** Fija (o limpia, con null) la tienda por defecto de un tipo. */
  setDefaultStore(typeId: string, storeId: string | null): void {
    if (!this.state.defaultStores) this.state.defaultStores = {};
    if (storeId) this.state.defaultStores[typeId] = storeId;
    else delete this.state.defaultStores[typeId];
    this.persist();
  }

  /** Devuelve la tienda por defecto de un tipo. Si no hay una fijada y solo
   *  existe una tienda de ese tipo, devuelve esa (default implícito). */
  getDefaultStore(typeId: string): string | undefined {
    return getDefaultStore(typeId, this.state.stores, this.state.defaultStores);
  }

  // -------- Catálogo de productos --------
  /** Crea un producto libre en el catálogo (cuando el usuario teclea un nombre
   *  que no existe). Lo encajamos bajo la categoría "Otros" del tipo de tienda
   *  donde se está añadiendo, para que aparezca agrupado lógicamente. */
  createFreeProduct(name: string, typeId: string, emoji = '🏷️'): Product {
    // Busca la categoría "Otros" de ese tipo, o crea una si no existe.
    let otros = this.state.categories.find(
      (c) => c.typeId === typeId && c.name.toLowerCase() === 'otros',
    );
    if (!otros) {
      otros = {
        id: `${typeId}-otros`,
        name: 'Otros',
        typeId,
        icon: { kind: 'emoji', value: '🏷️' },
        order: 999,
      };
      this.state.categories.push(otros);
    }
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const product: Product = {
      id,
      name: name.trim(),
      categoryId: otros.id,
      icon: { kind: 'emoji', value: emoji },
      defaultUnit: 'unidad',
    };
    this.state.products.push(product);
    this.persist();
    return product;
  }

  /** Crea un producto personalizado en una categoría concreta. Lo usa el alta
   *  por escaneo de código de barras, donde el usuario elige la sección.
   *  Con `storeId` el producto queda EXCLUSIVO de esa tienda (marca propia). */
  createCustomProduct(
    name: string,
    categoryId: string,
    opts: { emoji?: string; storeId?: string; icon?: IconRef; barcode?: string } = {},
  ): Product {
    const product: Product = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      categoryId,
      icon: opts.icon ?? { kind: 'emoji', value: opts.emoji ?? '🏷️' },
      defaultUnit: 'unidad',
      ...(opts.storeId ? { storeId: opts.storeId } : {}),
      ...(opts.barcode ? { barcode: opts.barcode } : {}),
    };
    this.state.products.push(product);
    this.persist();
    return product;
  }

  /** Actualiza un producto del catálogo (solo tiene sentido para los custom:
   *  refreshSeed restauraría cualquier cambio en los del seed). */
  updateProduct(product: Product): void {
    const i = this.state.products.findIndex((p) => p.id === product.id);
    if (i < 0) return;
    this.state.products[i] = product;
    this.persist();
  }

  /** Borra un producto del catálogo y lo quita de todas las listas, para no
   *  dejar items huérfanos apuntando a un producto inexistente. */
  removeProduct(id: string): void {
    this.state.products = this.state.products.filter((p) => p.id !== id);
    for (const list of Object.values(this.state.lists)) {
      const before = list.items.length;
      list.items = list.items.filter((i) => i.productId !== id);
      if (list.items.length !== before) list.updatedAt = Date.now();
    }
    if (this.state.usage) {
      for (const usage of Object.values(this.state.usage)) delete usage[id];
    }
    this.persist();
  }

  /** Busca un producto por su código de barras. Es lo que evita duplicar el
   *  catálogo cada vez que se escanea el mismo producto. */
  findByBarcode(barcode: string): Product | undefined {
    const code = barcode.trim();
    if (!code) return undefined;
    return this.state.products.find((p) => p.barcode === code);
  }

  /** Añade un producto a la lista o, si ya está pendiente, suma 1 a su cantidad.
   *  Lo usa el escaneo: volver a pasar el mismo producto no debe crear otra fila. */
  addOrBumpItem(storeId: string, productId: string): void {
    const list = this.getList(storeId);
    const existing = list.items.find((i) => i.productId === productId && !i.done);
    if (existing) {
      this.setItemQty(storeId, existing.id, existing.qty + 1);
      return;
    }
    const p = this.state.products.find((x) => x.id === productId);
    this.addItem(storeId, { productId, qty: 1, unit: p?.defaultUnit ?? 'unidad' });
  }

  /** Cuántas veces aparece un producto en las listas (para avisar al borrar). */
  countItemsOf(productId: string): number {
    return Object.values(this.state.lists)
      .reduce((n, l) => n + l.items.filter((i) => i.productId === productId).length, 0);
  }

  // -------- Lista de la compra --------
  getList(storeId: string): ShoppingList {
    return (
      this.state.lists[storeId] ?? {
        storeId,
        items: [],
        updatedAt: Date.now(),
      }
    );
  }

  addItem(storeId: string, item: Omit<ListItem, 'id' | 'addedAt' | 'done'>): void {
    const list = this.getList(storeId);
    list.items.push({
      ...item,
      id: crypto.randomUUID(),
      addedAt: Date.now(),
      done: false,
    });
    list.updatedAt = Date.now();
    this.state.lists[storeId] = list;
    // Incrementa contador de uso del producto en esta tienda.
    if (!this.state.usage) this.state.usage = {};
    if (!this.state.usage[storeId]) this.state.usage[storeId] = {};
    this.state.usage[storeId][item.productId] =
      (this.state.usage[storeId][item.productId] ?? 0) + 1;
    this.persist();
  }

  /** Devuelve el contador de uso de un producto en una tienda concreta. */
  usageCount(storeId: string, productId: string): number {
    return this.state.usage?.[storeId]?.[productId] ?? 0;
  }

  /** Mueve un ítem de una tienda a otra (triaje de la bandeja "Por clasificar").
   *  Conserva cantidad, unidad y estado; suma uso en la tienda destino. */
  moveItem(fromStoreId: string, itemId: string, toStoreId: string): void {
    if (fromStoreId === toStoreId) return;
    const from = this.state.lists[fromStoreId];
    if (!from) return;
    const idx = from.items.findIndex((i) => i.id === itemId);
    if (idx < 0) return;
    const [item] = from.items.splice(idx, 1);
    from.updatedAt = Date.now();
    const to = this.getList(toStoreId);
    to.items.push(item);
    to.updatedAt = Date.now();
    this.state.lists[toStoreId] = to;
    if (!this.state.usage) this.state.usage = {};
    if (!this.state.usage[toStoreId]) this.state.usage[toStoreId] = {};
    this.state.usage[toStoreId][item.productId] =
      (this.state.usage[toStoreId][item.productId] ?? 0) + 1;
    this.persist();
  }

  /** Respeta la tienda exclusiva o deduce una por tipo. undefined → bandeja. */
  suggestStoreFor(productId: string): string | undefined {
    const p = this.state.products.find((x) => x.id === productId);
    if (!p) return undefined;
    return suggestStoreFor(p, this.state.categories, this.state.stores, this.state.defaultStores);
  }

  /** Ajusta la cantidad. Si delta hace que baje a <=0, no hace nada (usa
   *  removeItem para borrar). Permite decimales (0.5 kg, etc.). */
  setItemQty(storeId: string, itemId: string, qty: number): void {
    const list = this.state.lists[storeId];
    if (!list) return;
    const it = list.items.find((i) => i.id === itemId);
    if (!it) return;
    it.qty = Math.max(0.1, Math.round(qty * 10) / 10);
    list.updatedAt = Date.now();
    this.persist();
  }

  setItemUnit(storeId: string, itemId: string, unit: ListItem['unit']): void {
    const list = this.state.lists[storeId];
    if (!list) return;
    const it = list.items.find((i) => i.id === itemId);
    if (!it) return;
    it.unit = unit;
    list.updatedAt = Date.now();
    this.persist();
  }

  toggleItem(storeId: string, itemId: string): void {
    const list = this.state.lists[storeId];
    if (!list) return;
    const it = list.items.find((i) => i.id === itemId);
    if (!it) return;
    it.done = !it.done;
    it.doneAt = it.done ? Date.now() : undefined;
    list.updatedAt = Date.now();
    this.persist();
  }

  removeItem(storeId: string, itemId: string): void {
    const list = this.state.lists[storeId];
    if (!list) return;
    list.items = list.items.filter((i) => i.id !== itemId);
    list.updatedAt = Date.now();
    this.persist();
  }

  clearDone(storeId: string): void {
    const list = this.state.lists[storeId];
    if (!list) return;
    list.items = list.items.filter((i) => !i.done);
    list.updatedAt = Date.now();
    this.persist();
  }
}

export const app = new AppStore();
