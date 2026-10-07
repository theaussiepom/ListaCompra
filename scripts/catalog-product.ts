import type { Product } from '../src/lib/types';
import { validateProducts } from '../src/lib/productConcept';

export function exportProduct(product: Product) {
  return {
    id: product.id,
    name: product.name,
    categoryId: product.categoryId,
    defaultUnit: product.defaultUnit,
    ...(product.storeId ? { storeId: product.storeId } : {}),
    ...(product.aliases ? { aliases: product.aliases } : {}),
    ...(product.mirrorOf !== undefined ? { mirrorOf: product.mirrorOf } : {}),
  };
}

export function exportProducts(products: Product[]) {
  validateProducts(products);
  return products.map(exportProduct);
}

export function exportSeedProducts(products: Product[]) {
  // Los seeds antiguos tienen IDs repetidos; introducir mirrors exige IDs únicos.
  return products.some((product) => product.mirrorOf !== undefined)
    ? exportProducts(products) : products.map(exportProduct);
}
