"""Migración de catálogo y persistencia real del servicio, con storage de HA aislado."""
from __future__ import annotations

import asyncio
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "tucompra"
package = ModuleType("catalog_locale_tests")
package.__path__ = [str(COMPONENT)]
sys.modules[package.__name__] = package
spec = importlib.util.spec_from_file_location(f"{package.__name__}.catalog_locale", COMPONENT / "catalog_locale.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)
CATALOG = json.loads((COMPONENT / "catalog.json").read_text())
CASES = json.loads((ROOT / "tests" / "fixtures" / "catalog-locale.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_migration_parity(case):
    source = deepcopy(case["data"])
    migrated = migration.pin_catalog_locale(source, CATALOG, case["fallback"])
    assert migrated["catalogLocale"] == case["expected"]
    assert source == case["data"]
    assert migration.pin_catalog_locale(migrated, CATALOG, "es") == migrated


def test_reference_recovery_uses_every_catalogue():
    snapshot = {"catalogLocale": "en", "lists": {
        "fr-carrefour": {"storeId": "fr-carrefour", "items": [{"productId": "fr-pommes"}], "updatedAt": 1}},
        "usage": {"us-walmart": {"us-apples": 2}}, "productIcons": {"de-aepfel": {"kind": "emoji", "value": "⭐"}},
        "customProducts": [{"id": "custom-one", "storeId": "br-carrefour"}]}
    flat = migration.catalog_for_snapshot(CATALOG, snapshot)
    products, stores = migration.catalog_references(snapshot, CATALOG)
    known_products = {p["id"] for data in CATALOG["locales"].values() for p in data["products"]}
    known_stores = {s["id"] for data in CATALOG["locales"].values() for s in data["stores"]}
    assert products <= known_products
    assert stores <= known_stores
    assert products <= {p["id"] for p in flat["products"]}
    assert stores <= {s["id"] for s in flat["stores"]}


@pytest.fixture
def store_type(monkeypatch):
    core = ModuleType("homeassistant.core")
    core.HomeAssistant = object
    storage = ModuleType("homeassistant.helpers.storage")

    class FakeStorage:
        def __init__(self, hass, version, key):
            self.hass = hass

        async def async_load(self):
            return deepcopy(self.hass.disk)

        async def async_save(self, data):
            self.hass.disk = json.loads(json.dumps(data))
            self.hass.saves += 1

    storage.Store = FakeStorage
    for name, module in [("homeassistant", ModuleType("homeassistant")), ("homeassistant.core", core),
                         ("homeassistant.helpers", ModuleType("homeassistant.helpers")), ("homeassistant.helpers.storage", storage)]:
        monkeypatch.setitem(sys.modules, name, module)
    package = ModuleType("catalog_locale_test_component")
    package.__path__ = [str(COMPONENT)]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    spec = importlib.util.spec_from_file_location(f"{package.__name__}.store", COMPONENT / "store.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.TuCompraStore


def make_hass(language="de", country="DE", snapshot=None):
    return SimpleNamespace(config=SimpleNamespace(language=language, country=country), saves=0,
                           disk={"shares": {"shared:one": {"id": "shared:one", "members": ["u1", "u2"], "snapshot": snapshot, "updatedAt": 0}}})


def test_empty_share_pins_server_resolver_and_survives_reload(store_type):
    async def run():
        for lang, country, expected in [("es", "ES", "es"), ("en", "GB", "en"), ("en", "US", "us"), ("fr", "FR", "fr"), ("de", "DE", "de"), ("pt", "BR", "br"), ("en", "AU", "au")]:
            hass = make_hass(lang, country)
            store = store_type(hass)
            await store.async_load()
            first = await store.async_get_snapshot("shared:one")
            assert first["catalogLocale"] == expected
            hass.config.language, hass.config.country = "en", "US"
            reloaded = store_type(hass)
            await reloaded.async_load()
            assert await reloaded.async_get_snapshot("shared:one", "fr") == first
            assert hass.saves == 1
    asyncio.run(run())


def test_legacy_references_local_hint_and_shared_authority(store_type):
    async def run():
        snapshot = {"lists": {"uk-tesco": {"storeId": "uk-tesco", "items": [{"productId": "uk-apples"}], "updatedAt": 9}},
                    "defaultStores": {"supermercado": "uk-tesco"}, "usage": {"uk-tesco": {"uk-apples": 3}},
                    "productIcons": {"uk-apples": {"kind": "emoji", "value": "⭐"}},
                    "customProducts": [{"id": "custom-one", "name": "Special", "storeId": "fr-carrefour", "categoryId": "sup-fruteria"}],
                    "customStores": [{"id": "uk-tesco", "name": "My Tesco", "typeId": "supermercado", "edited": True, "loyalty": {"code": "123", "format": "qr"}}],
                    "updatedAt": 10}
        hass = make_hass(snapshot=deepcopy(snapshot))
        store = store_type(hass)
        await store.async_load()
        first = await store.async_get_snapshot("shared:one", "en")
        assert first == {**snapshot, "catalogLocale": "en"}
        assert await store.async_get_snapshot("shared:one", "de") == first
        assert hass.saves == 1
        incoming = {**first, "catalogLocale": "fr", "updatedAt": 20}
        await store.async_set_snapshot("shared:one", incoming, 20)
        assert store.get_snapshot("shared:one")["catalogLocale"] == "en"
        assert incoming["catalogLocale"] == "fr"
        reloaded = store_type(hass)
        await reloaded.async_load()
        assert reloaded.get_snapshot("shared:one") == {**first, "updatedAt": 20}
        assert reloaded.is_member("shared:one", "u2")
    asyncio.run(run())


def test_service_voice_uses_shared_catalogue_after_server_language_change(store_type):
    async def run():
        hass = make_hass(snapshot={"catalogLocale": "en", "defaultStores": {"supermercado": "uk-tesco"}})
        store = store_type(hass)
        await store.async_load()
        result = await store.async_add_named_item("Apples", share_id="shared:one")
        assert result["matched"]
        assert result["product_id"] == "uk-apples"
        assert result["store_id"] == "uk-tesco"
        saved = hass.disk["shares"]["shared:one"]["snapshot"]
        assert saved["catalogLocale"] == "en"
        assert saved["lists"]["uk-tesco"]["items"][0]["productId"] == "uk-apples"
    asyncio.run(run())


def test_legacy_client_cannot_erase_pin_or_change_it_through_post(store_type):
    async def run():
        hass = make_hass(snapshot={"catalogLocale": "en", "lists": {}, "updatedAt": 10})
        store = store_type(hass)
        await store.async_load()
        await store.async_set_snapshot("shared:one", {"lists": {}, "updatedAt": 20}, 20)
        assert store.get_snapshot("shared:one")["catalogLocale"] == "en"
        await store.async_set_snapshot("shared:one", {"catalogLocale": "fr", "updatedAt": 15}, 15)
        assert store.get_snapshot("shared:one")["catalogLocale"] == "en"
        assert store.updated_at("shared:one") == 20
    asyncio.run(run())


def test_old_clients_preserve_additive_metadata_but_explicit_empty_clears_it(store_type):
    async def run():
        metadata = {"usage": {"uk-tesco": {"uk-apples": 2}}, "productIcons": {"uk-apples": {"kind": "emoji", "value": "⭐"}}, "customCategories": [{"id": "custom-category"}], "retainedProducts": [{"id": "fr-pommes"}]}
        hass = make_hass(snapshot={"catalogLocale": "en", **metadata})
        store = store_type(hass)
        await store.async_load()
        await store.async_set_snapshot("shared:one", {"lists": {}, "updatedAt": 20}, 20)
        assert all(store.get_snapshot("shared:one")[key] == value for key, value in metadata.items())
        cleared = {"usage": {}, "productIcons": {}, "customCategories": [], "retainedProducts": []}
        await store.async_set_snapshot("shared:one", {"lists": {}, "updatedAt": 30, **cleared}, 30)
        assert all(store.get_snapshot("shared:one")[key] == value for key, value in cleared.items())
    asyncio.run(run())


def test_legacy_save_preserves_seed_store_metadata_but_new_snapshot_can_clear_it(store_type):
    async def run():
        old = {"id": "uk-tesco", "name": "My Tesco", "typeId": "supermercado", "edited": True, "enabled": False, "order": 9, "loyalty": {"code": "123", "format": "qr"}}
        hass = make_hass(snapshot={"catalogLocale": "en", "customStores": [old], "customCategories": []})
        store = store_type(hass)
        await store.async_load()
        await store.async_set_snapshot("shared:one", {"lists": {}, "customStores": [], "updatedAt": 20}, 20)
        assert store.get_snapshot("shared:one")["customStores"] == [old]
        await store.async_set_snapshot("shared:one", {"lists": {}, "customStores": [], "customCategories": [], "updatedAt": 30}, 30)
        assert store.get_snapshot("shared:one")["customStores"] == []
    asyncio.run(run())


def test_old_referenced_seed_copies_do_not_freeze_current_name_or_type():
    catalog = {"locales": {"en": {"products": [], "stores": [{"id": "known", "name": "Current", "typeId": "supermercado"}]}}}
    old = {"catalogLocale": "en", "defaultStores": {"supermercado": "known"}, "customStores": [{"id": "known", "name": "Stale", "typeId": "farmacia", "icon": {"kind": "emoji", "value": "OLD"}}]}
    migrated = migration.pin_catalog_locale(old, catalog, "fr")
    assert migrated["customStores"] == []
    assert migrated["defaultStores"] == old["defaultStores"]
    assert migration.catalog_for_snapshot(catalog, migrated)["stores"][0]["name"] == "Current"
    assert migration.snapshot_for_routing(old, catalog)["customStores"] == []
    assert old["customStores"][0]["name"] == "Stale"
    assert migration.pin_catalog_locale(migrated, catalog, "de") == migrated


def test_customized_seed_routing_uses_current_identity_unless_explicitly_edited():
    catalog = {"locales": {"en": {"stores": [{"id": "known", "name": "Current", "typeId": "supermercado", "order": 0}]}}}
    old = {"id": "known", "name": "Stale", "typeId": "farmacia", "icon": {"kind": "emoji", "value": "OLD"}}
    for override in [{"enabled": False}, {"order": 2}, {"loyalty": {"code": "123", "format": "qr"}}]:
        snapshot = {"customStores": [{**old, **override}]}
        routed = migration.snapshot_for_routing(snapshot, catalog)["customStores"][0]
        assert routed["name"] == "Current"
        assert routed["typeId"] == "supermercado"
        assert all(routed[key] == value for key, value in override.items())
        assert snapshot["customStores"][0]["name"] == "Stale"
    edited = {"customStores": [{**old, "edited": True}]}
    assert migration.snapshot_for_routing(edited, catalog) == edited
    custom = {"customStores": [{**old, "id": "custom-shop"}]}
    assert migration.snapshot_for_routing(custom, catalog) == custom


def test_voice_write_advances_both_timestamps_and_rejects_stale_browser_save(store_type, monkeypatch):
    async def run():
        original = {"catalogLocale": "en", "lists": {}, "customProducts": [], "customStores": [], "updatedAt": 100}
        hass = make_hass(snapshot=deepcopy(original))
        store = store_type(hass)
        await store.async_load()
        await store.async_set_snapshot("shared:one", deepcopy(original), 100)
        monkeypatch.setitem(store_type.async_add_named_item.__globals__, "_now_ms", lambda: 200)
        await store.async_add_named_item("Apples", share_id="shared:one")
        saved = deepcopy(hass.disk["shares"]["shared:one"])
        assert saved["updatedAt"] == saved["snapshot"]["updatedAt"] == 200
        assert saved["snapshot"]["lists"]
        await store.async_set_snapshot("shared:one", {**original, "updatedAt": 150}, 150)
        assert hass.disk["shares"]["shared:one"] == saved
        assert store.updated_at("shared:one") == 200
        reloaded = store_type(hass)
        await reloaded.async_load()
        assert reloaded.get_snapshot("shared:one") == saved["snapshot"]
    asyncio.run(run())


def test_historical_voice_timestamp_mismatch_rejects_stale_save_and_echoes_real_watermark(store_type):
    async def run():
        snapshot = {"catalogLocale": "en", "lists": {"uk-tesco": {
            "storeId": "uk-tesco", "items": [{"productId": "uk-apples", "qty": 1}], "updatedAt": 200,
        }}, "updatedAt": 200}
        hass = make_hass(snapshot=deepcopy(snapshot))
        hass.disk["shares"]["shared:one"]["updatedAt"] = 100
        store = store_type(hass)
        await store.async_load()
        for timestamp in (150, 100):
            assert await store.async_set_snapshot("shared:one", {"catalogLocale": "en", "lists": {}, "updatedAt": timestamp}, timestamp)
            assert store.get_snapshot("shared:one") == snapshot
            assert hass.disk["shares"]["shared:one"]["snapshot"] == snapshot
            # StateView devuelve este valor: no debe confirmar el POST ignorado.
            assert store.updated_at("shared:one") == 200
            assert store.updated_at("shared:one") != timestamp
        await store.async_set_snapshot("shared:one", {"lists": {}, "updatedAt": 201}, 201)
        assert store.get_snapshot("shared:one")["lists"] == {}
        assert store.updated_at("shared:one") == 201
    asyncio.run(run())


def test_voice_watermark_advances_when_server_clock_is_behind_or_unchanged(store_type, monkeypatch):
    async def run():
        hass = make_hass(snapshot={"catalogLocale": "en", "lists": {}, "updatedAt": 500})
        store = store_type(hass)
        await store.async_load()
        monkeypatch.setitem(store_type.async_add_named_item.__globals__, "_now_ms", lambda: 99)
        for timestamp in (501, 502):
            await store.async_add_named_item("Apples", share_id="shared:one")
            saved = hass.disk["shares"]["shared:one"]
            assert store.updated_at("shared:one") == timestamp
            assert saved["updatedAt"] == saved["snapshot"]["updatedAt"] == timestamp
            assert max(shopping_list["updatedAt"] for shopping_list in saved["snapshot"]["lists"].values()) == timestamp
    asyncio.run(run())
