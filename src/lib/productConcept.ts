export type ProductIdentity = { id?: string; mirrorOf?: string };

/** Solo colapsa destinos directos y únicos presentes en este catálogo. */
export function getProductConceptResolver<T extends ProductIdentity>(products: T[]): (product: T) => T | null {
  const byId = new Map<string, T>();
  const duplicates = new Set<string>();
  for (const product of products) {
    if (typeof product.id !== 'string' || !product.id) continue;
    if (byId.has(product.id)) duplicates.add(product.id);
    else byId.set(product.id, product);
  }
  return (product) => {
    if (product.id && duplicates.has(product.id)) return null;
    if (product.mirrorOf === undefined) return product;
    if (typeof product.mirrorOf !== 'string' || !product.mirrorOf || product.mirrorOf === product.id) return null;
    const target = byId.get(product.mirrorOf);
    if (!target || duplicates.has(product.mirrorOf) || target.mirrorOf !== undefined) return null;
    return target;
  };
}

/** Se ejecuta por locale antes de exportar, sin seguir cadenas ni ciclos. */
export function validateProducts<T extends ProductIdentity>(products: T[]): void {
  const ids = new Set<string>();
  for (const product of products) {
    if (typeof product.id !== 'string' || !product.id.trim()) throw new Error('Product ID must be a nonempty string');
    if (ids.has(product.id)) throw new Error(`Duplicate product ID: ${product.id}`);
    ids.add(product.id);
  }
  const concept = getProductConceptResolver(products);
  for (const product of products) {
    if (!concept(product)) throw new Error(`Invalid mirrorOf for product: ${product.id}`);
  }
}
