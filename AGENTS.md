# Tu Compra (Lista de la Compra)

Integración HACS de listas de la compra multi-tienda, 100% local en Home Assistant.
Carpeta local: `C:\Users\maest\TuCompra`. Repo: `maestrea76/ListaCompra`.
Demo estática: https://maestrea76.github.io/ListaCompra/

`CLAUDE.md` está desfasado (PIN Boardinggate / LocalStorage como fuente de verdad).
Este archivo manda.

## Stack (no cambiar sin pedirlo)

- Frontend: Astro 5 + Svelte 5 **con runes** (`$state`, `$derived`, `$effect`, `$props`).
- Estilo: Tailwind CSS v4 (theme inline en `src/styles/global.css`). Sin DaisyUI/Shadcn.
- Integración HA: `custom_components/tucompra/` (Python). Panel lateral que sirve la SPA.
- Identidad = usuario de HA ya logueado. Datos en `.storage/tucompra`. **Sin Supabase, sin PIN.**
- TypeScript estricto. Iconos: Lucide + emojis; productos pueden llevar foto (dataURL).

## Modelo

`TipoTienda` → `Categoría` → `Producto`. Cada `Tienda` apunta a un `TipoTienda`.
Tipos en `src/lib/types.ts`. Catálogo seedeado en `src/lib/data/`.
Estado global: `src/lib/stores/app.svelte.ts`. Tras mutar, `app.persist()`.

Navegación por **hash** (`#/lista/<id>`): aiohttp en HA da 403 en subdirectorios. No MPA.

## Build y release

- Dev: `npm run dev`
- Panel HA: `npm run build:ha` (exporta catálogo + build a `custom_components/tucompra/panel/app/`)
- Tests: `pytest tests/` (tras `npm run export:catalog`)
- Release del fork: seguir `docs/fork-release.md`; ejecutar primero `scripts/release_preflight.py` sobre el SHA exacto.
- Publicar exige autorización separada, desactivar el workflow histórico `release.yml` en GitHub y aprobar SHA/versión. Solo `fork-release.yml` puede publicar el artefacto validado. No crear tags durante la preparación.
- El build del panel y `catalog.json` están en `.gitignore`; viajan en el zip del release.

No commitear `node_modules/`, `.claude/`, `custom_components/tucompra/panel/app/`, `catalog.json`.

## HACS / HA

- Dominio: `tucompra`. Instalado en HA como **Tu Compra** (HACS, custom repo).
- `hacs.json`: `zip_release`, `filename: tucompra.zip`.
- PR a lista por defecto: https://github.com/hacs/default/pull/9197 (en cola; no abrir otro).
- Config YAML: `tucompra:` (opcional `product_lookup: true` → Open Food Facts, única petición saliente).
- Pendiente (no hacer solo): `config_flow` y entidades `todo.*` para Assist.

## Estilo de código

- Mobile-first, tarjetas grandes.
- Comentarios cortos y factuales, en español, solo para invariantes no obvios (hash routing, zip_release, shares).
- Commits en español, rama `main`.
