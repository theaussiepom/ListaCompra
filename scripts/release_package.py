#!/usr/bin/env python3
"""Empaqueta y verifica la distribución HACS sin publicar ni modificar el checkout."""
from __future__ import annotations

import argparse
import ast
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
from urllib.parse import unquote, urlsplit
from zipfile import BadZipFile, ZIP_DEFLATED, ZipFile, ZipInfo


class PackageError(ValueError):
    """El artefacto no cumple el contrato de distribución."""


INTEGRATION = Path("custom_components/tucompra")
FIXED_FILES = frozenset({
    "__init__.py", "api.py", "catalog_locale.py", "const.py", "routing.py", "store.py",
    "manifest.json", "services.yaml", "catalog.json", "panel/tucompra-panel.js",
    "brand/icon.png", "brand/icon@2x.png",
})
LOCALES = ("es", "en", "us", "fr", "de", "br", "au")
ZIP_DATE = (1980, 1, 1, 0, 0, 0)
ASSET_SUFFIXES = frozenset({".js", ".css", ".wasm"})
PUBLIC_SUFFIXES = frozenset({".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".webmanifest"})
FORBIDDEN_PARTS = frozenset({
    "node_modules", "tests", "__pycache__", ".git", ".github", ".venv", "venv",
    ".pytest_cache", ".astro", ".aws", ".ssh", "research", "credentials",
})
MANIFEST_INVARIANTS = {
    "domain": "tucompra", "name": "Tu Compra", "integration_type": "service",
    "iot_class": "local_push", "config_flow": False,
    "dependencies": ["http", "frontend", "person"], "codeowners": ["@theaussiepom"],
    "issue_tracker": "https://github.com/theaussiepom/ListaCompra/issues",
}


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise PackageError(message)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json(data: bytes, name: str):
    try:
        return json.loads(data)
    except (UnicodeError, ValueError) as error:
        raise PackageError(f"Invalid JSON: {name}") from error


def _digest(value, *, sort_keys=False) -> str:
    return _sha(json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=sort_keys).encode())


def _safe_name(name: str) -> None:
    path = PurePosixPath(name)
    _require(bool(name) and not path.is_absolute() and "\\" not in name, f"Unsafe archive path: {name}")
    _require(path.as_posix() == name and all(part not in {"", ".", ".."} for part in name.split("/")),
             f"Noncanonical archive path: {name}")
    _require(not any(part.startswith(".") or part.lower() in FORBIDDEN_PARTS for part in path.parts),
             f"Forbidden archive path: {name}")
    _require(not re.search(r"(?:^|[._-])(?:secret|secrets|credential|credentials|token|private-key)(?:[._-]|$)", path.name, re.I),
             f"Sensitive archive filename: {name}")
    _require(path.suffix.lower() not in {".pyc", ".pyo", ".map", ".pem", ".key", ".tmp", ".bak"},
             f"Forbidden archive file: {name}")


def _read_regular(path: Path, root: Path) -> bytes:
    relative = path.relative_to(root)
    current = root
    _require(not root.is_symlink(), f"Symlink source root: {root}")
    for part in relative.parts:
        current /= part
        _require(not current.is_symlink(), f"Symlink input: {relative}")
    _require(path.is_file() and stat.S_ISREG(path.stat().st_mode), f"Missing regular file: {relative}")
    return path.read_bytes()


def _provenance(version: str, source_sha: str) -> bytes:
    return (json.dumps({
        "schema": 1, "repository": "theaussiepom/ListaCompra", "source_sha": source_sha,
        "version": version, "tag": f"v{version}", "package_version": version,
        "archive": "tucompra.zip", "zip_timestamp": "1980-01-01T00:00:00",
    }, indent=2, sort_keys=True) + "\n").encode()


def _inputs(source_root: Path, version: str, source_sha: str) -> dict[str, bytes]:
    _require(re.fullmatch(r"[0-9a-f]{40}", source_sha) is not None, "Source SHA must be a full lowercase commit SHA")
    _require(re.fullmatch(r"20[0-9]{2}\.(?:[1-9]|1[0-2])\.[1-9][0-9]*", version) is not None,
             "Version must use YYYY.M.N (2000-2099) with a positive monthly sequence")
    runtime = source_root / INTEGRATION
    _require(runtime.is_dir() and not runtime.is_symlink(), "Missing integration directory")
    public: dict[str, bytes] = {}
    public_root = source_root / "public"
    _require(public_root.is_dir() and not public_root.is_symlink(), "Missing public assets")
    for path in sorted(public_root.rglob("*")):
        name = path.relative_to(public_root).as_posix()
        _safe_name(name)
        _require(not path.is_symlink(), f"Symlink public input: {name}")
        if path.is_dir():
            continue
        _require(path.suffix.lower() in PUBLIC_SUFFIXES, f"Unapproved public asset: {name}")
        public[f"panel/app/{name}"] = _read_regular(path, source_root)
    allowed = FIXED_FILES | public.keys() | {"panel/app/index.html"}
    result: dict[str, bytes] = {}
    for path in sorted(runtime.rglob("*")):
        name = path.relative_to(runtime).as_posix()
        if name == "panel/.gitkeep":
            _read_regular(path, source_root)
            continue
        _safe_name(name)
        _require(not path.is_symlink(), f"Symlink integration input: {name}")
        if path.is_dir():
            continue
        generated_asset = (
            PurePosixPath(name).parent == PurePosixPath("panel/app/_astro")
            and re.fullmatch(r"[A-Za-z0-9_.-]+", path.name) is not None
            and path.suffix in ASSET_SUFFIXES
        )
        _require(name in allowed or generated_asset, f"Unapproved integration file: {name}")
        result[name] = _read_regular(path, source_root)
    missing = sorted(allowed - result.keys())
    _require(not missing, f"Missing package input: {', '.join(missing)}")
    for name, content in public.items():
        _require(result[name] == content, f"Built public asset differs from source: {name}")
    result["LICENSE"] = _read_regular(source_root / "LICENSE", source_root)
    _require(b"Copyright (c) 2026 maestrea76" in result["LICENSE"] and b"Permission is hereby granted, free of charge" in result["LICENSE"],
             "Original MIT copyright and permission notice are missing")
    result["release-build.json"] = _provenance(version, source_sha)
    return result


class _PanelParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references: list[str] = []
        self.footer: list[str] = []
        self.in_footer = False

    def handle_starttag(self, tag, attrs):
        if tag == "footer":
            self.in_footer = True
        for key, value in attrs:
            if value and key in {"src", "href", "component-url", "renderer-url", "before-hydration-url"}:
                self.references.append(value)

    def handle_endtag(self, tag):
        if tag == "footer":
            self.in_footer = False

    def handle_data(self, data):
        if self.in_footer:
            self.footer.append(data)


def _asset_target(reference: str, parent: str) -> str | None:
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc or not parsed.path:
        return None
    path = unquote(parsed.path)
    if path.startswith("/tucompra_static/app/"):
        target = "panel/app/" + path.removeprefix("/tucompra_static/app/")
    elif path.startswith("/"):
        raise PackageError(f"Panel asset has incorrect HA base: {reference}")
    else:
        target = str(PurePosixPath(parent).parent / path)
    _safe_name(target)
    return target


def _validate_assets(entries: dict[str, bytes], version: str) -> int:
    index = entries["panel/app/index.html"].decode("utf-8")
    parser = _PanelParser()
    parser.feed(index)
    footer = " ".join("".join(parser.footer).split())
    _require(re.search(rf"\bTu Compra v\.{re.escape(version)}(?:\s|$)", footer) is not None,
             "Compiled panel footer version is incorrect")
    refs: list[tuple[str, str]] = [(value, "panel/app/index.html") for value in parser.references]
    generated = {name: data for name, data in entries.items() if name.startswith("panel/app/_astro/")}
    for suffix in ASSET_SUFFIXES:
        matching = [(name, data) for name, data in generated.items() if name.endswith(suffix)]
        _require(bool(matching) and all(data for _, data in matching), f"Missing compiled frontend {suffix} asset")
    for name, content in generated.items():
        if name.endswith(".wasm"):
            _require(content.startswith(b"\x00asm\x01\x00\x00\x00"), f"Invalid WASM runtime asset: {name}")
        elif name.endswith(".js"):
            text = content.decode("utf-8")
            for value in re.findall(r'''["']((?:\./|\.\./|/tucompra_static/app/)[^"'\n]+\.(?:js|css|wasm)(?:\?[^"'\n]*)?)["']''', text):
                refs.append((value, name))
        elif name.endswith(".css"):
            text = content.decode("utf-8")
            for value in re.findall(r'''url\(\s*["']?([^\s)'";]+)["']?\s*\)''', text):
                refs.append((value, name))
    manifest = _json(entries["panel/app/manifest.webmanifest"], "panel manifest")
    for icon in manifest.get("icons", []):
        refs.append((icon["src"], "panel/app/manifest.webmanifest"))
    for value, parent in refs:
        target = _asset_target(value, parent)
        if target:
            _require(target in entries, f"Missing referenced frontend asset: {value} from {parent}")
    _require(any(value.endswith(".wasm") for value, _ in refs), "Compiled JavaScript does not reference the bundled WASM")
    return len(generated)


def _validate_catalog(catalog, fixture) -> dict:
    locales = catalog.get("locales", {})
    _require(tuple(locales) == LOCALES, "Catalogue must contain exactly the original six locales and AU")
    au = locales["au"]
    products, stores = au["products"], au["stores"]
    counts = {
        "products": len(products), "canonical": sum("mirrorOf" not in product for product in products),
        "mirrors": sum("mirrorOf" in product for product in products),
        "aliases": sum(len(product.get("aliases", [])) for product in products), "stores": len(stores),
    }
    expected = fixture["counts"]
    _require(counts == {
        "products": expected["totalProducts"], "canonical": expected["canonicalProducts"],
        "mirrors": expected["mirrorProducts"], "aliases": expected["runtimeSafeAliases"], "stores": expected["activeStores"],
    }, f"Incorrect Australian catalogue counts: {counts}")
    _require(counts == {"products": 1518, "canonical": 1285, "mirrors": 233, "aliases": 450, "stores": 9},
             "Reviewed Australian catalogue distribution contract changed")
    expected_stores = [{key: value for key, value in store.items() if key in {"id", "name", "typeId", "order"}}
                       for store in fixture["stores"]["active"]]
    _require(stores == expected_stores, "Australian store metadata differs from the reviewed acceptance fixture")
    store_ids = [store["id"] for store in stores]
    _require(store_ids == fixture["integrity"]["expectedActiveStoreIds"], "Incorrect Australian store IDs")
    _require(not set(store_ids) & (set(fixture["stores"]["deferredIds"]) | {"au-kmart", "au-ikea"}),
             "Deferred Australian store was emitted")
    _require(_digest(products, sort_keys=True) == fixture["exportedProductsSha256"], "Australian product integrity hash differs")
    for locale in LOCALES[:-1]:
        _require(_digest(locales[locale]) == fixture["existingLocaleBlockSha256"][locale], f"Original catalogue changed: {locale}")
    return {**counts, "store_ids": store_ids, "locales": list(locales), "products_sha256": _digest(products, sort_keys=True)}


def validate_package(zip_path, source_root, version: str, source_sha: str) -> dict:
    """Inspecciona el ZIP real y lo coteja con el checkout aislado que lo produjo."""
    source_root, zip_path = Path(source_root).absolute(), Path(zip_path).absolute()
    _require(zip_path.name == "tucompra.zip", "Incorrect ZIP filename; expected tucompra.zip")
    _require(zip_path.is_file() and not zip_path.is_symlink(), "Missing regular ZIP file")
    expected = _inputs(source_root, version, source_sha)
    entries: dict[str, bytes] = {}
    try:
        with ZipFile(zip_path) as archive:
            infos = archive.infolist()
            names = [info.filename for info in infos]
            _require(names == sorted(names) and len(names) == len(set(names)), "ZIP entries must be unique and sorted")
            _require(not archive.comment, "Unexpected ZIP comment")
            for info in infos:
                _safe_name(info.filename)
                _require(not info.is_dir() and stat.S_IFMT(info.external_attr >> 16) == stat.S_IFREG,
                         f"Non-regular ZIP entry: {info.filename}")
                _require(info.compress_type == ZIP_DEFLATED and info.date_time == ZIP_DATE and not info.extra and not info.comment,
                         f"Noncanonical ZIP metadata: {info.filename}")
                _require(info.create_system == 3 and info.external_attr == (stat.S_IFREG | 0o644) << 16,
                         f"Noncanonical ZIP permissions: {info.filename}")
                _require(not (info.flag_bits & 1), f"Encrypted ZIP entry: {info.filename}")
                _require(info.filename in expected, f"Unexpected ZIP entry: {info.filename}")
                _require(info.file_size == len(expected[info.filename]), f"ZIP entry size differs: {info.filename}")
                entries[info.filename] = archive.read(info)
            _require(entries.keys() == expected.keys(), f"ZIP contents differ; missing {sorted(expected.keys() - entries.keys())}")
            for name, content in entries.items():
                _require(content == expected[name], f"ZIP content differs from built source: {name}")
    except (BadZipFile, OSError, RuntimeError) as error:
        raise PackageError(f"Unreadable ZIP: {error}") from error
    manifest = _json(entries["manifest.json"], "manifest.json")
    for key, value in MANIFEST_INVARIANTS.items():
        _require(manifest.get(key) == value, f"Incorrect manifest {key}")
    documentation = urlsplit(manifest.get("documentation", ""))
    _require(documentation.scheme == "https" and documentation.netloc == "github.com"
             and (documentation.path == "/theaussiepom/ListaCompra" or documentation.path.startswith("/theaussiepom/ListaCompra/")),
             "Manifest documentation must reference the maintained fork")
    _require(manifest.get("version") == version, "Incorrect manifest version")
    package_json = _json(_read_regular(source_root / "package.json", source_root), "package.json")
    _require(package_json.get("version") == version, "Incorrect package.json version")
    hacs = _json(_read_regular(source_root / "hacs.json", source_root), "hacs.json")
    for key, value in {"zip_release": True, "filename": "tucompra.zip", "content_in_root": False,
                       "hide_default_branch": True, "homeassistant": "2024.7.0"}.items():
        _require(hacs.get(key) == value, f"Incorrect HACS {key}")
    for name, data in entries.items():
        if name.endswith(".py"):
            try:
                module = ast.parse(data, filename=name)
            except SyntaxError as error:
                raise PackageError(f"Invalid Python module: {name}") from error
            for node in ast.walk(module):
                if isinstance(node, ast.ImportFrom) and node.level:
                    _require(node.level == 1 and node.module is not None and node.module + ".py" in entries,
                             f"Missing relative Python dependency in {name}: {node.module}")
    assets = _validate_assets(entries, version)
    fixture = _json(_read_regular(source_root / "tests/fixtures/au-acceptance.json", source_root), "AU acceptance fixture")
    catalogue = _validate_catalog(_json(entries["catalog.json"], "catalog.json"), fixture)
    return {
        "status": "validated", "zip": str(zip_path), "sha256": _sha(zip_path.read_bytes()),
        "source_sha": source_sha, "version": version, "manifest_version": manifest["version"],
        "package_version": package_json["version"], "panel_version": version, "file_count": len(entries),
        "files": [{"path": name, "bytes": len(data), "sha256": _sha(data)} for name, data in entries.items()],
        "license_sha256": _sha(entries["LICENSE"]), "license_matches_source": True,
        "catalogue": catalogue, "compiled_asset_count": assets, "hacs_manifest": "validated release ZIP settings",
    }


def package(source_root, output_zip, version: str, source_sha: str) -> dict:
    """Crea el ZIP con metadatos estables; sólo deja el resultado si supera la validación."""
    source_root, output_zip = Path(source_root).absolute(), Path(output_zip).absolute()
    _require(output_zip.name == "tucompra.zip", "Incorrect ZIP filename; expected tucompra.zip")
    _require(not output_zip.exists(), "Refusing to overwrite an existing release ZIP")
    inputs = _inputs(source_root, version, source_sha)
    output_zip.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="tucompra-package-", dir=output_zip.parent) as temp:
        candidate = Path(temp) / "tucompra.zip"
        with ZipFile(candidate, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for name, content in sorted(inputs.items()):
                info = ZipInfo(name, date_time=ZIP_DATE)
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                info.compress_type = ZIP_DEFLATED
                archive.writestr(info, content, compress_type=ZIP_DEFLATED, compresslevel=9)
        report = validate_package(candidate, source_root, version, source_sha)
        with output_zip.open("xb") as destination, candidate.open("rb") as source:
            destination.write(source.read())
    report["zip"] = str(output_zip)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("package", "validate"))
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--zip", type=Path, required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        action = package if args.command == "package" else lambda root, path, version, sha: validate_package(path, root, version, sha)
        report = action(args.source_root, args.zip, args.version, args.source_sha)
    except (PackageError, OSError, KeyError, TypeError, UnicodeError) as error:
        parser.exit(1, f"Package validation failed: {error}\n")
    encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.report:
        args.report.write_text(encoded)
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
