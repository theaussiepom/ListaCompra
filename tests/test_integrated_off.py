"""La consulta OFF comparte la identidad migrada del catálogo y su caché."""
from test_off_locale import BARCODE, api, lookup, setup


def test_off_migrates_legacy_share_before_selecting_cached_language(api):
    hass, store = setup(api)
    hass.config.language, hass.config.country = "de", "DE"
    store.shares["shared:legacy"] = {
        "members": ["user"],
        "snapshot": {"lists": {"uk-tesco": {
            "storeId": "uk-tesco", "items": [{"productId": "uk-apples"}], "updatedAt": 1,
        }}},
    }
    store.shares["shared:french"] = {
        "members": ["user"], "snapshot": {"catalogLocale": "fr"},
    }
    assert lookup(api, hass, "de", "shared:legacy")["name"] == "Milk"
    assert store.get_snapshot("shared:legacy")["catalogLocale"] == "en"
    assert lookup(api, hass, "en", "shared:french")["name"] == "Lait"
    assert lookup(api, hass, "fr", "shared:legacy")["name"] == "Milk"
    assert len(hass.session.calls) == 2


def test_shared_au_catalogue_prefers_english_from_the_same_neutral_cache(api):
    hass, store = setup(api)
    hass.config.language, hass.config.country = "de", "DE"
    store.shares["shared:au"] = {"members": ["user"], "snapshot": {"catalogLocale": "au"}}
    store.shares["shared:french"] = {"members": ["user"], "snapshot": {"catalogLocale": "fr"}}
    assert lookup(api, hass, "de", "shared:au")["name"] == "Milk"
    french = lookup(api, hass, "au", "shared:french")
    assert french["name"] == "Lait" and french["cached"]
    australian = lookup(api, hass, "fr", "shared:au")
    assert australian["name"] == "Milk" and australian["cached"]
    assert len(hass.session.calls) == 2
    assert set(store.lookup_cache) == {BARCODE}


def test_au_host_off_lookup_pins_new_share_but_preserves_populated_uk_share(api):
    hass, store = setup(api)
    hass.config.language, hass.config.country = "en", "AU"
    lists = {"uk-tesco": {"storeId": "uk-tesco", "items": [{"productId": "uk-apples"}], "updatedAt": 1}}
    store.shares["shared:new"] = {"members": ["user"], "snapshot": None}
    store.shares["shared:uk"] = {"members": ["user"], "snapshot": {"lists": lists}}
    assert lookup(api, hass, share="shared:new")["name"] == "Milk"
    assert store.get_snapshot("shared:new")["catalogLocale"] == "au"
    assert lookup(api, hass, share="shared:uk")["name"] == "Milk"
    assert store.get_snapshot("shared:uk")["catalogLocale"] == "en"
    assert store.get_snapshot("shared:uk")["lists"] == lists
