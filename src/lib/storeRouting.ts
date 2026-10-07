import type { Category, Product, Store } from './types';

type RoutingStore = Pick<Store, 'id' | 'typeId' | 'enabled'>;

export function getDefaultStore(
  typeId: string,
  stores: RoutingStore[],
  defaults: Record<string, string> = {},
): string | undefined {
  const ofType = stores.filter((s) => s.typeId === typeId && s.enabled !== false);
  const explicit = defaults[typeId];
  if (explicit && ofType.some((s) => s.id === explicit)) return explicit;
  return ofType.length === 1 ? ofType[0].id : undefined;
}

export function suggestStoreFor(
  product: Pick<Product, 'categoryId' | 'storeId'>,
  categories: Pick<Category, 'id' | 'typeId'>[],
  stores: RoutingStore[],
  defaults: Record<string, string> = {},
): string | undefined {
  const typeId = categories.find((c) => c.id === product.categoryId)?.typeId;
  if (!typeId) return undefined;
  if (product.storeId) {
    // Una tienda exclusiva no disponible no permite sustituir el destino.
    return stores.find((s) => s.id === product.storeId && s.typeId === typeId && s.enabled !== false)?.id;
  }
  return getDefaultStore(typeId, stores, defaults);
}
