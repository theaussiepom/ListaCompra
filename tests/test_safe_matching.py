"""La búsqueda propone candidatos; la voz solo actúa con confianza."""
import asyncio
import importlib.util
import json
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from test_routing import ROOT, routing


CASES = json.loads((ROOT / "tests/fixtures/safe-matching.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_automatic_matching(case):
    products = [{**p, "categoryId": "dairy"} for p in case["products"]]
    catalog = {"products": products, "categories": [{"id": "dairy", "typeId": "market"}],
               "stores": [{"id": "market", "typeId": "market"}]}
    for ordered in (products, list(reversed(products))):
        result = routing.resolve(case["query"], {}, {**catalog, "products": ordered})
        assert (result["product"] or {}).get("id") == case["automatic"]
        if case["automatic"] is None:
            assert result["store_id"] is None


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_interactive_ranking_stays_permissive(case):
    for products in (case["products"], list(reversed(case["products"]))):
        assert [[score, p["id"]] for score, p in routing.match_scored(case["query"], products)] == case["scores"]


def _load_store(monkeypatch):
    package = ModuleType("_safe_matching_store")
    package.__path__ = [str(ROOT / "custom_components/tucompra")]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    core = ModuleType("homeassistant.core")
    core.HomeAssistant = object
    storage = ModuleType("homeassistant.helpers.storage")
    storage.Store = lambda *args: SimpleNamespace(async_save=AsyncMock())
    monkeypatch.setitem(sys.modules, "homeassistant.core", core)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.storage", storage)
    for name in ("const", "routing", "store"):
        spec = importlib.util.spec_from_file_location(
            f"{package.__name__}.{name}", ROOT / f"custom_components/tucompra/{name}.py")
        module = importlib.util.module_from_spec(spec)
        monkeypatch.setitem(sys.modules, spec.name, module)
        spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("name", ["  MiXeD Brand Night  ", "detergent", "aBc"])
def test_service_preserves_unresolved_request(monkeypatch, name):
    module = _load_store(monkeypatch)
    store = module.TuCompraStore(SimpleNamespace(config=SimpleNamespace(language="en", country="GB")))
    store.catalog = {
        "products": [{"id": "laundry", "name": "Laundry detergent", "categoryId": "dairy"},
                     {"id": "cabbage", "name": "A bright cabbage", "categoryId": "dairy"}],
        "categories": [{"id": "dairy", "typeId": "market"}],
        "stores": [{"id": "market", "typeId": "market"}],
    }
    share = asyncio.run(store.async_ensure_personal("user"))
    result = asyncio.run(store.async_add_named_item(name, quantity=2.5, unit="kg"))
    assert result["matched"] is False
    assert result["store_id"] == "inbox"
    assert result["product_name"] == name.strip()
    snapshot = share["snapshot"]
    assert snapshot["customProducts"][0]["name"] == name.strip()
    item = snapshot["lists"]["inbox"]["items"][0]
    assert item["productId"] == result["product_id"]
    assert item["qty"] == 2.5
    assert item["unit"] == "kg"
