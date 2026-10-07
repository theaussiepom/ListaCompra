"""Enrutado de productos por nombre → tienda (para el servicio add_item).

Replica la búsqueda difusa del frontend (sin acentos, por subsecuencia) y usa
el catálogo exportado (catalog.json) + los datos personalizados del snapshot
(customProducts, customStores, defaultStores) para decidir a qué tienda va un
producto dictado por voz. Si no se puede clasificar, va a la bandeja "inbox".
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

INBOX_STORE_ID = "inbox"

# Idioma de catálogo por defecto. DEBE coincidir con DEFAULT_LOCALE del frontend
# (src/lib/i18n/locale.ts).
DEFAULT_LOCALE = "en"


def load_catalog(path: Path) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"categories": [], "locales": {}}


def resolve_locale(language: str | None, country: str | None) -> str:
    """Idioma/país de HA → locale de catálogo.

    Es un calco de resolveLocale() en src/lib/i18n/locale.ts y tiene que seguir
    siéndolo: el frontend siembra las tiendas de UN locale y la voz añade
    productos de OTRO si ambos no coinciden — el resultado sería un item cuyo
    producto la app no conoce. Ambos leen el mismo hass.config, así que mientras
    la regla sea la misma, coinciden.
    """
    lang = (language or "").lower().split("-")[0]
    cc = (country or "").upper()
    if lang == "de":
        return "de"
    if lang == "fr":
        return "fr"
    if lang == "pt":
        return "br"
    if lang == "en":
        return "us" if cc == "US" else "en"
    # Cooficiales de España: el catálogo español es el que les sirve.
    if lang in ("es", "eu", "ca", "gl"):
        return "es"
    return DEFAULT_LOCALE


def catalog_for(
    catalog: dict[str, Any],
    language: str | None = None,
    country: str | None = None,
) -> dict[str, Any]:
    """Aplana el catálogo multi-idioma al locale de HA.

    Devuelve la forma plana que espera resolve(): {products, categories, stores}.
    """
    locales = catalog.get("locales")
    if not locales:
        # Formato antiguo (plano, solo español). No debería darse: el JSON viaja
        # en el mismo zip que este código.
        return catalog
    loc = resolve_locale(language, country)
    data = locales.get(loc) or locales.get(DEFAULT_LOCALE) or {}
    return {
        "products": data.get("products", []),
        "stores": data.get("stores", []),
        "categories": catalog.get("categories", []),
    }


def _norm(s: str) -> str:
    """minúsculas + sin acentos/diacríticos."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _is_subsequence(needle: str, hay: str) -> bool:
    it = iter(hay)
    return all(ch in it for ch in needle)


def _score(name_n: str, q: str) -> int:
    """Igual que scoreMatch del frontend: 5 exacto · 4 empieza · 3 contiene ·
    2 todas las palabras · 1 subsecuencia · -1 no casa.

    El 5 (exacto) existe porque sin él "pan" empataba a 4 con "panceta" —ambos
    empiezan por "pan"— y ganaba el primero del catálogo. Pedir "pan" por voz
    acababa en panceta.
    """
    if name_n == q:
        return 5
    if name_n.startswith(q):
        return 4
    if q in name_n:
        return 3
    words = [w for w in q.split() if w]
    if len(words) > 1 and all(w in name_n for w in words):
        return 2
    if _is_subsequence(re.sub(r"\s+", "", q), name_n):
        return 1
    return -1


def match_product(name: str, products: list[dict]) -> dict | None:
    return (match_candidates(name, products) or [None])[0]


def match_scored(name: str, products: list[dict]) -> list[tuple[int, dict]]:
    """(puntuación, producto) de los que casan, del mejor al peor.

    A igual puntuación gana el nombre MÁS CORTO: es el más parecido a lo pedido.
    Sin ese desempate, "leche" con dos productos que empiezan por "leche" se
    decidía por el orden del catálogo, que es arbitrario.
    """
    q = _norm(name).strip()
    if not q:
        return []
    puntuados = [
        (sc, p)
        for p in products
        if (sc := _score(_norm(p.get("name", "")), q)) > 0
    ]
    puntuados.sort(key=lambda x: (-x[0], len(_norm(x[1].get("name", ""))),
                                 _norm(x[1].get("name", "")), x[1].get("id", "")))
    return puntuados


def match_candidates(name: str, products: list[dict], limit: int = 5) -> list[dict]:
    return [p for _, p in match_scored(name, products)[:limit]]


def select_automatic_match(name: str, scored: list[tuple[int, dict]]) -> dict | None:
    """Solo exactos únicos o prefijos de palabra completa sin competidores léxicos."""
    if not scored or (len(scored) > 1 and scored[1][0] == scored[0][0]):
        return None
    score, product = scored[0]
    if score == 5:
        return product
    q = _norm(name).strip()
    text = _norm(product.get("name", ""))
    if (score == 4 and len(q) >= 3 and text[len(q):len(q) + 1].isspace()
            and not any(candidate_score >= 3 for candidate_score, _ in scored[1:])):
        return product
    return None


def tied_alternatives(scored: list[tuple[int, dict]], limit: int = 3) -> list[str]:
    """Candidatos fuertes empatados, sin decidir por orden ni repetir nombres."""
    if len(scored) < 2 or scored[0][0] < 4 or scored[0][0] != scored[1][0]:
        return []
    mejor = scored[0][0]
    fuera: set[str] = set()
    out: list[str] = []
    for sc, p in scored:
        if sc != mejor:
            break                       # ya vienen ordenados: el resto puntúa menos
        n = p.get("name", "")
        if _norm(n) in fuera:
            continue                    # mismo nombre en otra sección (p.ej. súper y panadería)
        fuera.add(_norm(n))
        out.append(n)
        if len(out) >= limit:
            break
    return out


def resolve(name: str, snapshot: dict | None, catalog: dict) -> dict[str, Any]:
    """Devuelve {product, type_id, store_id}. store_id None → va a inbox."""
    snapshot = snapshot or {}
    products = list(catalog.get("products", [])) + list(snapshot.get("customProducts", []))
    puntuados = match_scored(name, products)
    product = select_automatic_match(name, puntuados)
    alternativas = tied_alternatives(puntuados)

    cat_type = {c["id"]: c["typeId"] for c in catalog.get("categories", [])}
    stores = {s["id"]: s for s in catalog.get("stores", [])}
    for s in snapshot.get("customStores", []):
        stores[s["id"]] = s  # los custom (incl. seed editadas) mandan
    default_stores = snapshot.get("defaultStores", {}) or {}

    type_id = cat_type.get(product.get("categoryId")) if product else None

    store_id: str | None = None

    # Una tienda exclusiva no disponible no permite sustituir el destino.
    exclusive = product.get("storeId") if product else None
    if exclusive:
        target = stores.get(exclusive)
        if type_id and target and target.get("typeId") == type_id and target.get("enabled", True) is not False:
            store_id = exclusive
        return {"product": product, "type_id": type_id, "store_id": store_id,
                "alternatives": alternativas}

    if type_id:
        of_type = [
            s for s in stores.values()
            if s.get("typeId") == type_id and s.get("enabled", True) is not False
        ]
        explicit = default_stores.get(type_id)
        if explicit and any(s["id"] == explicit for s in of_type):
            store_id = explicit
        elif len(of_type) == 1:
            store_id = of_type[0]["id"]

    return {"product": product, "type_id": type_id, "store_id": store_id,
            "alternatives": alternativas}
