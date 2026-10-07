"""Casos AU completos contra el catálogo exportado y ambos motores reales."""
import json
import subprocess

import pytest

from test_routing import ROOT, routing

FIXTURE = json.loads((ROOT / "tests/fixtures/au-acceptance.json").read_text())
CATALOG = json.loads((ROOT / "custom_components/tucompra/catalog.json").read_text())
AU = {**CATALOG["locales"]["au"], "categories": CATALOG["categories"]}
CASES = FIXTURE["matchingCases"]


def test_all_authoritative_matching_cases_present():
    assert len(CASES) == 581
    assert len(AU["products"]) == 1518


@pytest.mark.parametrize("case", CASES, ids=lambda case: f'{case["id"]}: {case["request"]}')
def test_au_automatic_matching(case):
    result = routing.resolve(case["request"], {}, AU)
    product = result["product"]
    product_id = product["id"] if product else None
    assert product_id == case["expectedProductId"]
    assert ("match-existing-product" if product else "preserve-raw-request") == case["expectedAction"]
    assert product_id not in case.get("forbiddenProductIds", [])
    if "expectedPreservedRequest" in case:
        assert product is None
        assert case["request"].strip() == case["expectedPreservedRequest"]


def test_all_581_actual_typescript_python_matching_results_agree():
    script = """
      import { readFileSync } from 'node:fs';
      import { LOCALIZED_PRODUCTS } from './src/lib/data/locales/index.ts';
      import { selectAutomaticMatch } from './src/lib/search.ts';
      const { matchingCases } = JSON.parse(readFileSync('tests/fixtures/au-acceptance.json', 'utf8'));
      console.log(JSON.stringify(matchingCases.map(c => ({
        id: c.id, productId: selectAutomaticMatch(LOCALIZED_PRODUCTS.au, c.request)?.id ?? null,
      }))));
    """
    result = subprocess.run(["node", "--import", "tsx", "--input-type=module", "-e", script],
                            cwd=ROOT, check=True, capture_output=True, text=True)
    frontend = json.loads(result.stdout)
    assert len(frontend) == len(CASES) == 581
    for case, selected in zip(CASES, frontend, strict=True):
        product = routing.resolve(case["request"], {}, AU)["product"]
        assert selected == {"id": case["id"], "productId": product["id"] if product else None}, case["id"]
