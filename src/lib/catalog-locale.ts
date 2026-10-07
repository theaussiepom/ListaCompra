import type { AppState, Category, PendingField, Product, ShoppingList, Store } from './types';
import { getLocalizedSeed, LOCALIZED_PRODUCTS, LOCALIZED_STORES } from './data/locales';
import { DEFAULT_LOCALE, LOCALES, type Locale } from './i18n/locale';

export interface SyncSnapshot {
  catalogLocale?: Locale;
  lists: Record<string, ShoppingList>;
  customProducts: Product[];
  customStores: Store[];
  customCategories?: Category[];
  retainedProducts?: Product[];
  defaultStores?: AppState['defaultStores'];
  usage?: AppState['usage'];
  productIcons?: AppState['productIcons'];
  updatedAt: number;
}

type Evidence = Partial<AppState> & Partial<SyncSnapshot>;
const allProducts = new Map(LOCALES.flatMap((l) => LOCALIZED_PRODUCTS[l].map((p) => [p.id, p] as const)));
const allStores = new Map(LOCALES.flatMap((l) => LOCALIZED_STORES[l].map((s) => [s.id, s] as const)));

function validLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

export function catalogReferences(data: Evidence): { products: Set<string>; stores: Set<string> } {
  const products = new Set(Object.keys(data.productIcons ?? {}));
  const stores = new Set(Object.values(data.defaultStores ?? {}));
  for (const [id, list] of Object.entries(data.lists ?? {})) {
    stores.add(id);
    stores.add(list.storeId);
    for (const item of list.items) products.add(item.productId);
  }
  for (const [id, counts] of Object.entries(data.usage ?? {})) {
    stores.add(id);
    for (const productId of Object.keys(counts)) products.add(productId);
  }
  for (const s of [...(data.stores ?? []), ...(data.customStores ?? [])]) {
    if (s.edited || s.loyalty || s.enabled === false || (s.order !== undefined && s.order !== allStores.get(s.id)?.order) || !allStores.has(s.id)) stores.add(s.id);
  }
  for (const p of [...(data.products ?? []), ...(data.customProducts ?? []), ...(data.retainedProducts ?? [])]) {
    if (!allProducts.has(p.id) || products.has(p.id)) {
      if (p.storeId) stores.add(p.storeId);
    }
  }
  for (const id of products) {
    const p = allProducts.get(id);
    if (p?.storeId) stores.add(p.storeId);
  }
  return { products, stores };
}

/** El locale explícito solo cede ante referencias inequívocas de otro seed. */
export function inferCatalogLocale(data: Evidence, fallback?: Locale): Locale | undefined {
  if (validLocale(data.catalogLocale)) return data.catalogLocale;
  const refs = catalogReferences(data);
  let evidence = LOCALES.filter((l) =>
    LOCALIZED_PRODUCTS[l].some((p) => refs.products.has(p.id)) ||
    LOCALIZED_STORES[l].some((s) => refs.stores.has(s.id)),
  );
  if (!evidence.length && data.profile) {
    evidence = LOCALES.filter((l) =>
      LOCALIZED_STORES[l].some((s) => data.stores?.some((local) => local.id === s.id)),
    );
  }
  if (validLocale(data.locale) && (!evidence.length || evidence.includes(data.locale))) return data.locale;
  return evidence[0] ?? fallback;
}

function refreshStore(seed: Store, local?: Store): Store {
  if (local?.edited) return local;
  return {
    ...seed,
    ...(local?.order !== undefined ? { order: local.order } : {}),
    ...(local?.enabled !== undefined ? { enabled: local.enabled } : {}),
    ...(local?.loyalty ? { loyalty: local.loyalty } : {}),
  };
}

/** Conserva objetos referenciados de otros seeds; nunca remapea sus IDs. */
export function refreshCatalog(state: AppState, fallback?: Locale): AppState {
  const catalogLocale = inferCatalogLocale(state, fallback);
  if (!catalogLocale) return state;
  const seed = getLocalizedSeed(catalogLocale);
  const refs = catalogReferences(state);
  const localStores = new Map(state.stores.map((s) => [s.id, s]));
  const localProducts = new Map(state.products.map((p) => [p.id, p]));
  const stores = new Map(seed.stores.map((s) => [s.id, refreshStore(s, localStores.get(s.id))]));
  for (const s of state.stores) {
    const canonical = allStores.get(s.id);
    if (!canonical) stores.set(s.id, s);
    else if (!stores.has(s.id) && refs.stores.has(s.id)) stores.set(s.id, refreshStore(canonical, s));
  }
  for (const id of refs.stores) if (!stores.has(id) && allStores.has(id)) stores.set(id, refreshStore(allStores.get(id)!));
  const products = new Map(seed.products.map((p) => [p.id, p]));
  for (const p of state.products) if (!allProducts.has(p.id)) products.set(p.id, p);
  for (const id of refs.products) {
    if (!products.has(id)) {
      const p = allProducts.get(id) ?? localProducts.get(id);
      if (p) products.set(id, p);
    }
  }
  const categoryIds = new Set(seed.categories.map((c) => c.id));
  return {
    ...state, catalogLocale, storeTypes: seed.storeTypes, stores: [...stores.values()],
    categories: [...seed.categories, ...state.categories.filter((c) => !categoryIds.has(c.id))],
    products: [...products.values()].map((p) => state.productIcons?.[p.id] ? { ...p, icon: state.productIcons[p.id] } : p),
  };
}

export function buildSnapshot(state: AppState, updatedAt = Date.now()): SyncSnapshot {
  const seed = getLocalizedSeed(state.catalogLocale ?? DEFAULT_LOCALE);
  const currentProducts = new Set(seed.products.map((p) => p.id));
  const categoryIds = new Set(seed.categories.map((c) => c.id));
  const refs = catalogReferences(state);
  return {
    catalogLocale: state.catalogLocale,
    lists: state.lists,
    customProducts: state.products.filter((p) => !allProducts.has(p.id)),
    retainedProducts: state.products.filter((p) => allProducts.has(p.id) && !currentProducts.has(p.id) && refs.products.has(p.id)),
    customStores: state.stores.filter((s) => !allStores.has(s.id) || s.edited || s.loyalty || s.enabled === false || (s.order !== undefined && s.order !== allStores.get(s.id)?.order)),
    customCategories: state.categories.filter((c) => !categoryIds.has(c.id)),
    defaultStores: state.defaultStores, usage: state.usage, productIcons: state.productIcons,
    updatedAt,
  };
}

export function applySnapshot(state: AppState, incoming: SyncSnapshot, preserveLocal = false): AppState {
  const snap = { ...incoming };
  const local = buildSnapshot(state, incoming.updatedAt);
  for (const field of Object.keys(state.localSync?.fields ?? {}) as PendingField[]) {
    Object.assign(snap, { [field]: local[field] ?? (field.startsWith('custom') ? [] : {}) });
  }
  const lists = Object.fromEntries(Object.entries(state.lists).filter(
    ([, list]) => preserveLocal || list.updatedAt > snap.updatedAt,
  ));
  for (const [id, remote] of Object.entries(snap.lists ?? {})) {
    if (!lists[id] || remote.updatedAt > lists[id].updatedAt) lists[id] = remote;
  }
  for (const id of Object.keys(state.localSync?.lists ?? {})) {
    if (state.lists[id]) lists[id] = state.lists[id];
    else delete lists[id];
  }
  const legacy = snap.customCategories === undefined;
  const stores = new Map(state.stores.flatMap((s) => {
    const seed = allStores.get(s.id);
    return preserveLocal ? [[s.id, s] as const] : seed ? [[s.id, legacy ? s : seed] as const] : [];
  }));
  for (const s of snap.customStores ?? []) stores.set(s.id, s);
  const products = new Map(state.products.filter((p) => preserveLocal || allProducts.has(p.id)).map((p) => [p.id, p]));
  for (const p of [...(snap.retainedProducts ?? []), ...(snap.customProducts ?? [])]) products.set(p.id, p);
  const preservedCategories = new Map<string, Category>();
  const protectedData: Partial<SyncSnapshot> = { lists: {} };
  for (const [id, list] of Object.entries(lists)) {
    if (preserveLocal || list.updatedAt > snap.updatedAt || state.localSync?.lists[id] !== undefined) protectedData.lists![id] = list;
  }
  for (const field of Object.keys(state.localSync?.fields ?? {}) as PendingField[]) {
    Object.assign(protectedData, { [field]: local[field] });
  }
  const protectedRefs = catalogReferences(protectedData);
  for (const p of protectedData.customProducts ?? []) protectedRefs.products.add(p.id);
  // Conserva dependencias de cambios pendientes sin resucitar objetos borrados localmente.
  for (const id of protectedRefs.products) {
    const product = products.get(id) ?? state.products.find((p) => p.id === id);
    if (!product) continue;
    products.set(id, product);
    const category = state.categories.find((c) => c.id === product.categoryId);
    if (category) preservedCategories.set(category.id, category);
    if (product.storeId) protectedRefs.stores.add(product.storeId);
  }
  for (const id of protectedRefs.stores) {
    const store = state.stores.find((s) => s.id === id);
    if (store && !stores.has(id)) stores.set(id, store);
  }
  if (legacy) {
    for (const list of Object.values(lists)) {
      for (const item of list.items) {
        const product = products.get(item.productId);
        const exclusive = state.stores.find((s) => s.id === product?.storeId);
        if (exclusive && !stores.has(exclusive.id)) stores.set(exclusive.id, exclusive);
      }
    }
  }
  const catalogLocale = snap.catalogLocale ?? inferCatalogLocale(snap, state.catalogLocale);
  const categories = new Map((preserveLocal ? state.categories : getLocalizedSeed(catalogLocale ?? DEFAULT_LOCALE).categories).map((c) => [c.id, c]));
  for (const c of snap.customCategories ?? state.categories) categories.set(c.id, c);
  for (const [id, category] of preservedCategories) if (!categories.has(id)) categories.set(id, category);
  const merged = {
    ...state, lists, catalogLocale,
    products: [...products.values()], stores: [...stores.values()], categories: [...categories.values()],
    defaultStores: snap.defaultStores ?? state.defaultStores,
    usage: snap.usage ?? state.usage,
    productIcons: snap.productIcons ?? state.productIcons,
  };
  return refreshCatalog(merged);
}
