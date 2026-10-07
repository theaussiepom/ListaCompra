"""Alias opcionales: sugerencias amplias, acciones conservadoras."""
import asyncio
import json
import subprocess
from types import SimpleNamespace

import pytest

from test_routing import ROOT, routing
from test_safe_matching import _load_store


CASES = json.loads((ROOT / "tests/fixtures/product-aliases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_alias_resolution(case):
    for products in (case["products"], list(reversed(case["products"]))):
        details = routing.match_details(case["query"], products)
        assert [[m["score"], m["source"], m["product"]["id"]] for m in details] == case["matches"]
        catalog = {"products": [{**p, "categoryId": "food"} for p in products],
                   "categories": [{"id": "food", "typeId": "market"}],
                   "stores": [{"id": "market", "typeId": "market"}]}
        result = routing.resolve(case["query"], {}, catalog)
        assert (result["product"] or {}).get("id") == case["automatic"]
        if case["automatic"] is None:
            assert result["store_id"] is None
        else:
            assert result["alternatives"] == []
        if case["name"] == "alias collision":
            assert result["alternatives"] == ["Baked beans", "Kidney beans"]


def test_exported_aliases_are_read_by_python():
    script = """
      import { exportProduct } from './scripts/catalog-product.ts';
      import { mk } from './src/lib/data/locales/products/_mk.ts';
      console.log(JSON.stringify(exportProduct(mk('test')('coffee', 'Coffee', 'food', '☕', 'unidad', ['Café']))));
    """
    result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", script],
                            cwd=ROOT, check=True, capture_output=True, text=True)
    product = json.loads(result.stdout)
    assert product["aliases"] == ["Café"]
    catalog = {"products": [product], "categories": [{"id": "food", "typeId": "market"}],
               "stores": [{"id": "market", "typeId": "market"}]}
    resolved = routing.resolve("cafe", {}, catalog)
    assert resolved["product"]["id"] == "test-coffee"
    assert resolved["store_id"] == "market"


@pytest.mark.parametrize("query,expected", [("Panadol", "custom-medicine"), ("Panadol Night", None)])
def test_alias_service_uses_existing_identity(monkeypatch, query, expected):
    module = _load_store(monkeypatch)
    store = module.TuCompraStore(SimpleNamespace(config=SimpleNamespace(language="en", country="GB")))
    store.catalog = {"products": [], "categories": [{"id": "medicine", "typeId": "pharmacy"}],
                     "stores": [{"id": "pharmacy", "typeId": "pharmacy"}]}
    share = asyncio.run(store.async_ensure_personal("user"))
    product = {"id": "custom-medicine", "name": "Paracetamol", "categoryId": "medicine", "aliases": ["Panadol"]}
    share["snapshot"] = {"lists": {}, "customProducts": [product], "customStores": []}
    result = asyncio.run(store.async_add_named_item(query))
    assert result["matched"] == bool(expected)
    if expected:
        assert result["product_id"] == expected
        assert result["store_id"] == "pharmacy"
        assert share["snapshot"]["customProducts"] == [product]
    else:
        assert result["store_id"] == "inbox"
        assert result["product_name"] == query
