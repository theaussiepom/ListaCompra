"""Estabiliza el identificador HMR del único island client:only ya revisado."""
from __future__ import annotations

import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re


class PanelError(ValueError):
    """El panel cambió fuera del contrato revisado para normalización."""


VERSIONS = {"astro": "5.18.2", "@astrojs/svelte": "7.2.5"}
STRATEGY = "client-only-appshell-uid-sha256-v1"
INDEX = Path("custom_components/tucompra/panel/app/index.html")
ATTRIBUTES = {
    "uid", "component-url", "component-export", "renderer-url", "props", "ssr", "client", "opts",
}


def _require(condition: bool, message: str):
    if not condition:
        raise PanelError(message)


def _read(source_root: Path, relative: Path) -> bytes:
    path = source_root
    _require(not path.is_symlink(), "Panel source root must not be a symlink")
    for part in relative.parts:
        path /= part
        _require(not path.is_symlink(), f"Panel input must not be a symlink: {relative}")
    _require(path.is_file(), f"Missing panel input: {relative}")
    return path.read_bytes()


class _Islands(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags: list[tuple[str, list[tuple[str, str | None]]]] = []
        self.end_tags = 0

    def handle_starttag(self, tag, attrs):
        if tag == "astro-island":
            self.tags.append((self.get_starttag_text(), attrs))

    def handle_endtag(self, tag):
        if tag == "astro-island":
            self.end_tags += 1


def normalize_panel(source_root: Path) -> dict:
    """Sólo cambia uid en el HTML generado; falla si cambia el contrato de Astro."""
    source_root = Path(source_root).absolute()
    try:
        lock = json.loads(_read(source_root, Path("package-lock.json")))
        for name, expected in VERSIONS.items():
            _require(lock["packages"][f"node_modules/{name}"]["version"] == expected,
                     f"Review panel normalization before changing {name} {expected}")
        before = _read(source_root, INDEX)
        html = before.decode("utf-8")
        parser = _Islands()
        parser.feed(html)
        _require(len(parser.tags) == 1 and parser.end_tags == 1,
                 "Expected the reviewed single AppShell island")
        tag, attributes = parser.tags[0]
        attrs = dict(attributes)
        _require(len(attributes) == len(attrs), "Duplicate island attributes")
        _require(set(attrs) == ATTRIBUTES, "Island attributes changed; transitions are not reviewed")
        _require(attrs["client"] == "only" and attrs["component-export"] == "default"
                 and attrs["props"] == "{}" and attrs["ssr"] is None,
                 "Island hydration contract changed")
        _require(json.loads(attrs["opts"]) == {"name": "AppShell", "value": "svelte"},
                 "Island renderer contract changed")
        _require(re.fullmatch(r"/tucompra_static/app/_astro/AppShell\.[A-Za-z0-9_-]+\.js", attrs["component-url"]) is not None,
                 "Island component module contract changed")
        _require(re.fullmatch(r"/tucompra_static/app/_astro/client\.svelte\.[A-Za-z0-9_-]+\.js", attrs["renderer-url"]) is not None,
                 "Island renderer module contract changed")
        _require(html.count(tag) == 1 and tag + "</astro-island>" in html,
                 "Expected the reviewed empty client-only island")
        old_uid = attrs.pop("uid")
        _require(isinstance(old_uid, str) and re.fullmatch(r"[A-Za-z0-9]+", old_uid) is not None,
                 "Invalid island UID")
        _require(html.count(old_uid) == 1, "Island UID is referenced outside its attribute")
        # Astro 5.18.2 deriva uid de la ruta absoluta; sólo HMR lo usa.
        stable_input = json.dumps({"position": 0, "attributes": attrs}, sort_keys=True, separators=(",", ":"))
        new_uid = "tc" + hashlib.sha256(stable_input.encode()).hexdigest()[:16]
        new_tag, replacements = re.subn(r'(?<=\s)uid="[^"]*"', f'uid="{new_uid}"', tag)
        _require(replacements == 1, "Unexpected UID attribute representation")
        after = html.replace(tag, new_tag, 1).encode("utf-8")
    except (KeyError, TypeError, ValueError, UnicodeError) as error:
        if isinstance(error, PanelError):
            raise
        raise PanelError(f"Invalid panel normalization input: {error}") from error
    if after != before:
        (source_root / INDEX).write_bytes(after)
    return {
        "strategy": STRATEGY, "versions": dict(VERSIONS), "file": INDEX.as_posix(),
        "old_uid": old_uid, "new_uid": new_uid, "changed": after != before,
        "sha256_before": hashlib.sha256(before).hexdigest(),
        "sha256_after": hashlib.sha256(after).hexdigest(),
    }
