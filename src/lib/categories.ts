import type { Category } from './types';
import { CATEGORIES_SEED } from './data/categories';

function fallbackCategoryId(typeId: string): string {
  const seed = CATEGORIES_SEED.find((c) => c.typeId === typeId && c.id.endsWith('-otros'));
  return seed?.id ?? `${typeId}-otros`;
}

export function isFallbackCategory(category: Pick<Category, 'id' | 'typeId'>): boolean {
  return category.id === fallbackCategoryId(category.typeId);
}

export function ensureFallbackCategory(categories: Category[], typeId: string): Category {
  const id = fallbackCategoryId(typeId);
  const existing = categories.find((c) => c.id === id && c.typeId === typeId);
  if (existing) return existing;

  // Compatibilidad con categorías de tipos personalizados anteriores al ID estable.
  if (!CATEGORIES_SEED.some((c) => c.id === id && c.typeId === typeId)) {
    const custom = categories.find((c) => c.typeId === typeId && c.name.toLowerCase() === 'otros');
    if (custom) return custom;
  }
  const category: Category = {
    id,
    name: categories.find((c) => c.id === 'otr-otros')?.name ?? 'Otros',
    typeId,
    icon: { kind: 'emoji', value: '🏷️' },
    order: 999,
  };
  categories.push(category);
  return category;
}
