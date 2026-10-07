// Exporta el catálogo del seed (frontend TS) a un JSON que consume el backend
// Python de la integración de HA. Así el servicio `tucompra.add_item` puede
// reconocer un producto por nombre y deducir su tienda sin duplicar el catálogo.
//
// Se exportan LOS SEIS idiomas, no solo el español: el backend elige uno en
// tiempo de ejecución según el idioma de HA, así que tiene que llevarlos todos
// dentro. Antes solo viajaba el español y por eso la voz solo entendía "papel
// higiénico" aunque la app estuviese en inglés.
//
// Las categorías son universales (los IDs no cambian de idioma) y el backend
// solo necesita el mapa id → typeId: van una vez y sin nombres. `storeTypes` ya
// no se exporta porque el backend nunca lo leía.
//
// Se ejecuta con tsx (ver script `export:catalog` en package.json), tanto en
// `build:ha` local como en el workflow de release. El resultado
// (custom_components/tucompra/catalog.json) NO se commitea: se genera en cada
// build y viaja dentro del zip del release.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CATEGORIES_SEED } from '../src/lib/data/categories.ts';
import { LOCALIZED_PRODUCTS, LOCALIZED_STORES } from '../src/lib/data/locales/index.ts';
import { LOCALES } from '../src/lib/i18n/locale.ts';
import { exportProduct } from './catalog-product.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../custom_components/tucompra/catalog.json');

const catalog = {
  // Mapa id → typeId, común a todos los idiomas.
  categories: CATEGORIES_SEED.map((c) => ({ id: c.id, typeId: c.typeId })),
  // Un bloque por idioma. Solo lo necesario para enrutar: ni iconos ni fotos.
  locales: Object.fromEntries(
    LOCALES.map((loc) => [
      loc,
      {
        products: LOCALIZED_PRODUCTS[loc].map(exportProduct),
        stores: LOCALIZED_STORES[loc].map((s) => ({
          id: s.id,
          name: s.name,
          typeId: s.typeId,
        })),
      },
    ]),
  ),
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(catalog));

const totals = LOCALES.map((l) => `${l}:${catalog.locales[l].products.length}`).join(' ');
console.log(`[export-catalog] ${totals} → ${OUT}`);
