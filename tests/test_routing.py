"""Pruebas del enrutado por voz.

Lo que de verdad protegen: `resolve_locale` en Python es un CALCO de
`resolveLocale` en src/lib/i18n/locale.ts. Si una de las dos cambia y la otra
no, el frontend siembra las tiendas de un idioma y la voz añade productos de
otro — y el usuario acaba con items cuyo producto su app no conoce. Es un fallo
silencioso: nada peta, simplemente aparecen listas raras.

Se ejecutan en CI (ver .github/workflows/validate.yml). No necesitan Home
Assistant: routing.py no lo importa, a propósito.
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load_routing():
    spec = importlib.util.spec_from_file_location(
        "routing", ROOT / "custom_components" / "tucompra" / "routing.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


routing = _load_routing()


# --- resolve_locale ------------------------------------------------------

def test_espanol_y_cooficiales():
    # eu/ca/gl van al catálogo español a propósito: el proyecto nace en Euskadi
    # y un HA en euskera no espera ver Tesco.
    for lang in ("es", "eu", "ca", "gl"):
        assert routing.resolve_locale(lang, None) == "es", lang
    assert routing.resolve_locale("es-ES", "ES") == "es"


def test_ingles_britanico_vs_americano():
    assert routing.resolve_locale("en", "GB") == "en"
    assert routing.resolve_locale("en", "US") == "us"
    assert routing.resolve_locale("en-US", "US") == "us"
    # Sin país reportado por HA cae al británico. Es lo mismo que hace el
    # frontend, y que coincidan importa más que acertar.
    assert routing.resolve_locale("en", None) == "en"


def test_resto_de_idiomas():
    assert routing.resolve_locale("fr", "FR") == "fr"
    assert routing.resolve_locale("de", "DE") == "de"
    assert routing.resolve_locale("de-CH", None) == "de"
    assert routing.resolve_locale("pt", "BR") == "br"
    assert routing.resolve_locale("pt-BR", None) == "br"


def test_idioma_no_soportado_cae_al_ingles():
    for lang in ("it", "nl", "pl", "zz", "", None):
        assert routing.resolve_locale(lang, None) == "en", lang


def test_default_locale_coincide_con_el_frontend():
    """DEFAULT_LOCALE debe ser el mismo en Python y en TypeScript."""
    ts = (ROOT / "src" / "lib" / "i18n" / "locale.ts").read_text(encoding="utf-8")
    m = re.search(r"DEFAULT_LOCALE:\s*Locale\s*=\s*'([a-z]+)'", ts)
    assert m, "no se encontró DEFAULT_LOCALE en locale.ts"
    assert routing.DEFAULT_LOCALE == m.group(1), (
        f"Python usa {routing.DEFAULT_LOCALE!r} y el frontend {m.group(1)!r}"
    )


# --- catalog_for ---------------------------------------------------------

CATALOG = {
    "categories": [
        {"id": "far-medicacion", "typeId": "farmacia"},
        {"id": "sup-lacteos", "typeId": "supermercado"},
    ],
    "locales": {
        "es": {
            "products": [{"id": "p-para", "name": "Paracetamol", "categoryId": "far-medicacion"}],
            "stores": [{"id": "farmacia", "name": "Farmacia", "typeId": "farmacia"}],
        },
        "en": {
            "products": [{"id": "uk-p-paracetamol", "name": "Paracetamol", "categoryId": "far-medicacion"}],
            "stores": [{"id": "uk-boots", "name": "Boots", "typeId": "farmacia"}],
        },
    },
}


def test_aplana_al_locale_pedido():
    flat = routing.catalog_for(CATALOG, "en", "GB")
    assert [s["id"] for s in flat["stores"]] == ["uk-boots"]
    assert [p["id"] for p in flat["products"]] == ["uk-p-paracetamol"]
    # Las categorías son comunes: no dependen del idioma.
    assert flat["categories"] == CATALOG["categories"]

    flat_es = routing.catalog_for(CATALOG, "es", "ES")
    assert [s["id"] for s in flat_es["stores"]] == ["farmacia"]


def test_locale_ausente_cae_al_default():
    # 'fr' no está en este catálogo de prueba → debe caer al inglés, no petar.
    flat = routing.catalog_for(CATALOG, "fr", "FR")
    assert [s["id"] for s in flat["stores"]] == ["uk-boots"]


def test_formato_plano_antiguo_no_revienta():
    viejo = {"products": [], "categories": [], "stores": []}
    assert routing.catalog_for(viejo, "en", "GB") == viejo


# --- resolve con el catálogo del idioma ----------------------------------

def test_la_voz_enruta_al_catalogo_de_su_idioma():
    """"Paracetamol" en un HA inglés debe ir a Boots, no a la Farmacia española.

    Es el fallo original: el backend solo llevaba el catálogo español, así que
    un usuario inglés no obtenía nada.
    """
    snap = {"lists": {}, "customProducts": [], "customStores": [], "defaultStores": {}}
    res = routing.resolve("paracetamol", snap, routing.catalog_for(CATALOG, "en", "GB"))
    assert res["product"]["id"] == "uk-p-paracetamol"
    assert res["type_id"] == "farmacia"
    assert res["store_id"] == "uk-boots"

    res_es = routing.resolve("paracetamol", snap, routing.catalog_for(CATALOG, "es", "ES"))
    assert res_es["store_id"] == "farmacia"


def test_producto_desconocido_va_a_la_bandeja():
    snap = {"lists": {}, "customProducts": [], "customStores": [], "defaultStores": {}}
    res = routing.resolve("zzzz-no-existe", snap, routing.catalog_for(CATALOG, "en", "GB"))
    assert res["product"] is None
    assert res["store_id"] is None       # → el llamante lo manda a inbox


# --- el catálogo exportado (si el build lo ha generado) -------------------

def test_exacto_gana_a_empieza_por():
    """Pedir "pan" por voz daba "Panceta".

    Ambos empiezan por "pan" (score 4) y ganaba el primero del catálogo. El
    tramo exacto (5) es lo que lo arregla. Si alguien lo quita, esto salta.
    """
    assert routing._score("pan", "pan") == 5
    assert routing._score("panceta", "pan") == 4
    productos = [
        {"id": "panceta", "name": "Panceta", "categoryId": "car-cerdo"},
        {"id": "pan", "name": "Pan", "categoryId": "pan-pan"},
    ]
    assert routing.match_product("pan", productos)["id"] == "pan"
    # Y con el catálogo al revés, para que no dependa del orden.
    assert routing.match_product("pan", list(reversed(productos)))["id"] == "pan"


def test_a_igual_puntuacion_gana_el_nombre_mas_corto():
    productos = [
        {"id": "largo", "name": "Leche condensada azucarada", "categoryId": "sup-lacteos"},
        {"id": "corto", "name": "Leche entera", "categoryId": "sup-lacteos"},
    ]
    # Los dos empiezan por "leche": debe ganar el más corto, no el orden.
    assert routing.match_product("leche", productos)["id"] == "corto"


def _cat(productos):
    return {"categories": [{"id": "pan-pan", "typeId": "panaderia"}],
            "locales": {"en": {"products": productos, "stores": []}}}


def test_solo_es_ambiguo_si_hay_empate():
    """Alternativas = las que EMPATAN con el ganador, no cualquier coincidencia.

    Si valiera cualquiera, "leche" (exacta) saldría ambigua por "Chocolate con
    leche" y Assist recitaría alternativas en cada frase. Comprobado con el
    catálogo real: "milk" traía ['Milk chocolate bar', 'Oat milk'].
    """
    productos = [
        {"id": "pan", "name": "Pan", "categoryId": "pan-pan"},
        {"id": "panceta", "name": "Panceta", "categoryId": "pan-pan"},
    ]
    res = routing.resolve("pan", {}, routing.catalog_for(_cat(productos), "en", "GB"))
    assert res["product"]["id"] == "pan"
    # "Pan" es exacto (5) y "Panceta" solo empieza por (4): no hay duda.
    assert res["alternatives"] == []


def test_alternativas_cuando_empatan_de_verdad():
    productos = [
        {"id": "entera", "name": "Leche entera", "categoryId": "pan-pan"},
        {"id": "desnatada", "name": "Leche desnatada", "categoryId": "pan-pan"},
    ]
    res = routing.resolve("leche", {}, routing.catalog_for(_cat(productos), "en", "GB"))
    # Ninguna es exacta y ambas empiezan por "leche" (4): duda real.
    assert res["product"] is None
    assert res["alternatives"] == ["Leche entera", "Leche desnatada"]


def test_las_alternativas_no_repiten_nombre():
    """El mismo nombre puede estar en dos secciones (súper y panadería). Assist
    diciendo "también encontré Bread rolls, Bread rolls" queda a medio hacer."""
    productos = [
        {"id": "a", "name": "Bread rolls", "categoryId": "pan-pan"},
        {"id": "b", "name": "Bread rolls", "categoryId": "pan-pan"},
        {"id": "c", "name": "Bread sticks", "categoryId": "pan-pan"},
    ]
    res = routing.resolve("bread", {}, routing.catalog_for(_cat(productos), "en", "GB"))
    assert res["alternatives"].count("Bread rolls") <= 1


def test_el_pan_generico_existe_en_todos_los_idiomas():
    """Había una docena de tipos de pan pero ninguno genérico, así que pedir
    "pan" acababa en cualquier otra cosa."""
    path = ROOT / "custom_components" / "tucompra" / "catalog.json"
    if not path.exists():
        return
    cat = json.loads(path.read_text(encoding="utf-8"))
    snap = {"lists": {}, "customProducts": [], "customStores": [], "defaultStores": {}}
    for lang, cc, termino, esperado in [
        ("es", "ES", "pan", "Pan"), ("en", "GB", "bread", "Bread"), ("en", "US", "bread", "Bread"),
        ("fr", "FR", "pain", "Pain"), ("de", "DE", "brot", "Brot"),
        ("pt", "BR", "pão", "Pão"),
    ]:
        res = routing.resolve(termino, snap, routing.catalog_for(cat, lang, cc))
        products = routing.catalog_for(cat, lang, cc)["products"]
        exact = [p for p in products if routing._norm(p["name"]) == routing._norm(termino)]
        assert exact, f"{termino!r} no existe en {lang}"
        if len(exact) == 1:
            assert res["product"]["name"] == esperado
        else:
            assert res["product"] is None
            assert res["alternatives"] == [esperado]


def test_el_ejemplo_del_readme_existe_en_todos_los_idiomas():
    """El README documenta `name: milk`. Que exista de verdad.

    El ejemplo era "toilet paper" y NO estaba en el catálogo británico —ahí es
    "toilet roll"—, siendo el británico justo el idioma por defecto. O sea que
    el ejemplo documentado no funcionaba para quien lo copiara tal cual.
    """
    path = ROOT / "custom_components" / "tucompra" / "catalog.json"
    if not path.exists():
        return
    cat = json.loads(path.read_text(encoding="utf-8"))
    snap = {"lists": {}, "customProducts": [], "customStores": [], "defaultStores": {}}
    for lang, cc, termino in [("en", "GB", "milk"), ("en", "US", "milk"), ("es", "ES", "leche")]:
        flat = routing.catalog_for(cat, lang, cc)
        assert routing.match_candidates(termino, flat["products"])
        res = routing.resolve(termino, snap, flat)
        if lang == "es":
            # Hay seis variantes de leche, ninguna canónica sin calificativo.
            assert res["product"] is None
            assert len(res["alternatives"]) > 1
        else:
            assert res["product"]["name"] == "Milk"


def test_catalogo_exportado_tiene_los_siete_locales():
    path = ROOT / "custom_components" / "tucompra" / "catalog.json"
    if not path.exists():
        return  # no se ha corrido `npm run export:catalog`; en CI sí
    cat = json.loads(path.read_text(encoding="utf-8"))
    assert "locales" in cat, "catalog.json sigue en formato plano (solo español)"
    for loc in ("es", "en", "us", "fr", "de", "br", "au"):
        assert loc in cat["locales"], f"falta el catálogo de {loc}"
        assert cat["locales"][loc]["products"], f"{loc} sin productos"
        assert cat["locales"][loc]["stores"], f"{loc} sin tiendas"
