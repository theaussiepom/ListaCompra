"""Regresiones de los contratos compartidos entre las ramas genéricas."""
import asyncio

from test_catalog_locale import make_hass, store_type


def test_pinned_catalogue_alias_keeps_unavailable_exclusive_in_inbox(store_type):
    async def run():
        product = {
            "id": "custom-exclusive", "name": "My milk", "categoryId": "sup-lacteos",
            "storeId": "uk-tesco", "aliases": ["Usual milk"], "defaultUnit": "unidad",
        }
        snapshot = {
            "catalogLocale": "en", "lists": {}, "customProducts": [product],
            "customStores": [{"id": "uk-tesco", "typeId": "supermercado", "enabled": False}],
            "defaultStores": {"supermercado": "uk-asda"}, "updatedAt": 0,
        }
        hass = make_hass("de", "DE", snapshot)
        store = store_type(hass)
        await store.async_load()
        result = await store.async_add_named_item("Usual milk", quantity=2.5, unit="l", share_id="shared:one")
        assert result["matched"] is True
        assert result["classified"] is False
        assert result["product_id"] == product["id"]
        assert result["store_id"] == "inbox"
        saved = hass.disk["shares"]["shared:one"]["snapshot"]
        assert saved["catalogLocale"] == "en"
        assert saved["customProducts"] == [product]
        assert "uk-asda" not in saved["lists"]
        item = saved["lists"]["inbox"]["items"][0]
        assert item["productId"] == product["id"]
        assert item["qty"] == 2.5
        assert item["unit"] == "l"
    asyncio.run(run())


def test_weak_phrase_preserves_raw_name_in_valid_fallback_category(store_type):
    async def run():
        candidate = {"id": "custom-cabbage", "name": "A bright cabbage", "categoryId": "sup-fruteria"}
        hass = make_hass(snapshot={"catalogLocale": "en", "customProducts": [candidate],
                                   "defaultStores": {"supermercado": "uk-asda"}})
        store = store_type(hass)
        await store.async_load()
        result = await store.async_add_named_item("  aBc  ", quantity=3, unit="kg", share_id="shared:one")
        assert result["matched"] is False
        assert result["product_name"] == "aBc"
        assert result["store_id"] == "inbox"
        saved = hass.disk["shares"]["shared:one"]["snapshot"]
        product = next(p for p in saved["customProducts"] if p["id"] == result["product_id"])
        assert product["name"] == "aBc"
        assert product["categoryId"] == "otr-otros"
        assert any(c["id"] == product["categoryId"] for c in store.catalog["categories"])
        assert candidate in saved["customProducts"]
        item = saved["lists"]["inbox"]["items"][0]
        assert item["productId"] == product["id"]
        assert item["qty"] == 3
        assert item["unit"] == "kg"
    asyncio.run(run())


def test_legacy_uk_references_pin_before_voice_on_german_server(store_type):
    async def run():
        existing = {"id": "existing", "productId": "uk-milk", "qty": 1, "unit": "l", "done": False, "addedAt": 1}
        snapshot = {
            "lists": {"uk-tesco": {"storeId": "uk-tesco", "items": [existing], "updatedAt": 10}},
            "defaultStores": {"supermercado": "uk-tesco"}, "updatedAt": 10,
        }
        hass = make_hass("de", "DE", snapshot)
        store = store_type(hass)
        await store.async_load()
        result = await store.async_add_named_item("Apples", share_id="shared:one")
        assert result["matched"] is True
        assert result["product_id"] == "uk-apples"
        assert result["store_id"] == "uk-tesco"
        saved = hass.disk["shares"]["shared:one"]["snapshot"]
        assert saved["catalogLocale"] == "en"
        assert saved["lists"]["uk-tesco"]["items"][0] == existing
        assert saved["lists"]["uk-tesco"]["items"][1]["productId"] == "uk-apples"
    asyncio.run(run())
