"""Bloqueos reales de fuente, versión y publicación; GitHub se simula sin escrituras."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from zipfile import ZipFile

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import release_guard as guard
import release_preflight as preflight
import release_publish as publisher

SHA = "a" * 40
VERSION = "2026.10.1"


@pytest.fixture
def source_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    def git(*args):
        return subprocess.check_output(["git", "-c", "user.name=Release test", "-c", "user.email=release@example.invalid", "-c", "commit.gpgsign=false", *args], cwd=repo, text=True).strip()
    git("init", "-q", "-b", "main")
    (repo / "source.txt").write_text("upstream\n")
    git("add", ".")
    git("commit", "-qm", "upstream fixture")
    upstream = git("rev-parse", "HEAD")
    (repo / "source.txt").write_text("maintained AU\n")
    git("commit", "-qam", "maintained fixture")
    maintained = git("rev-parse", "HEAD")
    git("update-ref", guard.MAINTAINED_REF, maintained)
    (repo / "source.txt").write_text("approved preparation\n")
    git("commit", "-qam", "candidate fixture")
    candidate = git("rev-parse", "HEAD")
    git("remote", "add", "origin", f"https://github.com/{guard.REPOSITORY}.git")
    return repo, git, upstream, maintained, candidate


def test_exact_clean_descendant_source(source_repo):
    repo, _, _, maintained, candidate = source_repo
    assert guard.validate_source(repo, candidate)["maintained_sha"] == maintained


def test_wrong_source_sha(source_repo):
    repo, _, _, _, _ = source_repo
    with pytest.raises(guard.ReleaseError, match="SHA does not equal"):
        guard.validate_source(repo, SHA)


def test_upstream_only_tag_source_is_rejected_without_creating_tag(source_repo):
    repo, git, upstream, _, _ = source_repo
    git("checkout", "--detach", "-q", upstream)
    with pytest.raises(guard.ReleaseError, match="upstream-only main"):
        guard.validate_source(repo, upstream)


@pytest.mark.parametrize("change", ["tracked", "untracked", "remote"])
def test_dirty_or_wrong_repository_source(source_repo, change):
    repo, git, _, _, candidate = source_repo
    if change == "tracked":
        (repo / "source.txt").write_text("uncommitted")
    elif change == "untracked":
        (repo / "extra.txt").write_text("unreviewed")
    else:
        git("remote", "set-url", "origin", "https://github.com/maestrea76/ListaCompra.git")
    with pytest.raises(guard.ReleaseError):
        guard.validate_source(repo, candidate)


@pytest.mark.parametrize("value", ["v2026.10.1", "0.3.57", "2026.13.1", "2026.01.1", "2026.10.0", "2026.10.1-au", "2026.10.1;echo x", "2026.10.1\n", "2100.1.1"])
def test_unsupported_version(value):
    with pytest.raises(guard.ReleaseError):
        guard.validate_version(value)


def test_version_policy_order():
    values = ["2026.9.9", "2026.10.1", "2026.10.2", "2026.11.1", "2027.1.1"]
    assert [guard.validate_version(v) for v in values] == sorted(guard.validate_version(v) for v in values)


@pytest.mark.parametrize("tags,releases", [
    ({f"v{VERSION}": SHA}, []), ({VERSION: SHA}, []),
    ({}, [{"tag_name": f"v{VERSION}", "draft": True}]),
    ({}, [{"tag_name": f"v{VERSION}", "prerelease": True}]),
    ({"v2026.11.1": SHA}, []), ({}, [{"tag_name": "v2027.1.1"}]),
])
def test_collision_or_nonmonotonic_version(tags, releases):
    with pytest.raises(guard.ReleaseError):
        guard.validate_collisions(VERSION, tags, releases)


def test_only_new_matching_tag_can_exist_in_tag_event():
    guard.validate_collisions(VERSION, {f"v{VERSION}": SHA, "v0.3.56": "b" * 40}, [], new_tag_source=SHA)
    for tags in ({}, {f"v{VERSION}": "b" * 40}):
        with pytest.raises(guard.ReleaseError):
            guard.validate_collisions(VERSION, tags, [], new_tag_source=SHA)


def approved_context():
    env = {"GITHUB_REPOSITORY": guard.REPOSITORY, "GITHUB_EVENT_NAME": "push", "GITHUB_REF": f"refs/tags/v{VERSION}", "FORK_RELEASE_APPROVED_SHA": SHA, "FORK_RELEASE_APPROVED_VERSION": VERSION}
    event = {"ref": env["GITHUB_REF"], "created": True, "deleted": False, "forced": False, "before": "0" * 40}
    return env, event


@pytest.mark.parametrize("scope,key,value", [
    ("env", "FORK_RELEASE_APPROVED_SHA", ""), ("env", "FORK_RELEASE_APPROVED_VERSION", "2026.10.2"),
    ("env", "GITHUB_REPOSITORY", "maestrea76/ListaCompra"), ("env", "GITHUB_EVENT_NAME", "workflow_dispatch"),
    ("env", "GITHUB_REF", "refs/heads/main"), ("event", "created", False),
    ("event", "forced", True), ("event", "deleted", True), ("event", "before", "b" * 40),
])
def test_publication_approval_and_fresh_tag_guard(scope, key, value):
    env, event = approved_context()
    guard.validate_approval(SHA, VERSION, env, event)
    (env if scope == "env" else event)[key] = value
    with pytest.raises(guard.ReleaseError):
        guard.validate_approval(SHA, VERSION, env, event)


def test_tag_target_wrong_sha(tmp_path, monkeypatch):
    env, event = approved_context()
    path = tmp_path / "event.json"
    path.write_text(json.dumps(event))
    env["GITHUB_EVENT_PATH"] = str(path)
    monkeypatch.setattr(guard, "git", lambda *args: "b" * 40)
    with pytest.raises(guard.ReleaseError, match="Tag points"):
        guard.tag_context(tmp_path, SHA, VERSION, env)


@pytest.mark.parametrize("failure", ["npm-ci", "types", "catalogue", "node-tests", "python-tests", "ha-build"])
def test_command_failure_stops_pipeline_before_later_steps(tmp_path, failure):
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests/example.test.mjs").write_text("test")
    report = {"status": "failed", "checks": {}}
    names = ["npm-ci", "types", "catalogue", "node-tests", "python-tests", "ha-build"]
    called = []
    def runner(command, **kwargs):
        name = names[len(called)]
        called.append(name)
        return SimpleNamespace(returncode=1 if name == failure else 0)
    with pytest.raises(guard.ReleaseError, match=failure):
        preflight.execute_checks(tmp_path, tmp_path, "python", report, runner)
    assert called == names[:names.index(failure) + 1]
    assert report["checks"][failure] == "failed"
    assert "zip" not in report["checks"]
    assert report["status"] == "failed"


@pytest.fixture
def artifacts(tmp_path):
    repo = tmp_path / "source"
    repo.mkdir()
    (repo / "LICENSE").write_bytes((ROOT / "LICENSE").read_bytes())
    output = tmp_path / "output"
    output.mkdir()
    with ZipFile(output / "tucompra.zip", "w") as archive:
        archive.writestr("manifest.json", json.dumps({"version": VERSION}))
        archive.writestr("release-build.json", json.dumps({"version": VERSION, "source_sha": SHA}))
        archive.writestr("LICENSE", (repo / "LICENSE").read_bytes())
    digest = hashlib.sha256((output / "tucompra.zip").read_bytes()).hexdigest()
    report = {"schema": 1, "status": "passed", "source_sha": SHA, "version": VERSION, "zip_sha256": digest, "checks": {name: "passed" for name in guard.REQUIRED_CHECKS}, "package": {"status": "validated", "source_sha": SHA, "version": VERSION, "sha256": digest}}
    (output / "release-report.json").write_text(json.dumps(report))
    return repo, output, digest, report


@pytest.mark.parametrize("failed_check", guard.REQUIRED_CHECKS)
def test_failed_validation_cannot_reach_publication(artifacts, monkeypatch, failed_check):
    repo, output, digest, report = artifacts
    report["checks"][failed_check] = "failed"
    (output / "release-report.json").write_text(json.dumps(report))
    monkeypatch.setattr(publisher, "validate_source", lambda *args: {})
    monkeypatch.setattr(publisher, "tag_context", lambda *args: None)
    monkeypatch.setattr(publisher, "remote_inventory", lambda *args: ({f"v{VERSION}": SHA}, []))
    api = FakeAPI()
    with pytest.raises(guard.ReleaseError, match="validation"):
        publisher.publish_release(repo, output, SHA, VERSION, digest, publish=True, api=api)
    assert api.calls == []


@pytest.mark.parametrize("mutation", ["source", "version", "hash", "schema", "package", "missing-check", "zip"])
def test_invalid_report_or_changed_artifact(artifacts, mutation):
    repo, output, digest, report = artifacts
    if mutation == "source": report["source_sha"] = "b" * 40
    if mutation == "version": report["version"] = "2026.10.2"
    if mutation == "hash": report["zip_sha256"] = "0" * 64
    if mutation == "schema": report["schema"] = 2
    if mutation == "package": report["package"]["status"] = "failed"
    if mutation == "missing-check": report["checks"].pop("zip")
    if mutation == "zip": (output / "tucompra.zip").write_bytes(b"changed")
    (output / "release-report.json").write_text(json.dumps(report))
    with pytest.raises(guard.ReleaseError):
        publisher.inspect_artifacts(output, repo, SHA, VERSION, digest)


class FakeAPI:
    def __init__(self, invalid_asset=False, upload_failure=False):
        self.calls = []
        self.assets = []
        self.invalid_asset = invalid_asset
        self.upload_failure = upload_failure

    def request(self, method, path, *, data=None, binary=None):
        self.calls.append((method, path, data))
        if method == "POST" and path == "releases":
            assert data["draft"] is True
            return {"id": 123, "upload_url": f"https://uploads.github.com/repos/{guard.REPOSITORY}/releases/123/assets{{?name,label}}"}
        if binary is not None:
            if self.upload_failure:
                raise OSError("upload unavailable")
            name = path.split("name=")[1]
            self.assets.append({"name": name, "state": "uploaded", "size": len(binary), "digest": "sha256:" + ("0" * 64 if self.invalid_asset else hashlib.sha256(binary).hexdigest())})
            return self.assets[-1]
        if method == "GET":
            return self.assets
        return {}


def test_dry_run_never_writes(artifacts):
    _, output, digest, _ = artifacts
    api = FakeAPI()
    result = publisher.publish_validated(api, output, SHA, VERSION, digest)
    assert result["status"] == "dry-run" and api.calls == []


def test_only_publish_after_both_uploaded_asset_digests_match(artifacts):
    _, output, digest, _ = artifacts
    api = FakeAPI()
    publisher.publish_validated(api, output, SHA, VERSION, digest, publish=True)
    assert api.calls[-1] == ("PATCH", "releases/123", {"draft": False, "make_latest": "true"})


@pytest.mark.parametrize("problem", ["invalid_asset", "upload_failure"])
def test_failed_upload_or_digest_leaves_draft_unpublished(artifacts, problem):
    _, output, digest, _ = artifacts
    api = FakeAPI(**{problem: True})
    with pytest.raises((guard.ReleaseError, OSError)):
        publisher.publish_validated(api, output, SHA, VERSION, digest, publish=True)
    assert not any(method == "PATCH" for method, _, _ in api.calls)


def test_workflow_permissions_and_dependency_gate():
    path = ROOT / ".github/workflows/fork-release.yml"
    workflow = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
    assert workflow["permissions"] == {"contents": "read"}
    jobs = workflow["jobs"]
    assert jobs["preflight"].get("permissions", workflow["permissions"]) == {"contents": "read"}
    assert jobs["publish"]["permissions"] == {"contents": "write"}
    assert jobs["publish"]["needs"] == "preflight"
    assert "needs.preflight.result == 'success'" in jobs["publish"]["if"]
    assert "refs/tags/" in jobs["publish"]["if"]
    assert "continue-on-error" not in path.read_text()
    assert not any("--publish" in str(step) for step in jobs["preflight"]["steps"])
    assert not any("npm " in str(step) for step in jobs["publish"]["steps"])
    old = yaml.load((ROOT / ".github/workflows/release.yml").read_text(), Loader=yaml.BaseLoader)
    assert old["permissions"] == {"contents": "read"}
    assert "contents: write" not in (ROOT / ".github/workflows/release.yml").read_text()
