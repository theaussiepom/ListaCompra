"""AU respeta el catálogo compartido y conserva su pin en el storage real aislado."""
import asyncio
from copy import deepcopy
import json
import subprocess

import pytest

from test_catalog_locale import CATALOG, ROOT, make_hass, store_type
from test_routing import routing

FIXTURE = json.loads((ROOT / "tests/fixtures/au-acceptance.json").read_text())
BACKEND_CASES = [case for case in FIXTURE["localeCases"] if case["testLayer"] != "browser-locale-selection"]


def initial_snapshot(case):
    value = case["input"]
    if case["testLayer"] == "populated-share-catalogue-identity":
        return deepcopy(value["existingReferences"])
    if case["testLayer"] == "explicit-share-catalogue-authority":
        snapshot = {"catalogLocale": value["catalogLocale"], "lists": {}, "customProducts": [], "customStores": [], "updatedAt": 1}
        if value["shareState"] == "populated":
            seed = CATALOG["locales"][value["catalogLocale"]]
            product, store = seed["products"][0], seed["stores"][0]
            snapshot["lists"][store["id"]] = {"storeId": store["id"], "items": [{"id": case["id"], "productId": product["id"],
                "qty": 1, "unit": product["defaultUnit"], "done": False, "addedAt": 1}], "updatedAt": 1}
        return snapshot
    return None


@pytest.mark.parametrize("case", BACKEND_CASES, ids=lambda case: case["id"])
def test_au_locale_at_persisted_share_layer(case, store_type):
    async def run():
        before = deepcopy(case)
        source = initial_snapshot(case)
        lists = deepcopy((source or {}).get("lists", {}))
        value = case["input"]
        hass = make_hass(value.get("language"), value.get("country"), source)
        store = store_type(hass)
        await store.async_load()
        pinned = await store.async_get_snapshot("shared:one")
        assert pinned["catalogLocale"] == case["expectedCatalogLocale"]
        assert pinned["lists"] == lists
        assert hass.disk["shares"]["shared:one"]["snapshot"]["catalogLocale"] == case["expectedCatalogLocale"]
        hass.config.language, hass.config.country = "en", "AU"
        reloaded = store_type(hass)
        await reloaded.async_load()
        restored = await reloaded.async_get_snapshot("shared:one")
        assert restored == pinned
        assert reloaded.is_member("shared:one", "u2")
        conflicting = {**deepcopy(restored), "catalogLocale": "de" if restored["catalogLocale"] != "de" else "au", "updatedAt": 10}
        await reloaded.async_set_snapshot("shared:one", conflicting, 10)
        assert reloaded.get_snapshot("shared:one")["catalogLocale"] == case["expectedCatalogLocale"]
        assert reloaded.get_snapshot("shared:one")["lists"] == lists
        assert case == before
    asyncio.run(run())


def test_au_direct_resolver_parity_with_frontend():
    cases = [case for case in FIXTURE["localeCases"] if case["testLayer"] == "new-empty-share-locale-selection"]
    script = """
      import { resolveLocale } from './src/lib/i18n/locale.ts';
      import { readFileSync } from 'node:fs';
      const cases = JSON.parse(readFileSync('tests/fixtures/au-acceptance.json', 'utf8')).localeCases;
      console.log(JSON.stringify(cases.filter(c => c.testLayer === 'new-empty-share-locale-selection')
        .map(c => resolveLocale(c.input.language, c.input.country))));
    """
    result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", script], cwd=ROOT, check=True, capture_output=True, text=True)
    frontend = json.loads(result.stdout)
    for case, actual in zip(cases, frontend, strict=True):
        assert actual == routing.resolve_locale(case["input"].get("language"), case["input"].get("country")) == case["expectedCatalogLocale"]


@pytest.mark.parametrize("catalog_locale", ["es", "en", "us", "fr", "de", "br", "au"])
def test_existing_explicit_pins_do_not_convert_on_au_host(catalog_locale, store_type):
    async def run():
        hass = make_hass("en", "AU", {"catalogLocale": catalog_locale, "lists": {}, "updatedAt": 1})
        store = store_type(hass)
        await store.async_load()
        assert (await store.async_get_snapshot("shared:one"))["catalogLocale"] == catalog_locale
    asyncio.run(run())
