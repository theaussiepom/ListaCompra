"""Integridad del catálogo AU exportado frente al contrato revisado."""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / 'tests/fixtures/au-acceptance.json').read_text())
CATALOG = json.loads((ROOT / 'custom_components/tucompra/catalog.json').read_text())
AU = CATALOG['locales']['au']


def digest(value, *, sort_keys=False):
    encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=sort_keys)
    return hashlib.sha256(encoded.encode()).hexdigest()


def test_au_export_exact_product_content_and_order():
    assert list(CATALOG['locales']) == ['es', 'en', 'us', 'fr', 'de', 'br', 'au']
    assert len(AU['products']) == 1518
    assert digest(AU['products'], sort_keys=True) == FIXTURE['exportedProductsSha256']
    ids = [p['id'] for p in AU['products']]
    assert len(set(ids)) == 1518
    assert digest(ids) == FIXTURE['integrity']['sourceProductOrderSha256']


def test_au_export_mirrors_have_direct_canonical_targets_and_exact_metadata():
    products = AU['products']
    by_id = {p['id']: p for p in products}
    mirrors = [p for p in products if 'mirrorOf' in p]
    assert len(mirrors) == 233
    assert all('mirrorOf' not in p for p in products[:1285])
    assert all('mirrorOf' in p for p in products[1285:])
    assert [{'productId': p['id'], 'canonicalProductId': p['mirrorOf']} for p in mirrors] == FIXTURE['integrity']['mirrorRelationships']
    for p in mirrors:
        assert p['mirrorOf'] in by_id
        assert p['id'] != p['mirrorOf']
        assert 'mirrorOf' not in by_id[p['mirrorOf']]
        assert 'aliases' not in p


def test_au_export_aliases_exactly_match_the_safe_audit_and_not_deferred_pairs():
    actual = [(term, p['id']) for p in AU['products'] for term in p.get('aliases', [])]
    expected = [(r['term'], r['productId']) for r in FIXTURE['aliases']['runtimeSafe']]
    deferred = {(r['term'], r['productId']) for r in FIXTURE['aliases']['deferred']}
    assert len(actual) == 450
    assert sum(bool(p.get('aliases')) for p in AU['products']) == 254
    assert Counter(actual) == Counter(expected)
    assert len(deferred) == 213
    assert not set(actual) & deferred
    assert all('mirrorOf' not in p for p in AU['products'] if p.get('aliases'))


def test_au_export_products_have_native_fields_categories_and_units():
    fields = set(FIXTURE['integrity']['supportedProductFields']) - {'icon'}
    categories = {c['id'] for c in CATALOG['categories']}
    units = set(FIXTURE['integrity']['supportedUnits'])
    for p in AU['products']:
        assert set(p) <= fields, p['id']
        assert p['categoryId'] in categories, p['id']
        assert p['defaultUnit'] in units, p['id']
        assert 'barcode' not in p, p['id']


def test_au_export_has_nine_active_stores_and_no_deferred_seed():
    expected = [{k: v for k, v in s.items() if k in {'id', 'name', 'typeId', 'order'}} for s in FIXTURE['stores']['active']]
    assert AU['stores'] == expected
    assert len(AU['stores']) == 9
    emitted = {s['id'] for s in AU['stores']}
    assert not emitted & set(FIXTURE['stores']['deferredIds'])
    assert 'au-kmart' not in emitted
    assert 'au-ikea' not in emitted
    assert all(s.get('enabled', True) for s in AU['stores'])


@pytest.mark.parametrize('locale', ['es', 'en', 'us', 'fr', 'de', 'br'])
def test_au_preserves_existing_locale_export_bytes(locale):
    assert digest(CATALOG['locales'][locale]) == FIXTURE['existingLocaleBlockSha256'][locale]
