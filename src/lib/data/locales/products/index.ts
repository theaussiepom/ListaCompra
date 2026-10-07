import type { Product } from '../../../types';
import type { Locale } from '../../../i18n/locale';
import { PRODUCTS_SEED } from '../../products';
import { UK } from './uk';
import { US } from './us';
import { FR } from './fr';
import { DE } from './de';
import { BR } from './br';
import { PRODUCTS_AU } from './au';

// Catálogos de productos por cultura, un archivo por país (igual que el seed
// español está troceado por áreas). Referencian las categorías universales
// (sup-fruteria, sup-carniceria, …); los IDs van prefijados por locale.
export const LOCALIZED_PRODUCTS: Record<Locale, Product[]> = {
  es: PRODUCTS_SEED,
  en: UK,
  us: US,
  fr: FR,
  de: DE,
  br: BR,
  au: PRODUCTS_AU,
};
