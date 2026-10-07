"""Las referencias a mirrors conservan únicamente su dependencia canónica directa."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import sys
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[1]
package = ModuleType("mirror_catalog_tests")
package.__path__ = [str(ROOT / "custom_components/tucompra")]
sys.modules[package.__name__] = package
spec = importlib.util.spec_from_file_location(f"{package.__name__}.catalog_locale", ROOT / "custom_components/tucompra/catalog_locale.py")
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def fixture():
    canonical = {"id": "market-product", "name": "Canonical concept", "categoryId": "market-category", "storeId": "private-market"}
    mirror = {"id": "specialist-product", "name": "Specialist concept", "categoryId": "specialist-category", "mirrorOf": canonical["id"]}
    catalog = {"categories": [{"id": "market-category", "typeId": "market"}, {"id": "specialist-category", "typeId": "specialist"}], "locales": {
        "en": {"products": [canonical, mirror], "stores": [{"id": "private-market", "typeId": "market"}]},
        "fr": {"products": [], "stores": []}}}
    snapshot = {"catalogLocale": "fr", "lists": {"inbox": {"storeId": "inbox", "items": [{"productId": mirror["id"]}]}}, "customProducts": [], "retainedProducts": [mirror]}
    return catalog, snapshot, canonical, mirror


@pytest.mark.parametrize("serialized", [False, True])
def test_referenced_foreign_mirror_keeps_direct_canonical_and_store(serialized):
    catalog, snapshot, canonical, mirror = fixture()
    if not serialized:
        snapshot.pop("retainedProducts")
    before = deepcopy(snapshot)
    flat = migration.catalog_for_snapshot(catalog, snapshot)
    assert {p["id"] for p in flat["products"]} == {canonical["id"], mirror["id"]}
    assert {s["id"] for s in flat["stores"]} == {canonical["storeId"]}
    assert snapshot == before


def test_custom_mirror_keeps_foreign_canonical_without_list_reference():
    catalog, snapshot, canonical, mirror = fixture()
    snapshot["lists"] = {}
    snapshot["retainedProducts"] = []
    snapshot["customProducts"] = [{**mirror, "id": "custom-mirror"}]
    flat = migration.catalog_for_snapshot(catalog, snapshot)
    assert canonical["id"] in {p["id"] for p in flat["products"]}
    assert canonical["storeId"] in {s["id"] for s in flat["stores"]}


@pytest.mark.parametrize("kind", ["chain", "cycle", "self", "missing"])
def test_invalid_mirror_does_not_retain_its_target(kind):
    catalog, snapshot, canonical, mirror = fixture()
    if kind == "chain":
        canonical["mirrorOf"] = "terminal"
        catalog["locales"]["en"]["products"].append({"id": "terminal", "name": "Terminal", "categoryId": "market-category"})
    elif kind == "cycle":
        canonical["mirrorOf"] = mirror["id"]
    elif kind == "self":
        mirror["mirrorOf"] = mirror["id"]
    else:
        mirror["mirrorOf"] = "missing"
    flat = migration.catalog_for_snapshot(catalog, snapshot)
    assert {p["id"] for p in flat["products"]} == {mirror["id"]}
    assert not flat["stores"]


def test_explicit_unlisted_retained_mirror_keeps_its_direct_canonical():
    catalog, snapshot, canonical, mirror = fixture()
    snapshot["lists"] = {}
    flat = migration.catalog_for_snapshot(catalog, snapshot)
    assert {p["id"] for p in flat["products"]} == {canonical["id"], mirror["id"]}
    assert {s["id"] for s in flat["stores"]} == {canonical["storeId"]}
