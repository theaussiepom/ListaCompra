"""La consulta OFF comparte la identidad migrada del catálogo y su caché."""
from test_off_locale import api, lookup, setup


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
