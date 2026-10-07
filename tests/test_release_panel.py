"""La normalización de releases conserva todo salvo el UID HMR revisado."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("release_panel", ROOT / "scripts/release_panel.py")
panel = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(panel)


def island(uid="lk6me"):
    return (f'<astro-island uid="{uid}" component-url="/tucompra_static/app/_astro/AppShell.BDrPecAH.js" '
            'component-export="default" renderer-url="/tucompra_static/app/_astro/client.svelte.B-Sse4aW.js" '
            'props="{}" ssr client="only" opts="{&quot;name&quot;:&quot;AppShell&quot;,&quot;value&quot;:&quot;svelte&quot;}">'
            '</astro-island>')


def html(uid="lk6me"):
    return ('<!doctype html>\n<html><head><script>const unrelated="astro-island";</script></head>'
            '<body>Texto español 🛒\n' + island(uid) + '<footer>Tu Compra v.2026.10.1</footer></body></html>')


def fixture(root, content=None):
    root.mkdir(parents=True)
    (root / "package-lock.json").write_text(json.dumps({"packages": {
        f"node_modules/{name}": {"version": version} for name, version in panel.VERSIONS.items()
    }}))
    target = root / panel.INDEX
    target.parent.mkdir(parents=True)
    target.write_text(html() if content is None else content)
    return root, target


def test_different_real_build_uids_normalize_to_identical_bytes(tmp_path):
    first, first_html = fixture(tmp_path / "first", html("lk6me"))
    second, second_html = fixture(tmp_path / "second", html("Z1gkWKJ"))
    first_before, second_before = first_html.read_bytes(), second_html.read_bytes()
    assert first_before != second_before
    one = panel.normalize_panel(first)
    two = panel.normalize_panel(second)
    assert first_html.read_bytes() == second_html.read_bytes()
    assert one["sha256_after"] == two["sha256_after"]
    assert one["sha256_before"] != two["sha256_before"]
    assert one["old_uid"] == "lk6me"
    assert two["old_uid"] == "Z1gkWKJ"
    assert one["new_uid"] == two["new_uid"] == "tc0eaeddf7d6864b5e"
    assert one["versions"] == {"astro": "5.18.2", "@astrojs/svelte": "7.2.5"}
    assert one["changed"] and two["changed"]
    assert first_html.read_bytes().replace(one["new_uid"].encode(), b"lk6me") == first_before
    assert second_html.read_bytes().replace(two["new_uid"].encode(), b"Z1gkWKJ") == second_before


def test_normalization_is_idempotent_and_preserves_other_files(tmp_path):
    root, target = fixture(tmp_path / "source")
    before_lock = (root / "package-lock.json").read_bytes()
    first = panel.normalize_panel(root)
    content = target.read_bytes()
    modified = target.stat().st_mtime_ns
    second = panel.normalize_panel(root)
    assert not second["changed"]
    assert second["sha256_before"] == second["sha256_after"] == first["sha256_after"]
    assert second["old_uid"] == second["new_uid"] == first["new_uid"]
    assert target.read_bytes() == content
    assert target.stat().st_mtime_ns == modified
    assert (root / "package-lock.json").read_bytes() == before_lock


@pytest.mark.parametrize("package", ["astro", "@astrojs/svelte"])
def test_dependency_version_drift_requires_review(tmp_path, package):
    root, target = fixture(tmp_path / "source")
    path = root / "package-lock.json"
    lock = json.loads(path.read_text())
    lock["packages"][f"node_modules/{package}"]["version"] = "99.0.0"
    path.write_text(json.dumps(lock))
    before = target.read_bytes()
    with pytest.raises(panel.PanelError, match="Review panel normalization"):
        panel.normalize_panel(root)
    assert target.read_bytes() == before


@pytest.mark.parametrize("mutation", [
    lambda text: text.replace(island(), ""),
    lambda text: text.replace(island(), island() + island("otherUid")),
    lambda text: text.replace('uid="lk6me"', 'uid="lk6me" uid="duplicate"'),
    lambda text: text.replace('client="only"', 'client="load"'),
    lambda text: text.replace('component-export="default"', 'component-export="Other"'),
    lambda text: text.replace('props="{}"', 'props="{&quot;extra&quot;:1}"'),
    lambda text: text.replace(' ssr ', ' ssr="yes" '),
    lambda text: text.replace('&quot;svelte&quot;', '&quot;react&quot;'),
    lambda text: text.replace('AppShell.BDrPecAH.js', 'Other.BDrPecAH.js'),
    lambda text: text.replace('client.svelte.B-Sse4aW.js', 'client.react.B-Sse4aW.js'),
    lambda text: text.replace(' props=', ' data-astro-transition-persist="app" props='),
    lambda text: text.replace('</astro-island>', '<p>Server-rendered child</p></astro-island>'),
    lambda text: text.replace('uid="lk6me"', 'uid="bad-uid"'),
    lambda text: text.replace('<footer>', '<footer data-ref="lk6me">'),
    lambda text: text.replace('uid="lk6me"', "uid='lk6me'"),
    lambda text: text.replace('</astro-island>', '</astro-island></astro-island>'),
    lambda text: text.replace('uid="lk6me" ', ''),
    lambda text: text.replace(' opts=', ' future-attribute="value" opts='),
])
def test_island_contract_drift_is_rejected_without_writing(tmp_path, mutation):
    root, target = fixture(tmp_path / "source", mutation(html()))
    before = target.read_bytes()
    with pytest.raises(panel.PanelError):
        panel.normalize_panel(root)
    assert target.read_bytes() == before


@pytest.mark.parametrize("content", ["{", "{}", '{"packages":{}}'])
def test_invalid_or_missing_lock_metadata_is_rejected(tmp_path, content):
    root, target = fixture(tmp_path / "source")
    (root / "package-lock.json").write_text(content)
    before = target.read_bytes()
    with pytest.raises(panel.PanelError):
        panel.normalize_panel(root)
    assert target.read_bytes() == before


def test_symlink_panel_is_rejected_before_mutation(tmp_path):
    root, target = fixture(tmp_path / "source")
    outside = tmp_path / "outside.html"
    target.rename(outside)
    target.symlink_to(outside)
    before = outside.read_bytes()
    with pytest.raises(panel.PanelError, match="symlink"):
        panel.normalize_panel(root)
    assert outside.read_bytes() == before


def test_non_utf8_panel_is_rejected_without_mutation(tmp_path):
    root, target = fixture(tmp_path / "source")
    target.write_bytes(b"\xff\xfe")
    with pytest.raises(panel.PanelError):
        panel.normalize_panel(root)
    assert target.read_bytes() == b"\xff\xfe"
