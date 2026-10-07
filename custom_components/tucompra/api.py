"""Vistas HTTP autenticadas de Tu Compra.

Todas exigen `requires_auth = True`, así que HA valida el token del usuario
logueado (el mismo que usa tu proxy/dominio) y rellena `request["hass_user"]`.
La identidad es, por tanto, el usuario de HA — sin login ni passphrase propios.

Endpoints:
  GET    /api/tucompra/me                → identidad + person. del usuario
  GET    /api/tucompra/shares            → shares a los que pertenece
  POST   /api/tucompra/shares            → crear share compartida        (admin)
  PUT    /api/tucompra/shares/{id}       → renombrar / cambiar miembros   (admin)
  DELETE /api/tucompra/shares/{id}       → borrar share                   (admin)
  GET    /api/tucompra/state?share=<id>  → snapshot de un share (miembro)
  POST   /api/tucompra/state?share=<id>  → guardar snapshot     (miembro)
  GET    /api/tucompra/users             → usuarios HA + person.          (admin)
"""
from __future__ import annotations

from typing import Any

import base64
import logging

import async_timeout

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN, LOOKUP_ENABLED
from .store import TuCompraStore
from .routing import resolve_locale

_LOGGER = logging.getLogger(__name__)

# Open Food Facts: base colaborativa y abierta, sin API key. Solo se consulta si
# el usuario activa `product_lookup` en configuration.yaml (apagado por defecto):
# la app es local por defecto y esta es la única petición saliente que existe.
OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{barcode}.json"
OFF_FIELDS = (
    "product_name,product_name_es,product_name_en,product_name_fr,"
    "product_name_de,product_name_pt,brands,quantity,categories_tags,"
    # display ≈400 px (se puede ampliar en pantalla sin verse borrosa);
    # small ≈200 px como respaldo si no existe la anterior.
    "image_front_display_url,image_front_small_url"
)
OFF_LANGUAGES = {"es": "es", "en": "en", "us": "en", "fr": "fr", "de": "de", "br": "pt"}


def _localized_lookup(cached: dict, locale: str) -> dict:
    if cached.get("version") != 2:
        return cached
    names = cached.get("names", {})
    name = names.get(OFF_LANGUAGES[locale]) or names.get("default") or names.get("es") or ""
    return {
        **{k: v for k, v in cached.items() if k not in ("version", "names")},
        "name": name,
        "found": bool(name),
    }

# La foto del producto se descarga DESDE HA y se incrusta como data URL, para
# que el navegador no pida nada a terceros y para que el icono siga funcionando
# sin conexión. Tope de tamaño (la de ~400 px ronda los 30-50 KB).
MAX_IMAGE_BYTES = 150_000


async def _fetch_image_data_url(session, url: str) -> str:
    """Descarga la miniatura del producto y la devuelve como data URL ('' si falla)."""
    if not url:
        return ""
    try:
        async with async_timeout.timeout(10):
            resp = await session.get(url)
            if resp.status != 200:
                return ""
            ctype = (resp.headers.get("Content-Type") or "").split(";")[0].strip()
            if not ctype.startswith("image/"):
                return ""
            raw = await resp.read()
        if not raw or len(raw) > MAX_IMAGE_BYTES:
            return ""
        return f"data:{ctype};base64,{base64.b64encode(raw).decode('ascii')}"
    except Exception:  # noqa: BLE001 — red/timeout: la foto es prescindible
        return ""


def _store(hass: HomeAssistant) -> TuCompraStore:
    return hass.data[DOMAIN]


def _person_for_user(hass: HomeAssistant, user_id: str) -> dict[str, Any] | None:
    """Mapea un usuario de HA a su entidad person.* (para nombre y foto)."""
    for state in hass.states.async_all("person"):
        if state.attributes.get("user_id") == user_id:
            return {
                "entity_id": state.entity_id,
                "name": state.attributes.get("friendly_name", state.name),
                "picture": state.attributes.get("entity_picture"),
            }
    return None


@callback
def async_register_views(hass: HomeAssistant) -> None:
    hass.http.register_view(MeView())
    hass.http.register_view(SharesView())
    hass.http.register_view(ShareDetailView())
    hass.http.register_view(StateView())
    hass.http.register_view(UsersView())
    hass.http.register_view(LookupView())


class LookupView(HomeAssistantView):
    """Traduce un código de barras a producto vía Open Food Facts.

    Solo responde si `product_lookup` está activado. La petición sale desde HA
    (no desde el navegador del usuario) y el resultado se cachea en .storage,
    así que un mismo producto se consulta una única vez.
    """

    url = "/api/tucompra/lookup"
    name = "api:tucompra:lookup"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        if not hass.data.get(LOOKUP_ENABLED):
            return self.json({"enabled": False})

        barcode = (request.query.get("barcode") or "").strip()
        if not barcode.isdigit() or not 6 <= len(barcode) <= 14:
            return self.json_message("Código de barras no válido.", status_code=400)

        store = _store(hass)
        locale = request.query.get("locale")
        share_id = request.query.get("share")
        if share_id:
            if not store.is_member(share_id, request["hass_user"].id):
                return self.json_message("No eres miembro de este share.", status_code=403)
            snapshot = store.get_snapshot(share_id)
            if isinstance(snapshot, dict) and snapshot.get("catalogLocale") in OFF_LANGUAGES:
                locale = snapshot["catalogLocale"]
        if locale not in OFF_LANGUAGES:
            locale = resolve_locale(hass.config.language, hass.config.country)
        cached = store.get_cached_lookup(barcode)
        if cached is not None:
            # La caché antigua guarda un nombre ya traducido: se renueva una vez.
            # Los resultados negativos sin ficha siguen siendo independientes del idioma.
            if (cached.get("version") != 2 and cached != {"found": False}) or str(cached.get("image", "")).startswith("http"):
                cached = None
        if cached is not None:
            return self.json({"enabled": True, "cached": True, **_localized_lookup(cached, locale)})

        session = async_get_clientsession(hass)
        try:
            async with async_timeout.timeout(10):
                resp = await session.get(
                    OFF_URL.format(barcode=barcode),
                    params={"fields": OFF_FIELDS},
                    headers={"User-Agent": "TuCompra/HA (github.com/maestrea76/ListaCompra)"},
                )
                data = await resp.json(content_type=None)
        except Exception as err:  # noqa: BLE001 — red/timeout/JSON inválido
            _LOGGER.warning("Tu Compra: fallo consultando el código %s (%s)", barcode, err)
            return self.json({"enabled": True, "found": False, "error": "network"})

        product = (data or {}).get("product") or {}
        if (data or {}).get("status") != 1 or not product:
            result = {"found": False}
        else:
            result = {
                "version": 2,
                "names": {
                    lang: (product.get(f"product_name_{lang}" if lang != "default" else "product_name") or "").strip()
                    for lang in ("default", "es", "en", "fr", "de", "pt")
                },
                "brand": (product.get("brands") or "").split(",")[0].strip(),
                "quantity": (product.get("quantity") or "").strip(),
                "categories": product.get("categories_tags") or [],
                # data URL: la descarga HA, no el navegador del usuario.
                "image": await _fetch_image_data_url(
                    session,
                    product.get("image_front_display_url")
                    or product.get("image_front_small_url")
                    or "",
                ),
            }

        await store.async_cache_lookup(barcode, result)
        return self.json({"enabled": True, "cached": False, **_localized_lookup(result, locale)})


class MeView(HomeAssistantView):
    url = "/api/tucompra/me"
    name = "api:tucompra:me"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        user = request["hass_user"]
        store = _store(hass)
        await store.async_ensure_personal(user.id)
        return self.json(
            {
                "user_id": user.id,
                "name": user.name,
                "is_admin": user.is_admin,
                "person": _person_for_user(hass, user.id),
            }
        )


class SharesView(HomeAssistantView):
    url = "/api/tucompra/shares"
    name = "api:tucompra:shares"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        user = request["hass_user"]
        store = _store(hass)
        await store.async_ensure_personal(user.id)
        shares = [
            {
                "id": s["id"],
                "name": s["name"],
                "owner": s["owner"],
                "members": s["members"],
                "updatedAt": s.get("updatedAt", 0),
            }
            for s in store.shares_for(user.id)
        ]
        return self.json({"shares": shares})

    async def post(self, request):
        hass = request.app["hass"]
        user = request["hass_user"]
        if not user.is_admin:
            return self.json_message("Solo administradores.", status_code=403)
        body = await request.json()
        store = _store(hass)
        share = await store.async_create_share(
            body.get("name"), user.id, body.get("members", [])
        )
        return self.json(share)


class ShareDetailView(HomeAssistantView):
    url = "/api/tucompra/shares/{share_id}"
    name = "api:tucompra:share_detail"
    requires_auth = True

    async def put(self, request, share_id):
        hass = request.app["hass"]
        user = request["hass_user"]
        if not user.is_admin:
            return self.json_message("Solo administradores.", status_code=403)
        body = await request.json()
        store = _store(hass)
        share = await store.async_update_share(
            share_id, name=body.get("name"), members=body.get("members")
        )
        if not share:
            return self.json_message("No existe.", status_code=404)
        return self.json(share)

    async def delete(self, request, share_id):
        hass = request.app["hass"]
        user = request["hass_user"]
        if not user.is_admin:
            return self.json_message("Solo administradores.", status_code=403)
        store = _store(hass)
        ok = await store.async_delete_share(share_id)
        return self.json({"deleted": ok})


class StateView(HomeAssistantView):
    url = "/api/tucompra/state"
    name = "api:tucompra:state"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        user = request["hass_user"]
        store = _store(hass)
        share_id = request.query.get("share") or store.personal_id(user.id)
        if not store.is_member(share_id, user.id):
            return self.json_message("No eres miembro de este share.", status_code=403)
        return self.json(
            {
                "share": share_id,
                "snapshot": await store.async_get_snapshot(share_id, request.query.get("legacyLocale")),
                "updatedAt": store.updated_at(share_id),
            }
        )

    async def post(self, request):
        hass = request.app["hass"]
        user = request["hass_user"]
        store = _store(hass)
        body = await request.json()
        share_id = request.query.get("share") or store.personal_id(user.id)
        if not store.is_member(share_id, user.id):
            return self.json_message("No eres miembro de este share.", status_code=403)
        await store.async_set_snapshot(
            share_id, body.get("snapshot"), body.get("updatedAt")
        )
        return self.json({"ok": True, "updatedAt": store.updated_at(share_id)})


class UsersView(HomeAssistantView):
    url = "/api/tucompra/users"
    name = "api:tucompra:users"
    requires_auth = True

    async def get(self, request):
        hass = request.app["hass"]
        user = request["hass_user"]
        if not user.is_admin:
            return self.json_message("Solo administradores.", status_code=403)
        users = await hass.auth.async_get_users()
        out = []
        for candidate in users:
            if candidate.system_generated or not candidate.is_active:
                continue
            out.append(
                {
                    "user_id": candidate.id,
                    "name": candidate.name,
                    "is_admin": candidate.is_admin,
                    "person": _person_for_user(hass, candidate.id),
                }
            )
        return self.json({"users": out})
