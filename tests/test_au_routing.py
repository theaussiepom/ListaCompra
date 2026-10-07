"""Enrutado AU: nombres reales, filas explícitas y payloads ya estructurados."""
import asyncio
import json
from unittest.mock import patch

import pytest

from test_catalog_locale import make_hass, store_type
from test_routing import ROOT, routing

FIXTURE = json.loads((ROOT / "tests/fixtures/au-acceptance.json").read_text())
CATALOG = json.loads((ROOT / "custom_components/tucompra/catalog.json").read_text())
AU = {**CATALOG["locales"]["au"], "categories": CATALOG["categories"]}
PRODUCTS = {product["id"]: product for product in AU["products"]}
EXECUTIONS = []
for entry in FIXTURE["routingCases"]:
    EXECUTIONS.append(entry)
    if "configuredStoreCase" in entry:
        EXECUTIONS.append({**entry, **entry["configuredStoreCase"]})
    if "suppliedStructuredPayloadCase" in entry:
        supplied = entry["suppliedStructuredPayloadCase"]
        EXECUTIONS.append({**supplied, "request": supplied["payload"]["name"], "matchingMode": "name"})


def test_all_routing_execution_layers_present():
    assert len(FIXTURE["routingCases"]) == 145
    assert len(EXECUTIONS) == 286
    assert sum(case["matchingMode"] == "product-id" for case in EXECUTIONS) == 4
    assert sum("payload" in case for case in EXECUTIONS) == 3


@pytest.mark.parametrize("case", EXECUTIONS, ids=lambda case: f'{case["id"]}: {case["request"]}')
def test_au_routing(case):
    catalog = {**AU, "stores": [store for store in AU["stores"] if store["id"] in case["fixture"]["activeStoreIds"]]}
    snapshot = {"defaultStores": case["fixture"]["defaultStores"]}
    if case["matchingMode"] == "product-id":
        # La API de voz recibe nombres; fijamos la fila ya elegida en su frontera interna.
        selected = PRODUCTS[case["inputProductId"]]
        with patch.object(routing, "select_automatic_match", return_value=selected) as selection:
            result = routing.resolve(case["request"], snapshot, catalog)
        selection.assert_called_once()
        assert result["product"] is selected
    else:
        result = routing.resolve(case["request"], snapshot, catalog)
    product = result["product"]
    assert (product["id"] if product else None) == case["expectedProductId"]
    assert result["store_id"] == case["expectedStoreId"]
    assert result["type_id"] == case["expectedStoreType"]
    assert ("store" if result["store_id"] else "inbox") == case["expectedDisposition"]
    assert ("match-existing-product" if product else "preserve-raw-request") == case["expectedAction"]
    if "expectedPreservedRequest" in case:
        assert product is None
        assert case["request"].strip() == case["expectedPreservedRequest"]


@pytest.mark.parametrize("case", [entry for entry in EXECUTIONS if "payload" in entry], ids=lambda case: case["id"])
def test_supplied_payload_quantity_and_unit_are_persisted(store_type, case):
    async def run():
        hass = make_hass(language="en", country="AU", snapshot={
            "catalogLocale": "au", "defaultStores": case["fixture"]["defaultStores"],
        })
        store = store_type(hass)
        await store.async_load()
        result = await store.async_add_named_item(**case["payload"], share_id="shared:one")
        assert result["matched"] is True
        assert result["product_id"] == case["expectedProductId"]
        assert result["store_id"] == case["expectedStoreId"]
        saved = hass.disk["shares"]["shared:one"]["snapshot"]
        item = saved["lists"][case["expectedStoreId"]]["items"][0]
        assert item["productId"] == case["expectedProductId"]
        assert item["qty"] == case["expectedQuantity"]
        assert item["unit"] == case["expectedUnit"]
        assert saved["catalogLocale"] == "au"
    asyncio.run(run())
