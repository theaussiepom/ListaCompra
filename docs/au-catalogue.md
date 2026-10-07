# Catálogo australiano

`au` es un catálogo independiente con interfaz inglesa, etiqueta **Australia** y bandera **AU**. Un share nuevo o vacío lo selecciona con idioma HA `en` y país `AU`, o con navegador `en-AU`. Los shares poblados conservan la identidad inferida de sus referencias; los fijados conservan `catalogLocale`. Un catálogo británico existente sigue siendo `en`, también tras recargar. No hay conversión ni mapa de IDs UK→AU.

El contrato revisado `tucompra-au-implementation-config-v2.json` (schema 2) tiene SHA-256 `9da13ed8e578c712bffd0cf99ec652a4bd05f404f4480e13083ebed42b146194` y parte de la base genérica `d2f4fad02d425579484f636ae5a9b83f186c70e1`. Sus datos nativos se conservan en orden: 1.285 productos canónicos y 233 espejos, 1.518 en total. Hay 450 alias en 254 productos canónicos; los 213 alias diferidos no se usan.

Las nueve tiendas iniciales son **Woolworths, Coles, ALDI, IGA, Butcher, Bakery, Seafood shop, Chemist Warehouse y Bunnings**. Los 48 candidatos opcionales investigados, incluidos Kmart e IKEA, no forman parte del seed, tampoco como tiendas desactivadas. Los productos de tipos sin tienda activa siguen siendo reconocibles y se envían a Inbox.

Los alias cubren sinónimos australianos, británicos y estadounidenses según el contrato. Los espejos representan una ubicación del mismo concepto en un catálogo especializado y conservan su categoría, icono y unidad propios. Se pueden seleccionar explícitamente en esa tienda. El matching automático global resuelve el producto canónico y no presupone una preferencia por la tienda especializada. Si un filtro deja solo el espejo sin su canónico, Enter conserva el texto literal de forma segura.

`defaultStores` empieza como `{}`. Los cuatro supermercados hacen ambigua la ruta de supermercado hasta configurar una preferencia explícita; el destino es Inbox. La existencia de un espejo en Butcher no cambia esa regla. Open Food Facts usa nombres ingleses y la misma caché neutral compartida entre locales.

## Validación reproducible

`tests/fixtures/au-acceptance.json` conserva las expectativas del contrato y hashes de los datos completos. Las pruebas AU comparan productos, orden, alias, espejos, tiendas y las 14 etiquetas de tipos y 75 de categorías; ejecutan los 581 casos de matching en TypeScript y Python, 286 ejecuciones de routing de 145 casos y 43 casos de locale en sus capas correspondientes. Las pruebas de selección usan los handlers reales de ListView y distinguen selección explícita de matching automático.

```sh
npm install
npm run check
npm run export:catalog
node --import tsx --test tests/*.test.mjs
pytest tests/ -q
npm run build:ha
```

Los bloques exportados de `es`, `en`, `us`, `fr`, `de` y `br` deben permanecer idénticos byte a byte respecto a la base. El seed español conserva sus ocho IDs duplicados históricos bajo la ruta de exportación compatible para catálogos sin espejos; esta incorporación no los migra.

La aceptación en Home Assistant real sigue pendiente: renderizado Companion, cámara iPhone, rutas nativa/WASM del lector, cambio de cámara, linterna donde exista y uso compartido con varios usuarios. Las pruebas locales no certifican esos dispositivos ni despliegan la integración.
