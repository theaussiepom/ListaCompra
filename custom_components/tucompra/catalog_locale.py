"""Identidad persistente del catálogo y conservación de referencias de seeds."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from .routing import get_product_concept_resolver

LOCALES = ("es", "en", "us", "fr", "de", "br")


def catalog_references(snapshot: dict, catalog: dict) -> tuple[set[str], set[str]]:
    products = set((snapshot.get("productIcons") or {}).keys())
    stores = set((snapshot.get("defaultStores") or {}).values())
    all_products = {p["id"]: p for data in catalog.get("locales", {}).values() for p in data.get("products", [])}
    all_stores = {s["id"]: s for data in catalog.get("locales", {}).values() for s in data.get("stores", [])}
    for store_id, shopping_list in (snapshot.get("lists") or {}).items():
        stores.add(store_id)
        stores.add(shopping_list.get("storeId", store_id))
        products.update(i["productId"] for i in shopping_list.get("items", []))
    for store_id, counts in (snapshot.get("usage") or {}).items():
        stores.add(store_id)
        products.update(counts.keys())
    for s in [*snapshot.get("stores", []), *snapshot.get("customStores", [])]:
        if s.get("edited") or s.get("loyalty") or s.get("enabled") is False or (s.get("order") is not None and s.get("order") != all_stores.get(s["id"], {}).get("order")) or s["id"] not in all_stores:
            stores.add(s["id"])
    local_products = [*snapshot.get("products", []), *snapshot.get("customProducts", []), *snapshot.get("retainedProducts", [])]
    concept = get_product_concept_resolver([*all_products.values(), *[p for p in local_products if p["id"] not in all_products]])
    roots = [p for p in local_products if p["id"] not in all_products] + snapshot.get("retainedProducts", [])
    roots.extend(all_products.get(product_id) or next((p for p in local_products if p["id"] == product_id), None) for product_id in products)
    # Una referencia al mirror conserva su destino directo, aunque sea de otro seed.
    for product in roots:
        if product is None:
            continue
        target = concept(product)
        if "mirrorOf" in product and target is not None and target["id"] != product["id"]:
            products.add(target["id"])
    for p in local_products:
        if (p["id"] not in all_products or p["id"] in products) and p.get("storeId"):
            stores.add(p["storeId"])
    for product_id in products:
        if all_products.get(product_id, {}).get("storeId"):
            stores.add(all_products[product_id]["storeId"])
    return products, stores


def _store_overrides(snapshot: dict, catalog: dict) -> list[dict]:
    seeds = {s["id"]: s for data in catalog.get("locales", {}).values() for s in data.get("stores", [])}
    return [s for s in snapshot.get("customStores", []) if
            s["id"] not in seeds or s.get("edited") or s.get("loyalty") or s.get("enabled") is False or
            (s.get("order") is not None and s.get("order") != seeds[s["id"]].get("order"))]


def snapshot_for_routing(snapshot: dict, catalog: dict) -> dict:
    seeds = {s["id"]: s for data in catalog.get("locales", {}).values() for s in data.get("stores", [])}
    stores = []
    for store in _store_overrides(snapshot, catalog):
        seed = seeds.get(store["id"])
        if seed and not store.get("edited"):
            store = {**store, "name": seed["name"], "typeId": seed["typeId"]}
        stores.append(store)
    return {**snapshot, "customStores": stores}


def pin_catalog_locale(snapshot: dict | None, catalog: dict, fallback: str, legacy_locale: str | None = None) -> dict[str, Any]:
    result = deepcopy(snapshot or {})
    if "customStores" in result:
        result["customStores"] = _store_overrides(result, catalog)
    if result.get("catalogLocale") in LOCALES:
        return result
    product_ids, store_ids = catalog_references(result, catalog)
    evidence = [loc for loc in LOCALES if
                any(p["id"] in product_ids for p in catalog.get("locales", {}).get(loc, {}).get("products", [])) or
                any(s["id"] in store_ids for s in catalog.get("locales", {}).get(loc, {}).get("stores", []))]
    if not evidence and result.get("profile"):
        local_stores = {s["id"] for s in result.get("stores", [])}
        evidence = [loc for loc in LOCALES if any(s["id"] in local_stores for s in catalog.get("locales", {}).get(loc, {}).get("stores", []))]
    explicit = result.get("locale") or legacy_locale
    result["catalogLocale"] = explicit if explicit in LOCALES and (not evidence or explicit in evidence) else (evidence[0] if evidence else fallback)
    result.setdefault("lists", {})
    result.setdefault("customProducts", [])
    result.setdefault("customStores", [])
    result.setdefault("updatedAt", 0)
    return result


def catalog_for_snapshot(catalog: dict, snapshot: dict) -> dict:
    if not catalog.get("locales"):
        return catalog
    current = catalog["locales"].get(snapshot["catalogLocale"], {})
    products = {p["id"]: p for p in current.get("products", [])}
    stores = {s["id"]: s for s in current.get("stores", [])}
    product_ids, store_ids = catalog_references(snapshot, catalog)
    for data in catalog["locales"].values():
        for p in data.get("products", []):
            if p["id"] in product_ids:
                products.setdefault(p["id"], p)
        for s in data.get("stores", []):
            if s["id"] in store_ids:
                stores.setdefault(s["id"], s)
    for p in snapshot.get("retainedProducts", []):
        products.setdefault(p["id"], p)
    return {
        "products": list(products.values()), "stores": list(stores.values()),
        "categories": [*catalog.get("categories", []), *snapshot.get("customCategories", [])],
    }
