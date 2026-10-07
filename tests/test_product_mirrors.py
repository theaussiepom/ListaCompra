"""Identidad conceptual compartida con las pruebas del frontend."""
import json
import subprocess

import pytest

from test_routing import ROOT, routing

CASES = json.loads((ROOT / "tests/fixtures/product-mirrors.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_mirror_resolution(case):
    for products in (case["products"], list(reversed(case["products"]))):
        catalog = {"products": products, "categories": [], "stores": []}
        result = routing.resolve(case["query"], {}, catalog)
        assert (result["product"] or {}).get("id") == case["automatic"]
        if case.get("ranked"):
            assert [p["id"] for p in routing.match_candidates(case["query"], products)] == case["ranked"]


def test_actual_typescript_and_python_mirror_parity():
    script = """
      import { readFileSync } from 'node:fs';
      import { rankScoredMatches, selectAutomaticMatch } from './src/lib/search.ts';
      const cases = JSON.parse(readFileSync('tests/fixtures/product-mirrors.json', 'utf8'));
      console.log(JSON.stringify(cases.map(c => ({
        automatic: selectAutomaticMatch(c.products, c.query)?.id ?? null,
        ranked: rankScoredMatches(c.products, c.query).map(m => [m.score, m.source, m.it.id]),
      }))));
    """
    result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", script],
                            cwd=ROOT, check=True, capture_output=True, text=True)
    for case, frontend in zip(CASES, json.loads(result.stdout), strict=True):
        details = routing.match_details(case["query"], case["products"])
        resolved = routing.resolve(case["query"], {}, {"products": case["products"]})
        assert frontend == {
            "automatic": (resolved["product"] or {}).get("id"),
            "ranked": [[m["score"], m["source"], m["product"]["id"]] for m in details],
        }, case["name"]


def test_nonmatching_canonical_requires_complete_pool_for_direct_helper():
    canonical = {"id": "canonical", "name": "Beef mince"}
    mirror = {"id": "mirror", "name": "Ground meat", "mirrorOf": "canonical"}
    products = [canonical, mirror]
    details = routing.match_details("ground meat", products)
    assert routing.select_automatic_match("ground meat", details) is None
    assert routing.select_automatic_match("ground meat", details, products) is canonical


def test_exported_mirror_routes_canonical_without_preferring_specialist():
    script = """
      import { exportProducts } from './scripts/catalog-product.ts';
      console.log(JSON.stringify(exportProducts([
        { id: 'canonical', name: 'Beef mince', categoryId: 'market-meat', defaultUnit: 'kg' },
        { id: 'mirror', name: 'Beef mince', categoryId: 'butcher-beef', mirrorOf: 'canonical', storeId: 'butcher', defaultUnit: 'g' },
      ])));
    """
    result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", script],
                            cwd=ROOT, check=True, capture_output=True, text=True)
    products = json.loads(result.stdout)
    assert products[1]["mirrorOf"] == "canonical"
    catalog = {"products": products, "categories": [
        {"id": "market-meat", "typeId": "market"}, {"id": "butcher-beef", "typeId": "butcher"},
    ], "stores": [{"id": f"market-{i}", "typeId": "market"} for i in range(4)] + [{"id": "butcher", "typeId": "butcher"}]}
    ambiguous_destination = routing.resolve("Beef mince", {}, catalog)
    assert ambiguous_destination["product"]["id"] == "canonical"
    assert ambiguous_destination["type_id"] == "market"
    assert ambiguous_destination["store_id"] is None
    assert routing.resolve("Beef mince", {"defaultStores": {"market": "market-2"}}, catalog)["store_id"] == "market-2"
