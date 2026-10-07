# 🛒 Tu Compra — Supermarket & Grocery Shopping Lists for Home Assistant

**Tu Compra** ("My Shopping") is a **multi-store supermarket / grocery shopping
list** that runs **100% locally inside Home Assistant**. No cloud, no accounts,
no subscriptions: your lists live in your own HA instance, and your identity is
simply the Home Assistant user you are already logged in as.

It adds a **Tu Compra** panel to your Home Assistant sidebar, with a visual,
mobile-first interface designed for actually using it while walking around a
supermarket.

🔗 Live demo (browser only, no HA): https://maestrea76.github.io/ListaCompra/

---

## Screenshots

<!-- Absolute raw.githubusercontent URLs on purpose: HACS renders this README in
     its own frontend, outside the repository, where relative paths do not resolve. -->

<p align="center">
  <img src="https://raw.githubusercontent.com/maestrea76/ListaCompra/main/docs/images/sidebar.png" width="820" alt="Tu Compra running as a Home Assistant panel, with the store grid">
</p>

<p align="center"><em>It lives in your Home Assistant sidebar — no separate app, no login.</em></p>

<table>
  <tr>
    <td width="25%" align="center">
      <img src="https://raw.githubusercontent.com/maestrea76/ListaCompra/main/docs/images/stores.png" width="100%" alt="Store grid with pending counters">
    </td>
    <td width="25%" align="center">
      <img src="https://raw.githubusercontent.com/maestrea76/ListaCompra/main/docs/images/list.png" width="100%" alt="A store list grouped by section, with quantities and units">
    </td>
    <td width="25%" align="center">
      <img src="https://raw.githubusercontent.com/maestrea76/ListaCompra/main/docs/images/scan.png" width="100%" alt="Barcode scanner recognising a product">
    </td>
    <td width="25%" align="center">
      <img src="https://raw.githubusercontent.com/maestrea76/ListaCompra/main/docs/images/loyalty.png" width="100%" alt="Per-store settings, including its loyalty card">
    </td>
  </tr>
  <tr>
    <td align="center"><b>One list per store</b><br>Sorted by what's still pending</td>
    <td align="center"><b>Grouped by section</b><br>With quantities and units</td>
    <td align="center"><b>Scan a barcode</b><br>Straight onto the list</td>
    <td align="center"><b>Loyalty cards</b><br>Stored per store, offline</td>
  </tr>
</table>

---

## Why this instead of a plain to-do list?

A single flat shopping list breaks down the moment your shopping is spread
across several shops. Tu Compra is built around the way people really shop:

- **One list per store.** Milk goes on the supermarket list, screws go on the
  hardware store list, and each list only shows what belongs there.
- **A real product catalog.** Hundreds of pre-loaded products per country,
  organised by store type and section — you tap instead of typing.
- **Quantities and units.** Each item carries an amount and a unit
  (unit / kg / g / l / ml / pack / dozen / box), editable inline.
- **Learns your habits.** The products you add most often in a given store are
  surfaced first as "your usuals", so a weekly shop is a handful of taps.

## Key features

- 🌍 **Culture-aware catalog.** New or empty catalogues use your Home Assistant
  language and country; populated catalogues keep their existing identity:
  - 🇪🇸 **Spain** — Eroski, Mercadona, Lidl, Día, Carrefour, Alcampo, BM…
  - 🇬🇧 **United Kingdom** — Tesco, Sainsbury's, Asda, Morrisons, Waitrose, Boots…
  - 🇺🇸 **United States** — Walmart, Costco, Target, Kroger, Safeway, Trader Joe's…
  - 🇫🇷 **France** — Carrefour, Leclerc, Auchan, Intermarché, Monoprix…
  - 🇩🇪 **Germany** — Aldi, Lidl, Rewe, Edeka, Kaufland, dm…
  - 🇧🇷 **Brazil** — Pão de Açúcar, Assaí, Atacadão, Extra, Renner…
  - 🇦🇺 **Australia** — Woolworths, Coles, ALDI, IGA, Butcher, Bakery, Seafood
    shop, Chemist Warehouse and Bunnings.
  
  Each locale ships genuinely local products (Marmite and Hobnobs for the UK,
  ranch and tater tots for the US, Comté and rillettes for France, Quark and
  Brezel for Germany, farofa and guaraná for Brazil), plus translated section
  names. A **flag** next to the theme switch shows the detected locale.
  Australian English (`en` + `AU`, or browser `en-AU`) selects the AU catalogue
  for new/empty shares. Existing UK-backed or explicitly pinned shares retain
  their IDs and catalogue across reloads. AU includes 1,518 products with curated
  synonyms and specialist mirrors: store browsing keeps the specialist row,
  while automatic matching uses its canonical product. The 48 researched
  optional stores, including Kmart and IKEA, are not seeded. Factory default
  stores are empty, so an ambiguous supermarket destination goes to Inbox.
  See [Australian catalogue](docs/au-catalogue.md).
- 🏪 **Visual store editor.** Add, edit, reorder, hide or delete stores from the
  UI. Upload your own photo for a store, or use the built-in colour badges.
- 🔍 **Fuzzy search.** Accent-insensitive and typo-tolerant: "platano" finds
  "Plátano", "detrgente" finds "Detergente". If a product doesn't exist, press
  **Enter** to create it on the fly.
- 📷 **Scan product barcodes.** Scan an item (or the empty carton in your
  kitchen) and it goes straight on the list. Optionally the name is filled in
  for you (see [product lookup](#optional-product-lookup-by-barcode)). Own-brand
  products can be marked **"only in this store"**, so Hacendado doesn't show up
  in your Tesco list.
- 🎟️ **Loyalty cards.** Store each shop's card (QR or barcode) and show it
  full-screen at the till. Scan it with the camera or type the number — the
  format is detected automatically.
- 🗣️ **Voice input via Assist.** Say what you need and it lands in the right
  store's list automatically (see [Voice](#voice-input-with-assist)).
- 👥 **Personal and shared lists.** Keep your own list, or share a household
  list between several Home Assistant users.
- 🔒 **Fully local.** Data is stored in your Home Assistant (`.storage`), never
  sent anywhere else. Works offline and re-syncs when HA is reachable again.
- 🌙 **Light / dark theme**, mobile-first, large tap targets.

---

## Installation (HACS)

1. In **HACS** → ⋮ menu → **Custom repositories**, add
   `https://github.com/maestrea76/ListaCompra` with category **Integration**.
2. Install **Tu Compra** and **restart** Home Assistant.
3. Add this line to your `configuration.yaml`:

   ```yaml
   tucompra:
   ```

4. Restart Home Assistant again.
5. **Tu Compra** now appears in your sidebar.

That's the whole setup — there is nothing else to configure. No account, no API
key, no passphrase.

### Optional: product lookup by barcode

Scanning barcodes **works out of the box** — you scan, and you type the product
name yourself. What is **optional** is having that name **filled in
automatically**, because that is the only thing in the whole app that needs an
internet request.

By default Tu Compra makes **zero outbound requests**. To enable the lookup, add
`product_lookup` under `tucompra:` in your `configuration.yaml`:

```yaml
tucompra:
  product_lookup: true
```

Then restart Home Assistant.

When enabled, scanning a barcode asks **Open Food Facts** (a free, open,
collaborative food database — no API key, no account) for the product name. The
request is made **by Home Assistant, not by your browser**, and every result is
**cached** locally, so each product is looked up only once. **Only the barcode is
sent** — nothing that identifies you.

You always confirm the name and the section before anything is added, and you can
tick **"Only in this store"** for own-brand products (Hacendado, Eroski Basic,
Tesco Everyday Value…) so they don't show up in your other supermarkets.

Coverage is mostly **food** and strongest in Europe; if a product isn't found,
just type the name.

> **Note:** barcode scanning uses the browser's native `BarcodeDetector`, which
> exists in **Chrome/Edge** (Android and desktop) but **not in Safari/iOS or
> Firefox**. On those, type the number instead.

> **Requirements:** Home Assistant **2024.7+**. For the integration icon to be
> displayed, Home Assistant **2026.3+** is required (local brand images).

---

## How it works

The panel is served by your own Home Assistant instance and authenticates as the
HA user who is currently logged in:

- Your **identity** is your Home Assistant user, mapped to the matching
  `person.` entity (for your display name and picture). There is **no login and
  no passphrase** inside the app — if you can open Home Assistant, you are in.
- Your lists are stored **inside Home Assistant** (`.storage/tucompra`) and are
  included in your regular Home Assistant backups.
- Every device keeps a **local copy** and syncs against Home Assistant (periodic
  pull, push on edit), reconciling by timestamp. You can keep ticking items off
  **offline** in the shop; it syncs as soon as HA is reachable again.
- Nothing is sent to any external service. There are no third-party
  dependencies, no telemetry and no cloud account.

### Personal and shared lists

- Every user automatically gets a **personal list**.
- A Home Assistant **administrator** can create **shared lists** (e.g. "Home"),
  give them a name and pick members from the household's `person.` entities.
  Sharing gives members access to the whole list account: stores, custom
  products and items.
- If you are a member of a shared list, it becomes your **default** list — the
  household list is what you normally want when you open the app.
- Switch between your lists from the sync panel (the status chip under your
  name).

---

## Voice input with Assist

The integration exposes a **`tucompra.add_item`** service that adds a product
**by name** and **routes it to the correct store automatically**:

1. It recognises the product with fuzzy search across the catalog **of your Home
   Assistant language** — say "nappies", "diapers", "couches" or "pañales"
   depending on where you are, not the Spanish name.
2. From the product it derives the **store type** (milk → supermarket, chops →
   butcher, ibuprofen → pharmacy…).
3. It puts the item in your **default store** for that type.
4. If it cannot decide (unknown product, or several stores of that type with no
   default), the item goes to the **"📥 To sort"** tray, where one tap (the ↪
   button) sends it to the right store.

You never have to say the store out loud — the product itself implies it.

### Default stores

If you have several shops of the same type (three supermarkets, say), open the
**🎯 button** in the header and choose which one is the default for each type.
Types with a single store are resolved automatically.

### Testing the service

Home Assistant → **Developer tools → Actions**:

```yaml
action: tucompra.add_item
data:
  name: milk
  quantity: 2
```

### Wiring it to Assist

Add an intent to `configuration.yaml`:

```yaml
intent_script:
  AddShoppingItem:
    action:
      - action: tucompra.add_item
        data:
          name: "{{ item }}"
        response_variable: result
    speech:
      # `action_response` (not `result`) is the variable the speech template
      # sees — that is how Home Assistant exposes what the action returned.
      #
      # Say back the product that ACTUALLY matched, not what you dictated. Ask
      # for "bread" and the catalog may hold "Wholemeal bread": echoing your own
      # words would hide the mismatch until you are at the shop.
      text: >-
        {% if action_response.ambiguous %}
          Added {{ action_response.product_name }}. I also found {{ action_response.alternatives | join(', ') }}.
        {% else %}
          Added {{ action_response.product_name }} to the list.
        {% endif %}
```

`tucompra.add_item` returns:

| Field | Meaning |
|---|---|
| `product_name` | The product that **actually matched**. May differ from what you said |
| `alternatives` | Other products that also matched, best first |
| `ambiguous` | `true` when there was more than one candidate |
| `classified` | `false` when it went to the **📥 To sort** tray |

Home Assistant's custom intents cannot hold a back-and-forth conversation (they
answer once and finish), so Tu Compra cannot ask *"did you mean X or Y?"* and act
on your reply. Saying the matched name out loud is the closest thing: you hear
the mistake immediately instead of finding it at the till.

And create `custom_sentences/en/tucompra.yaml` in your config folder:

```yaml
language: "en"
intents:
  AddShoppingItem:
    data:
      - sentences:
          - "(add|put) {item} to the (list|shopping list)"
          - "(add|put) {item} on the (list|shopping list)"
lists:
  item:
    wildcard: true
```

Restart Home Assistant, then say or type in Assist:

> *"add milk to the shopping list"*

Use the name as it is called **where you live**: the catalog follows your Home
Assistant language, so a UK instance knows "toilet roll" and a US one "toilet
paper".

> ⚠️ **Custom sentences are only understood by the "Home Assistant" conversation
> agent.** If you use an LLM agent (Gemini, ChatGPT…), either switch the agent to
> "Home Assistant" in the Assist dialog, or enable **"Prefer handling commands
> locally"** in that assistant's settings.

---

## The catalog

Products are organised as **Store type → Section → Product**, and every section
ends with an "Other" entry for flexibility.

The **Spanish catalog is the deepest** (~1,300 products), covering supermarket
sections in detail (produce, butcher, fishmonger, dairy, deli, pantry, frozen,
drinks — including ~55 wines by origin — snacks, breakfast, hygiene, baby, pets,
cleaning, bakery) plus specialised shops: butcher, fishmonger, bakery, pharmacy,
perfumery, hardware, clothing, home, shopping centre, delicatessen, herbalist.
It has a strong Basque Country / Spanish flavour (txuleta, kokotxas, txakoli,
idiazabal, perretxikos, jamón ibérico, turrón de Jijona…).

The **UK, US, French, German and Brazilian catalogs** ship 245–390 curated
products each, covering the full weekly shop across every supermarket section.
They keep growing — and in any case the fuzzy search plus "press Enter to
create" means nothing is ever blocked by a missing product.

---

## Roadmap

- [x] Extensive catalog with typical products
- [x] Visual store editor (create / edit / delete)
- [x] Custom photo upload for stores
- [x] Local Home Assistant integration (HACS): API + panel + shared lists
- [x] Culture-aware catalog by HA language (🇪🇸🇬🇧🇺🇸🇫🇷🇩🇪🇧🇷) + SVG flag
- [x] Voice via Assist: `tucompra.add_item` service with automatic store routing
- [x] "To sort" tray with one-tap triage to the right store
- [x] Integration icon bundled (shown on install)
- [x] Button to open the HA sidebar from the panel
- [x] Loyalty cards per store (scan, show full-screen at the till)
- [x] Add products by scanning their barcode (optional Open Food Facts lookup)
- [x] Own-brand products restricted to a single store
- [ ] Config flow (set up from the HA UI, no `configuration.yaml`)
- [ ] `todo.*` entities (native HA To-do card)
- [ ] Visual editor for catalog products
- [ ] Custom photo per product
- [ ] PWA with service worker + true offline
- [ ] "Shopping route" mode (order items by aisle)

---

# 🇪🇸 Español

**Tu Compra** es una aplicación de **listas de la compra multi-tienda** que
funciona **100% en local dentro de Home Assistant**. Sin nube, sin cuentas y sin
suscripciones: los datos viven en tu propio HA y tu identidad es simplemente el
usuario de Home Assistant con el que ya has entrado.

Los catálogos nuevos se **adaptan a la cultura** según el idioma y país de HA
(🇪🇸🇬🇧🇺🇸🇫🇷🇩🇪🇧🇷🇦🇺); los existentes conservan su identidad.
El seed español incluye ~1.300 productos, con fuerte sabor de
**Euskadi / País Vasco** (txuleta, kokotxas, txakoli, idiazabal, perretxikos…) y
del resto de España (jamón ibérico, fabes, turrón de Jijona…).

## Capturas

<table>
  <tr>
    <td width="25%" align="center">
      <img src="https://raw.githubusercontent.com/maestrea76/ListaCompra/main/docs/images/stores.png" width="100%" alt="Rejilla de tiendas con contador de pendientes">
    </td>
    <td width="25%" align="center">
      <img src="https://raw.githubusercontent.com/maestrea76/ListaCompra/main/docs/images/list.png" width="100%" alt="Lista de una tienda agrupada por secciones, con cantidades y unidades">
    </td>
    <td width="25%" align="center">
      <img src="https://raw.githubusercontent.com/maestrea76/ListaCompra/main/docs/images/scan.png" width="100%" alt="El escáner reconociendo un producto por su código de barras">
    </td>
    <td width="25%" align="center">
      <img src="https://raw.githubusercontent.com/maestrea76/ListaCompra/main/docs/images/loyalty.png" width="100%" alt="Ajustes de una tienda, con su tarjeta de fidelización">
    </td>
  </tr>
  <tr>
    <td align="center"><b>Una lista por tienda</b><br>Ordenadas por lo que falta</td>
    <td align="center"><b>Agrupada por secciones</b><br>Con cantidades y unidades</td>
    <td align="center"><b>Escanea el código</b><br>Directo a la lista</td>
    <td align="center"><b>Tarjetas de fidelización</b><br>Por tienda y sin nube</td>
  </tr>
</table>

## Características principales

- 🌍 **Multi-cultura**: tiendas y productos según el idioma/país de HA
  (Eroski/Mercadona, Tesco, Walmart, Carrefour, Aldi, Pão de Açúcar, Woolworths…), con
  secciones traducidas y una **bandera** junto al selector de tema.
- 🏪 **Editor visual de tiendas**: crear, editar, ocultar, borrar y foto propia.
- 🔍 **Búsqueda difusa**: sin acentos y tolerante a erratas. Si no existe,
  **Enter** crea el producto.
- 📷 **Escanear códigos de barras**: escanea un producto (o el envase vacío de la
  cocina) y va directo a la lista. Opcionalmente el nombre se rellena solo (ver
  [búsqueda por código](#opcional-buscar-productos-por-código-de-barras)). Las
  marcas propias se pueden marcar **"solo en esta tienda"**, para que un
  Hacendado no aparezca en tu lista de Eroski.
- 🎟️ **Tarjetas de fidelización**: guarda la tarjeta de cada tienda (QR o código
  de barras) y muéstrala a pantalla completa en caja. Escanéala con la cámara o
  escribe el número — el formato se detecta solo.
- 🗣️ **Voz con Assist**: `tucompra.add_item` reconoce el producto, deduce su tipo
  de tienda y lo coloca en la **tienda por defecto** (botón 🎯). Si duda, va a la
  bandeja **"📥 Por clasificar"** y lo recolocas con el botón ↪.
- 👥 **Listas personales y compartidas** entre usuarios de HA (las compartidas
  las crea un **administrador**; si perteneces a una, es tu lista por defecto).
- 🔒 **Todo local**: los datos viven en `.storage` de tu HA y entran en tus
  backups. Funciona offline y sincroniza al recuperar HA.
- 🌙 **Tema claro/oscuro**, mobile-first.

## Instalación (HACS)

1. HACS → ⋮ → **Repositorios personalizados**: añade
   `https://github.com/maestrea76/ListaCompra` como **Integración**.
2. Instala **Tu Compra** y **reinicia** Home Assistant.
3. Añade a `configuration.yaml`:

   ```yaml
   tucompra:
   ```

4. Reinicia otra vez. Aparecerá **Tu Compra** en la barra lateral.

No hay nada más que configurar: ni cuenta, ni API key, ni passphrase.

### Opcional: buscar productos por código de barras

Escanear códigos **funciona de serie** — escaneas y escribes tú el nombre. Lo
**opcional** es que ese nombre **se rellene solo**, porque es lo único de toda la
app que necesita una petición a internet.

Por defecto la app **no hace ninguna petición externa**. Para activar la
búsqueda, añade `product_lookup` bajo `tucompra:` en tu `configuration.yaml`:

```yaml
tucompra:
  product_lookup: true
```

Y reinicia Home Assistant.

Con esto, al escanear se consulta **Open Food Facts** (base abierta y gratuita,
sin API key ni cuenta). La petición la hace **Home Assistant, no tu navegador**, y
el resultado se **cachea** en local: cada producto se consulta una sola vez. **Solo
se envía el código de barras**, nada que te identifique.

Siempre confirmas el nombre y la sección antes de añadir nada, y puedes marcar
**"Solo en esta tienda"** para marcas propias (Hacendado, Eroski Basic…) y que no
aparezcan en tus otros supermercados.

La cobertura es sobre todo de **alimentación** y mejor en Europa; si no lo
encuentra, escribes el nombre.

> **Nota:** el escaneo usa `BarcodeDetector`, la API nativa del navegador, que
> existe en **Chrome/Edge** (Android y escritorio) pero **no en Safari/iOS ni
> Firefox**. Ahí se escribe el número a mano.

> **Requisitos:** Home Assistant **2024.7+**. Para que se vea el icono de la
> integración hace falta **2026.3+**.

## Voz con Assist

En `configuration.yaml`:

```yaml
intent_script:
  AddShoppingItem:
    action:
      - action: tucompra.add_item
        data:
          name: "{{ item }}"
        response_variable: result
    speech:
      # La variable que ve `speech` es `action_response`, no la de
      # `response_variable`: así expone HA lo que devolvió la acción.
      #
      # Dice el producto que REALMENTE casó, no lo que dictaste. Si pides "pan"
      # y el catálogo tiene varios, repetir tus palabras te ocultaría el fallo
      # hasta que estuvieras en la tienda.
      text: >-
        {% if action_response.ambiguous %}
          Añadido {{ action_response.product_name }}. También encontré {{ action_response.alternatives | join(', ') }}.
        {% else %}
          Añadido {{ action_response.product_name }} a la lista.
        {% endif %}
```

`tucompra.add_item` devuelve:

| Campo | Qué es |
|---|---|
| `product_name` | El producto que **casó de verdad**. Puede no ser lo que dijiste |
| `alternatives` | Otros que también casaban, del más probable al menos |
| `ambiguous` | `true` si había más de un candidato |
| `classified` | `false` si acabó en la bandeja **📥 Por clasificar** |

Los intents propios de Home Assistant **no mantienen conversación** (responden una
vez y terminan), así que Tu Compra no puede repreguntar *"¿querías X o Y?"* y
actuar según contestes. Decir en voz alta el nombre que casó es lo más cerca que
se puede estar: te enteras del error en el momento y no en la caja.

Y en `custom_sentences/es/tucompra.yaml`:

```yaml
language: "es"
intents:
  AddShoppingItem:
    data:
      - sentences:
          - "(añade|agrega|apunta|pon|mete) {item} a la (lista|compra|lista de la compra)"
          - "(añade|agrega|apunta|pon|mete) {item} en la (lista|compra|lista de la compra)"
lists:
  item:
    wildcard: true
```

Reinicia HA y di: *"añade papel higiénico a la compra"*.

> ⚠️ Las `custom_sentences` solo las reconoce el agente **"Home Assistant"**. Con
> un agente LLM (Gemini, ChatGPT…), cámbialo a "Home Assistant" o activa
> **"Preferir gestionar comandos localmente"**.

---

## License

MIT
