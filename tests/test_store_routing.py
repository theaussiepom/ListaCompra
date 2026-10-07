"""Destinos seguros compartidos con las pruebas del frontend."""
import json

import pytest

from test_routing import ROOT, routing


CASES = json.loads((ROOT / "tests/fixtures/store-routing.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
@pytest.mark.parametrize("custom", [False, True], ids=["seed", "custom"])
def test_store_destination(case, custom):
    product = {"id": "custom-test" if custom else "seed-test", "name": "Milk",
               "categoryId": "unknown" if case.get("unknownCategory") else "dairy"}
    if "exclusive" in case:
        product["storeId"] = case["exclusive"]
    catalog = {"products": [] if custom else [product],
               "categories": [{"id": "dairy", "typeId": "market"}],
               "stores": case["stores"]}
    snapshot = {"customProducts": [product] if custom else [],
                "defaultStores": case.get("defaults", {})}
    result = routing.resolve("Milk", snapshot, catalog)
    assert result["store_id"] == case["expected"]
    assert result["product"] == product


def test_edited_store_overrides_seed_destination():
    product = {"id": "milk", "name": "Milk", "categoryId": "dairy", "storeId": "a"}
    catalog = {"products": [product], "categories": [{"id": "dairy", "typeId": "market"}],
               "stores": [{"id": "a", "typeId": "market"}, {"id": "b", "typeId": "market"}]}
    snapshot = {"customStores": [{"id": "a", "typeId": "market", "enabled": False}],
                "defaultStores": {"market": "b"}}
    result = routing.resolve("Milk", snapshot, catalog)
    assert result["store_id"] is None
    assert result["product"] == product


@pytest.mark.parametrize("locale", ["es", "en", "us", "fr", "de", "br", "au"])
def test_existing_locale_routing(locale):
    catalog = json.loads((ROOT / "custom_components/tucompra/catalog.json").read_text())
    data = catalog["locales"][locale]
    flat = {**data, "categories": catalog["categories"]}
    names = [p["name"] for p in data["products"]]
    product = next(p for p in data["products"]
                   if not p.get("storeId") and names.count(p["name"]) == 1
                   and p["categoryId"] == "sup-lacteos")
    matching = next(s for s in data["stores"] if s["typeId"] == "supermercado")
    other = next(s for s in data["stores"] if s["typeId"] != "supermercado")
    valid = routing.resolve(product["name"], {"defaultStores": {"supermercado": matching["id"]}}, flat)
    assert valid["store_id"] == matching["id"]
    invalid = routing.resolve(product["name"], {"defaultStores": {"supermercado": other["id"]}}, flat)
    assert invalid["store_id"] != other["id"]
    assert invalid["product"]["id"] == product["id"]
