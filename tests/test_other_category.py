"""El alta por voz conserva una referencia válida a la categoría universal."""
import asyncio
import importlib.util
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_unknown_voice_product_uses_existing_category(monkeypatch):
    package = types.ModuleType("other_category_integration")
    package.__path__ = [str(ROOT / "custom_components" / "tucompra")]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    core = types.ModuleType("homeassistant.core")
    core.HomeAssistant = object
    storage = types.ModuleType("homeassistant.helpers.storage")

    class FakeStore:
        def __init__(self, *args):
            self.saved = None

        async def async_save(self, data):
            self.saved = data

    storage.Store = FakeStore
    monkeypatch.setitem(sys.modules, "homeassistant", types.ModuleType("homeassistant"))
    monkeypatch.setitem(sys.modules, "homeassistant.helpers", types.ModuleType("homeassistant.helpers"))
    monkeypatch.setitem(sys.modules, "homeassistant.core", core)
    monkeypatch.setitem(sys.modules, "homeassistant.helpers.storage", storage)
    spec = importlib.util.spec_from_file_location(
        f"{package.__name__}.store", ROOT / "custom_components" / "tucompra" / "store.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    hass = types.SimpleNamespace(config=types.SimpleNamespace(language="en", country="GB"))
    store = module.TuCompraStore(hass)
    catalog = json.loads((ROOT / "custom_components" / "tucompra" / "catalog.json").read_text())
    store.catalog = catalog
    asyncio.run(store.async_ensure_personal("test-user"))
    result = asyncio.run(store.async_add_named_item("zzzz-unlisted-request", quantity=2, unit="kg"))
    snapshot = store.get_snapshot("personal:test-user")
    product = snapshot["customProducts"][0]
    assert product["categoryId"] == "otr-otros"
    assert any(c["id"] == product["categoryId"] for c in catalog["categories"])
    assert result["store_id"] == "inbox"
    assert result["matched"] is False
    item = snapshot["lists"]["inbox"]["items"][0]
    assert (item["productId"], item["qty"], item["unit"]) == (product["id"], 2, "kg")
