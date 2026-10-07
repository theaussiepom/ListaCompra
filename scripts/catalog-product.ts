import type { Product } from '../src/lib/types';

export function exportProduct(product: Product) {
  return {
    id: product.id,
    name: product.name,
    categoryId: product.categoryId,
    defaultUnit: product.defaultUnit,
    ...(product.storeId ? { storeId: product.storeId } : {}),
    ...(product.aliases ? { aliases: product.aliases } : {}),
  };
}
