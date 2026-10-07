import type { Product, Unit } from '../../../types';

/** Helper compartido por los catálogos de cada país. Los IDs se prefijan con el
 *  locale para no colisionar entre culturas ni con el seed español. */
export const mk = (prefix: string) =>
  (id: string, name: string, cat: string, emoji: string, unit: Unit = 'unidad', aliases?: string[], mirrorOf?: Product['id']): Product => ({
    id: `${prefix}-${id}`, name, categoryId: cat,
    icon: { kind: 'emoji', value: emoji }, defaultUnit: unit,
    ...(aliases ? { aliases } : {}),
    ...(mirrorOf !== undefined ? { mirrorOf } : {}),
  });
