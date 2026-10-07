"""Localización de OFF y caché compartida sin depender de Home Assistant."""
import asyncio
import importlib.util
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BARCODE = "3017620422003"
PRODUCT = {
    "product_name": "Original", "product_name_en": "Milk", "product_name_es": "Leche",
    "product_name_fr": "Lait", "product_name_de": "Milch", "product_name_pt": "Leite",
    "brands": "Example,Second", "quantity": "1 l", "categories_tags": ["en:milk"],
    "image_front_display_url": "https://images.openfoodfacts.org/front.jpg",
}


@pytest.fixture
def api(monkeypatch):
    package = types.ModuleType("off_locale_integration")
    package.__path__ = [str(ROOT / "custom_components" / "tucompra")]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    for name in ("homeassistant", "homeassistant.components", "homeassistant.helpers"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    core = types.ModuleType("homeassistant.core")
    core.HomeAssistant = object
    core.callback = lambda fn: fn
    http = types.ModuleType("homeassistant.components.http")

    class View:
        def json(self, data):
            return data

        def json_message(self, message, status_code):
            return {"message": message, "status_code": status_code}

    http.HomeAssistantView = View
    storage = types.ModuleType("homeassistant.helpers.storage")

    class Storage:
        def __init__(self, *args):
            pass

        async def async_save(self, data):
            pass

    storage.Store = Storage
    client = types.ModuleType("homeassistant.helpers.aiohttp_client")
    client.async_get_clientsession = lambda hass: hass.session
    for name, module in {"homeassistant.core": core, "homeassistant.components.http": http,
                         "homeassistant.helpers.storage": storage,
                         "homeassistant.helpers.aiohttp_client": client,
                         "async_timeout": types.SimpleNamespace(timeout=asyncio.timeout)}.items():
        monkeypatch.setitem(sys.modules, name, module)
    spec = importlib.util.spec_from_file_location(
        f"{package.__name__}.api", ROOT / "custom_components" / "tucompra" / "api.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Session:
    def __init__(self, product=None, status=1, error=False):
        self.product = PRODUCT if product is None else product
        self.product_status = status
        self.error = error
        self.calls = []
        self.status = 200
        self.headers = {"Content-Type": "image/jpeg"}

    async def get(self, url, **kwargs):
        if self.error:
            raise OSError("offline")
        self.calls.append((url, kwargs))
        return self

    async def json(self, **kwargs):
        return {"status": self.product_status, "product": self.product}

    async def read(self):
        return b"image-bytes"


def setup(api, session=None):
    hass = types.SimpleNamespace(data={}, session=session or Session(),
                                 config=types.SimpleNamespace(language="en", country="GB"))
    store = api.TuCompraStore(hass)
    hass.data[api.DOMAIN] = store
    hass.data[api.LOOKUP_ENABLED] = True
    return hass, store


def lookup(api, hass, locale=None, share=None):
    request = type("Request", (dict,), {})(hass_user=types.SimpleNamespace(id="user"))
    request.app = {"hass": hass}
    request.query = {"barcode": BARCODE}
    if locale:
        request.query["locale"] = locale
    if share:
        request.query["share"] = share
    return asyncio.run(api.LookupView().get(request))


@pytest.mark.parametrize("locale,name", [("en", "Milk"), ("us", "Milk"), ("es", "Leche"),
                                       ("fr", "Lait"), ("de", "Milch"), ("br", "Leite")])
def test_locale_specific_name(api, locale, name):
    hass, _ = setup(api)
    result = lookup(api, hass, locale)
    assert result["name"] == name
    assert result["brand"] == "Example"
    assert result["quantity"] == "1 l"
    assert result["categories"] == ["en:milk"]
    assert result["image"] == "data:image/jpeg;base64,aW1hZ2UtYnl0ZXM="


@pytest.mark.parametrize("product,name", [({"product_name": "Original", "product_name_es": "Leche"}, "Original"),
                                         ({"product_name": "Only generic"}, "Only generic"),
                                         ({"product_name_en": "  ", "product_name": "Generic"}, "Generic"),
                                         ({"product_name_es": "Solo español"}, "Solo español")])
def test_fallback_name(api, product, name):
    hass, _ = setup(api, Session(product))
    assert lookup(api, hass, "en")["name"] == name


def test_same_barcode_cache_is_localized_on_every_response(api):
    hass, store = setup(api)
    assert lookup(api, hass, "en")["name"] == "Milk"
    for locale, name in [("es", "Leche"), ("fr", "Lait"), ("en", "Milk")]:
        result = lookup(api, hass, locale)
        assert result["name"] == name
        assert result["cached"] is True
        assert "names" not in result and "version" not in result
    assert len(hass.session.calls) == 2  # Una ficha y una imagen.
    assert set(store.lookup_cache) == {BARCODE}
    fields = hass.session.calls[0][1]["params"]["fields"].split(",")
    assert all(f"product_name_{lang}" in fields for lang in ("en", "es", "fr", "de", "pt"))


def test_legacy_selected_name_cache_is_refreshed_without_changing_products(api):
    hass, store = setup(api)
    store.lookup_cache[BARCODE] = {"found": True, "name": "Leche", "image": "data:image/jpeg;base64,old"}
    store.shares["personal:user"] = {"members": ["user"], "snapshot": {"customProducts": [{"id": "custom-1", "barcode": BARCODE}]}}
    before = store.get_snapshot("personal:user")["customProducts"].copy()
    assert lookup(api, hass, "en")["name"] == "Milk"
    assert store.get_snapshot("personal:user")["customProducts"] == before


def test_negative_cache_and_network_failures_keep_manual_entry_path(api):
    hass, store = setup(api, Session({}, status=0))
    assert lookup(api, hass, "en")["found"] is False
    assert lookup(api, hass, "fr")["cached"] is True
    assert len(hass.session.calls) == 1
    store.lookup_cache.clear()
    hass.session.error = True
    assert lookup(api, hass, "en") == {"enabled": True, "found": False, "error": "network"}
    assert store.lookup_cache == {}


def test_legacy_negative_cache_is_kept(api):
    hass, store = setup(api)
    store.lookup_cache[BARCODE] = {"found": False}
    assert lookup(api, hass, "de")["cached"] is True
    assert hass.session.calls == []


def test_missing_names_and_failed_photo_remain_editable(api):
    hass, _ = setup(api, Session({"brands": "Example"}))
    result = lookup(api, hass, "fr")
    assert result["found"] is False and result["name"] == ""
    assert result["image"] == ""
    hass, _ = setup(api)
    hass.session.headers = {"Content-Type": "text/html"}
    result = lookup(api, hass, "fr")
    assert result["name"] == "Lait" and result["image"] == ""


def test_old_remote_image_cache_is_refetched(api):
    hass, store = setup(api)
    store.lookup_cache[BARCODE] = {"version": 2, "names": {"en": "Old"}, "image": "https://old.example/image.jpg"}
    assert lookup(api, hass, "en")["image"].startswith("data:image/")


def test_server_locale_fallback_and_lookup_disabled(api):
    hass, _ = setup(api)
    hass.config.language = "de"
    assert lookup(api, hass, "invalid")["name"] == "Milch"
    hass.data[api.LOOKUP_ENABLED] = False
    assert lookup(api, hass, "en") == {"enabled": False}


def test_shared_catalog_locale_takes_precedence_and_membership_is_checked(api):
    hass, store = setup(api)
    store.shares["shared:test"] = {"members": ["user"], "snapshot": {"catalogLocale": "fr"}}
    assert lookup(api, hass, "en", "shared:test")["name"] == "Lait"
    assert lookup(api, hass, "en", "shared:forbidden")["status_code"] == 403
