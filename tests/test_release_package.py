"""El ZIP HACS valida sus bytes y rechaza entradas incompletas o inseguras."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import stat
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("release_package", ROOT / "scripts/release_package.py")
release_package = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release_package)
VERSION = "2026.10.1"
SOURCE_SHA = "932fbea03caba4a0348644ba0a7b5ee8c7880dfc"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


@pytest.fixture
def candidate(tmp_path):
    source = tmp_path / "candidate"
    runtime = source / release_package.INTEGRATION
    runtime.mkdir(parents=True)
    for name in release_package.FIXED_FILES:
        destination = runtime / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / release_package.INTEGRATION / name, destination)
    shutil.copyfile(ROOT / "LICENSE", source / "LICENSE")
    shutil.copytree(ROOT / "public", source / "public")
    shutil.copytree(ROOT / "public", runtime / "panel/app")
    fixture = source / "tests/fixtures/au-acceptance.json"
    fixture.parent.mkdir(parents=True)
    shutil.copyfile(ROOT / "tests/fixtures/au-acceptance.json", fixture)
    manifest = json.loads((runtime / "manifest.json").read_text())
    manifest.update(release_package.MANIFEST_INVARIANTS)
    manifest.update(version=VERSION, documentation="https://github.com/theaussiepom/ListaCompra")
    write_json(runtime / "manifest.json", manifest)
    write_json(source / "package.json", {"version": VERSION})
    write_json(source / "hacs.json", {"zip_release": True, "filename": "tucompra.zip", "content_in_root": False,
                                      "hide_default_branch": True, "homeassistant": "2024.7.0"})
    panel = runtime / "panel/app"
    shutil.copyfile(ROOT / release_package.INTEGRATION / "panel/.gitkeep", runtime / "panel/.gitkeep")
    (panel / "_astro").mkdir()
    (panel / "index.html").write_text(
        '<html><head><link rel="stylesheet" href="/tucompra_static/app/_astro/app.A1.css">'
        '<link rel="manifest" href="/tucompra_static/app/manifest.webmanifest"></head><body>'
        '<astro-island component-url="/tucompra_static/app/_astro/app.A1.js" '
        'renderer-url="/tucompra_static/app/_astro/client.A1.js"></astro-island>'
        f'<footer>Tu Compra v.{VERSION} por <strong>maestrea</strong></footer></body></html>'
    )
    (panel / "_astro/app.A1.js").write_text('import "./client.A1.js";const wasm="/tucompra_static/app/_astro/reader.A1.wasm";')
    (panel / "_astro/client.A1.js").write_text('export const hydrate = () => {};')
    (panel / "_astro/app.A1.css").write_text('body { color: black; }')
    (panel / "_astro/reader.A1.wasm").write_bytes(b"\x00asm\x01\x00\x00\x00")
    return source


def produce(candidate, tmp_path):
    output = tmp_path / "output/tucompra.zip"
    report = release_package.package(candidate, output, VERSION, SOURCE_SHA)
    return output, report


def rewrite_archive(path, *, remove=(), update=None, extra=None, rename=None):
    with ZipFile(path) as archive:
        entries = {info.filename: archive.read(info) for info in archive.infolist() if info.filename not in remove}
    entries.update(update or {})
    entries.update(extra or {})
    if rename:
        entries = {rename(name): data for name, data in entries.items()}
    with ZipFile(path, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(entries.items()):
            info = ZipInfo(name, date_time=release_package.ZIP_DATE)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data, compress_type=ZIP_DEFLATED, compresslevel=9)


def test_package_is_deterministic_complete_and_source_unchanged(candidate, tmp_path):
    before = {path.relative_to(candidate).as_posix(): path.read_bytes() for path in candidate.rglob("*") if path.is_file()}
    output, report = produce(candidate, tmp_path)
    second = tmp_path / "second/tucompra.zip"
    second_report = release_package.package(candidate, second, VERSION, SOURCE_SHA)
    assert output.read_bytes() == second.read_bytes()
    assert report["sha256"] == second_report["sha256"]
    assert report["status"] == "validated"
    assert report["catalogue"]["products"] == 1518
    assert report["catalogue"]["canonical"] == 1285
    assert report["catalogue"]["mirrors"] == 233
    assert report["catalogue"]["aliases"] == 450
    assert report["catalogue"]["stores"] == 9
    assert report["manifest_version"] == report["package_version"] == report["panel_version"] == VERSION
    with ZipFile(output) as archive:
        assert archive.read("LICENSE") == (ROOT / "LICENSE").read_bytes()
        provenance = json.loads(archive.read("release-build.json"))
        assert provenance["source_sha"] == SOURCE_SHA
        assert provenance["version"] == VERSION
        assert "__init__.py" in archive.namelist()
        assert "panel/.gitkeep" not in archive.namelist()
        assert all(not name.startswith("custom_components/") for name in archive.namelist())
    after = {path.relative_to(candidate).as_posix(): path.read_bytes() for path in candidate.rglob("*") if path.is_file()}
    assert before == after


@pytest.mark.parametrize("missing", ["panel/app/index.html", "catalog.json", "LICENSE", "routing.py", "panel/app/_astro/app.A1.js"])
def test_validator_rejects_missing_zip_entries(candidate, tmp_path, missing):
    output, _ = produce(candidate, tmp_path)
    rewrite_archive(output, remove={missing})
    with pytest.raises(release_package.PackageError, match="ZIP contents differ"):
        release_package.validate_package(output, candidate, VERSION, SOURCE_SHA)


def test_validator_rejects_nested_integration_layout(candidate, tmp_path):
    output, _ = produce(candidate, tmp_path)
    rewrite_archive(output, rename=lambda name: "custom_components/tucompra/" + name)
    with pytest.raises(release_package.PackageError, match="Unexpected ZIP entry"):
        release_package.validate_package(output, candidate, VERSION, SOURCE_SHA)


@pytest.mark.parametrize("name", ["../secret.txt", "/secret.txt", "node_modules/a.js", "__pycache__/api.pyc", ".env", "credentials.json", "research.json"])
def test_validator_rejects_forbidden_archive_entries(candidate, tmp_path, name):
    output, _ = produce(candidate, tmp_path)
    rewrite_archive(output, extra={name: b"unwanted"})
    with pytest.raises(release_package.PackageError):
        release_package.validate_package(output, candidate, VERSION, SOURCE_SHA)


@pytest.mark.parametrize("name", ["catalog.json", "panel/app/_astro/app.A1.js", "panel/app/_astro/reader.A1.wasm", "LICENSE", "release-build.json"])
def test_validator_rejects_tampered_archive_bytes(candidate, tmp_path, name):
    output, _ = produce(candidate, tmp_path)
    with ZipFile(output) as archive:
        data = archive.read(name)
    rewrite_archive(output, update={name: data[:-1] + bytes([data[-1] ^ 1])})
    with pytest.raises(release_package.PackageError, match="ZIP content differs"):
        release_package.validate_package(output, candidate, VERSION, SOURCE_SHA)


@pytest.mark.parametrize("name", ["api.py", "panel/app/_astro/app.A1.js", "catalog.json"])
def test_package_rejects_symlink_source(candidate, tmp_path, name):
    path = candidate / release_package.INTEGRATION / name
    outside = tmp_path / "outside"
    path.rename(outside)
    path.symlink_to(outside)
    with pytest.raises(release_package.PackageError, match="Symlink"):
        produce(candidate, tmp_path)


def test_validator_rejects_symlink_archive(candidate, tmp_path):
    output, _ = produce(candidate, tmp_path)
    with ZipFile(output) as archive:
        entries = {info.filename: archive.read(info) for info in archive.infolist()}
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        for name, data in sorted(entries.items()):
            info = ZipInfo(name, release_package.ZIP_DATE)
            info.create_system = 3
            info.external_attr = ((stat.S_IFLNK if name == "api.py" else stat.S_IFREG) | 0o644) << 16
            info.compress_type = ZIP_DEFLATED
            archive.writestr(info, data)
    with pytest.raises(release_package.PackageError, match="Non-regular ZIP entry"):
        release_package.validate_package(output, candidate, VERSION, SOURCE_SHA)


@pytest.mark.parametrize("filename", ["release.zip", "tucompra.ZIP", "tucompra-2026.10.1.zip"])
def test_wrong_zip_filename_rejected(candidate, tmp_path, filename):
    with pytest.raises(release_package.PackageError, match="Incorrect ZIP filename"):
        release_package.package(candidate, tmp_path / filename, VERSION, SOURCE_SHA)
    output, _ = produce(candidate, tmp_path)
    renamed = output.with_name(filename)
    output.rename(renamed)
    with pytest.raises(release_package.PackageError, match="Incorrect ZIP filename"):
        release_package.validate_package(renamed, candidate, VERSION, SOURCE_SHA)


@pytest.mark.parametrize("missing", ["catalog.json", "panel/app/index.html", "routing.py"])
def test_package_rejects_incomplete_built_tree(candidate, tmp_path, missing):
    (candidate / release_package.INTEGRATION / missing).unlink()
    with pytest.raises(release_package.PackageError, match="Missing package input"):
        produce(candidate, tmp_path)
    assert not (tmp_path / "output/tucompra.zip").exists()


def test_package_rejects_missing_license(candidate, tmp_path):
    (candidate / "LICENSE").unlink()
    with pytest.raises(release_package.PackageError, match="Missing regular file: LICENSE"):
        produce(candidate, tmp_path)


@pytest.mark.parametrize("mutation", ["au-missing", "alias-count", "product-content", "deferred-store", "original-locale"])
def test_package_rejects_invalid_catalogue_even_when_source_and_zip_agree(candidate, tmp_path, mutation):
    path = candidate / release_package.INTEGRATION / "catalog.json"
    catalog = json.loads(path.read_text())
    au = catalog["locales"]["au"]
    if mutation == "au-missing":
        del catalog["locales"]["au"]
    elif mutation == "alias-count":
        next(product for product in au["products"] if product.get("aliases"))["aliases"].pop()
    elif mutation == "product-content":
        au["products"][0]["name"] = "Unreviewed product name"
    elif mutation == "deferred-store":
        au["stores"][0]["id"] = "au-kmart"
    else:
        catalog["locales"]["es"]["products"][0]["name"] = "Changed upstream catalogue"
    write_json(path, catalog)
    with pytest.raises(release_package.PackageError):
        produce(candidate, tmp_path)
    assert not (tmp_path / "output/tucompra.zip").exists()


@pytest.mark.parametrize("field,value", [
    ("version", "0.3.56"), ("domain", "tucompra_au"), ("dependencies", []),
    ("codeowners", ["@maestrea76"]), ("issue_tracker", "https://github.com/maestrea76/ListaCompra/issues"),
    ("documentation", "https://github.com/theaussiepom/ListaCompra-evil"),
])
def test_package_rejects_manifest_metadata_or_version_mismatch(candidate, tmp_path, field, value):
    path = candidate / release_package.INTEGRATION / "manifest.json"
    manifest = json.loads(path.read_text())
    manifest[field] = value
    write_json(path, manifest)
    with pytest.raises(release_package.PackageError, match="manifest|Manifest"):
        produce(candidate, tmp_path)


def test_package_rejects_source_package_version_mismatch(candidate, tmp_path):
    write_json(candidate / "package.json", {"version": "0.3.56"})
    with pytest.raises(release_package.PackageError, match="package.json version"):
        produce(candidate, tmp_path)


@pytest.mark.parametrize("hide_default_branch", [None, False])
def test_package_requires_hacs_default_branch_hiding(candidate, tmp_path, hide_default_branch):
    path = candidate / "hacs.json"
    hacs = json.loads(path.read_text())
    if hide_default_branch is None:
        del hacs["hide_default_branch"]
    else:
        hacs["hide_default_branch"] = hide_default_branch
    write_json(path, hacs)
    with pytest.raises(release_package.PackageError, match="Incorrect HACS hide_default_branch"):
        produce(candidate, tmp_path)


def test_package_rejects_old_compiled_footer(candidate, tmp_path):
    path = candidate / release_package.INTEGRATION / "panel/app/index.html"
    path.write_text(path.read_text().replace(f"v.{VERSION}", "v.0.3.56"))
    with pytest.raises(release_package.PackageError, match="footer version"):
        produce(candidate, tmp_path)


def test_package_rejects_missing_referenced_asset(candidate, tmp_path):
    path = candidate / release_package.INTEGRATION / "panel/app/_astro/app.A1.js"
    path.write_text(path.read_text() + 'import "./missing.A1.js";')
    with pytest.raises(release_package.PackageError, match="Missing referenced frontend asset"):
        produce(candidate, tmp_path)


@pytest.mark.parametrize("asset", ["favicon.svg", "manifest.webmanifest"])
def test_package_rejects_ha_base_without_separator(candidate, tmp_path, asset):
    path = candidate / release_package.INTEGRATION / "panel/app/index.html"
    path.write_text(path.read_text().replace("</head>", f'<link href="/tucompra_static/app{asset}"></head>'))
    with pytest.raises(release_package.PackageError, match="incorrect HA base"):
        produce(candidate, tmp_path)


def test_package_rejects_corrupt_wasm(candidate, tmp_path):
    path = candidate / release_package.INTEGRATION / "panel/app/_astro/reader.A1.wasm"
    path.write_bytes(b"not-a-wasm-module")
    with pytest.raises(release_package.PackageError, match="Invalid WASM"):
        produce(candidate, tmp_path)


@pytest.mark.parametrize("name", ["__pycache__/api.pyc", ".env", "secret.json", "research.json", "node_modules/a.js"])
def test_package_rejects_unwanted_integration_inputs(candidate, tmp_path, name):
    path = candidate / release_package.INTEGRATION / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("unexpected input")
    with pytest.raises(release_package.PackageError):
        produce(candidate, tmp_path)


def test_package_refuses_existing_output(candidate, tmp_path):
    output, _ = produce(candidate, tmp_path)
    before = output.read_bytes()
    with pytest.raises(release_package.PackageError, match="overwrite"):
        produce(candidate, tmp_path)
    assert output.read_bytes() == before


def test_validator_rejects_different_provenance_sha(candidate, tmp_path):
    output, _ = produce(candidate, tmp_path)
    with pytest.raises(release_package.PackageError, match="release-build.json"):
        release_package.validate_package(output, candidate, VERSION, "0" * 40)


@pytest.mark.parametrize("version", ["v2026.10.1", "2026.13.1", "2026.10.0", "2026.10.1-au", "1900.1.1"])
def test_package_rejects_unsupported_version_format(candidate, tmp_path, version):
    with pytest.raises(release_package.PackageError, match="Version must use"):
        release_package.package(candidate, tmp_path / "tucompra.zip", version, SOURCE_SHA)


def test_package_rejects_symlink_source_placeholder(candidate, tmp_path):
    placeholder = candidate / release_package.INTEGRATION / "panel/.gitkeep"
    placeholder.unlink()
    placeholder.symlink_to(candidate / "LICENSE")
    with pytest.raises(release_package.PackageError, match="Symlink input"):
        produce(candidate, tmp_path)
