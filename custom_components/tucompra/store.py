"""Capa de almacenamiento de Tu Compra.

Los datos viven en `.storage/tucompra` (helper Store de HA → JSON en disco,
sobrevive reinicios y entra en los backups de HA). Sin dependencias externas.

Modelo: un diccionario de "shares" (espacios de lista). Cada share contiene el
snapshot completo de la app (listas, productos y tiendas personalizados) y la
lista de usuarios de HA que son miembros. La compartición es a nivel de cuenta
entera: entrar en un share da acceso a todo su contenido.
"""
from __future__ import annotations

import time
import uuid
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import STORAGE_KEY, STORAGE_VERSION
from .routing import INBOX_STORE_ID, load_catalog, resolve, resolve_locale
from .catalog_locale import catalog_for_snapshot, pin_catalog_locale, snapshot_for_routing


def _now_ms() -> int:
    return int(time.time() * 1000)


def _ensure_inbox_store(snapshot: dict) -> None:
    """Añade la tienda 'Por clasificar' al snapshot si aún no existe."""
    stores = snapshot.setdefault("customStores", [])
    if not any(s.get("id") == INBOX_STORE_ID for s in stores):
        stores.append(
            {
                "id": INBOX_STORE_ID,
                "name": "📥 Por clasificar",
                "typeId": "otros",
                "icon": {"kind": "emoji", "value": "📥"},
                "edited": True,
            }
        )


class TuCompraStore:
    """Envuelve el helper Store de HA con la lógica de shares y membresías."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, Any] = {"shares": {}}
        # Catálogo de los 6 idiomas; cada share conserva su identidad.
        self.catalog = load_catalog(Path(__file__).parent / "catalog.json")

    async def async_load(self) -> dict[str, Any]:
        data = await self._store.async_load()
        if isinstance(data, dict):
            self._data = data
        self._data.setdefault("shares", {})
        self._data.setdefault("lookup_cache", {})
        return self._data

    # ── Caché de búsquedas por código de barras ─────────────────────────
    # Evita repetir peticiones a Open Food Facts para el mismo producto.
    @property
    def lookup_cache(self) -> dict[str, Any]:
        return self._data.setdefault("lookup_cache", {})

    def get_cached_lookup(self, barcode: str) -> dict[str, Any] | None:
        return self.lookup_cache.get(barcode)

    async def async_cache_lookup(self, barcode: str, result: dict[str, Any]) -> None:
        self.lookup_cache[barcode] = result
        await self._async_save()

    async def _async_save(self) -> None:
        await self._store.async_save(self._data)

    # ── Shares ──────────────────────────────────────────────────────────
    @property
    def shares(self) -> dict[str, Any]:
        return self._data.setdefault("shares", {})

    @staticmethod
    def personal_id(user_id: str) -> str:
        return f"personal:{user_id}"

    async def async_ensure_personal(self, user_id: str) -> dict[str, Any]:
        """Crea (si no existe) el share personal del usuario."""
        sid = self.personal_id(user_id)
        if sid not in self.shares:
            self.shares[sid] = {
                "id": sid,
                "name": "Personal",
                "owner": user_id,
                "members": [user_id],
                "snapshot": None,
                "updatedAt": 0,
            }
            await self._async_save()
        return self.shares[sid]

    def shares_for(self, user_id: str) -> list[dict[str, Any]]:
        return [s for s in self.shares.values() if user_id in s.get("members", [])]

    def is_member(self, share_id: str, user_id: str) -> bool:
        share = self.shares.get(share_id)
        return bool(share and user_id in share.get("members", []))

    # ── Snapshot ────────────────────────────────────────────────────────
    def get_snapshot(self, share_id: str) -> Any:
        share = self.shares.get(share_id)
        return share.get("snapshot") if share else None

    async def async_get_snapshot(self, share_id: str, legacy_locale: str | None = None) -> Any:
        share = self.shares.get(share_id)
        if not share:
            return None
        cfg = self._hass.config
        snapshot = pin_catalog_locale(
            share.get("snapshot"), self.catalog, resolve_locale(cfg.language, cfg.country), legacy_locale,
        )
        if snapshot != share.get("snapshot"):
            share["snapshot"] = snapshot
            await self._async_save()
        return snapshot

    def updated_at(self, share_id: str) -> int:
        share = self.shares.get(share_id)
        if not share:
            return 0
        snapshot = share.get("snapshot") or {}
        # Las versiones antiguas de voz solo actualizaban el timestamp interno.
        return max(share.get("updatedAt", 0), snapshot.get("updatedAt", 0))

    async def async_set_snapshot(
        self, share_id: str, snapshot: Any, updated_at: int | None
    ) -> bool:
        """Guarda el snapshot. Last-write-wins por `updatedAt`: si el remoto es
        más nuevo que el que llega, no lo pisamos (el cliente reconcilia)."""
        share = self.shares.get(share_id)
        if not share:
            return False
        if updated_at is not None and updated_at < self.updated_at(share_id):
            return True
        cfg = self._hass.config
        previous = share.get("snapshot")
        if previous:
            pinned = pin_catalog_locale(previous, self.catalog, resolve_locale(cfg.language, cfg.country))
            snapshot = {**(snapshot or {}), "catalogLocale": pinned["catalogLocale"]}
            if "customCategories" not in snapshot:
                seed_ids = {s["id"] for data in self.catalog.get("locales", {}).values() for s in data.get("stores", [])}
                incoming = {s["id"]: s for s in snapshot.get("customStores", [])}
                for old in previous.get("customStores", []):
                    if old["id"] in seed_ids:
                        incoming[old["id"]] = {**old, **incoming.get(old["id"], {})}
                snapshot["customStores"] = list(incoming.values())
            for key in ("usage", "productIcons", "retainedProducts", "customCategories"):
                if key not in snapshot and key in previous:
                    snapshot[key] = previous[key]
        share["snapshot"] = pin_catalog_locale(snapshot, self.catalog, resolve_locale(cfg.language, cfg.country))
        share["updatedAt"] = updated_at or _now_ms()
        await self._async_save()
        return True

    # ── Gestión de shares compartidas (solo admin en la capa API) ───────
    async def async_create_share(
        self, name: str | None, owner: str, members: list[str]
    ) -> dict[str, Any]:
        sid = f"shared:{uuid.uuid4().hex[:12]}"
        member_ids = list(dict.fromkeys([owner, *members]))  # dedup, owner incluido
        self.shares[sid] = {
            "id": sid,
            "name": name or "Compartida",
            "owner": owner,
            "members": member_ids,
            "snapshot": None,
            "updatedAt": 0,
        }
        await self._async_save()
        return self.shares[sid]

    async def async_update_share(
        self,
        share_id: str,
        name: str | None = None,
        members: list[str] | None = None,
    ) -> dict[str, Any] | None:
        share = self.shares.get(share_id)
        if not share:
            return None
        if name is not None:
            share["name"] = name
        if members is not None:
            # El owner siempre permanece como miembro.
            share["members"] = list(dict.fromkeys([share["owner"], *members]))
        await self._async_save()
        return share

    async def async_delete_share(self, share_id: str) -> bool:
        if share_id.startswith("personal:"):
            return False  # los personales no se borran
        if share_id in self.shares:
            del self.shares[share_id]
            await self._async_save()
            return True
        return False

    # ── Alta de producto por nombre (servicio add_item / voz) ───────────
    def _pick_target_share(self, share_id: str | None) -> dict[str, Any] | None:
        """Share destino: el indicado; si no, la compartida (hogar); si no, la
        primera personal. Coincide con el 'compartida por defecto' del frontend."""
        shares = self.shares
        if share_id and share_id in shares:
            return shares[share_id]
        shared = [s for sid, s in shares.items() if sid.startswith("shared:")]
        if shared:
            return shared[0]
        personal = [s for sid, s in shares.items() if sid.startswith("personal:")]
        return personal[0] if personal else None

    async def async_add_named_item(
        self,
        name: str,
        quantity: float = 1,
        unit: str | None = None,
        share_id: str | None = None,
    ) -> dict[str, Any]:
        """Añade un producto por nombre: fuzzy match → tipo → tienda por defecto,
        o bandeja 'Por clasificar' si no se puede resolver."""
        share = self._pick_target_share(share_id)
        if not share:
            return {"ok": False, "error": "No hay ninguna lista disponible todavía."}

        snap = await self.async_get_snapshot(share["id"])
        res = resolve(name, snapshot_for_routing(snap, self.catalog), catalog_for_snapshot(self.catalog, snap))
        now = max(_now_ms(), self.updated_at(share["id"]) + 1)

        product = res["product"]
        store_id = res["store_id"]
        if store_id is None:
            store_id = INBOX_STORE_ID
            _ensure_inbox_store(snap)

        if product:
            product_id = product["id"]
            item_unit = unit or product.get("defaultUnit") or "unidad"
        else:
            # Producto no reconocido → producto libre en la bandeja.
            product_id = f"custom-voice-{uuid.uuid4().hex[:8]}"
            snap.setdefault("customProducts", []).append(
                {
                    "id": product_id,
                    "name": name.strip(),
                    "categoryId": "otr-otros",
                    "icon": {"kind": "emoji", "value": "🏷️"},
                    "defaultUnit": unit or "unidad",
                }
            )
            item_unit = unit or "unidad"

        lists = snap.setdefault("lists", {})
        lst = lists.setdefault(store_id, {"storeId": store_id, "items": [], "updatedAt": 0})
        lst["items"].append(
            {
                "id": uuid.uuid4().hex,
                "productId": product_id,
                "qty": quantity or 1,
                "unit": item_unit,
                "done": False,
                "addedAt": now,
            }
        )
        lst["updatedAt"] = now
        snap["updatedAt"] = now
        share["updatedAt"] = now
        share["snapshot"] = snap
        await self._async_save()

        alternatives = res.get("alternatives") or []
        return {
            "ok": True,
            "share_id": share["id"],
            "store_id": store_id,
            "product_id": product_id,
            "matched": product is not None,
            "classified": store_id != INBOX_STORE_ID,
            # Nombre REAL del producto que casó, que puede no ser lo que se dijo
            # ("pan" → "Pan integral"). Se devuelve para que el intent_script lo
            # diga en voz alta y el usuario se entere en el momento de si acertó.
            "product_name": product["name"] if product else name.strip(),
            # Otros que también casaban, del más al menos probable. Assist no
            # puede repreguntar y actuar sobre la respuesta (los intents propios
            # no hacen diálogo de varios turnos), pero sí puede nombrarlos.
            "alternatives": alternatives,
            "ambiguous": bool(alternatives),
        }
