#!/usr/bin/env python3
"""Publicación separada: sólo acepta el artefacto exacto de un preflight aprobado."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request
from zipfile import ZipFile

from release_guard import (
    REPOSITORY, ReleaseError, remote_inventory, tag_context,
    validate_collisions, validate_report, validate_source, validate_version,
)


class GitHub:
    def __init__(self, token: str):
        if not token:
            raise ReleaseError("Publication token missing")
        self.token = token

    def request(self, method: str, path: str, *, data=None, binary=None):
        url = f"https://api.github.com/repos/{REPOSITORY}/{path}"
        if path.startswith("https://uploads.github.com/"):
            url = path
        headers = {"Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        body = None
        if data is not None:
            body = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
        elif binary is not None:
            body = binary
            headers["Content-Type"] = "application/octet-stream"
        with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers, method=method), timeout=120) as response:
            return json.load(response)


def inspect_artifacts(artifacts: Path, repo: Path, source_sha: str, version: str, expected_sha: str):
    report_path = artifacts / "release-report.json"
    zip_path = artifacts / "tucompra.zip"
    if report_path.is_symlink() or zip_path.is_symlink():
        raise ReleaseError("Artifacts must be regular files")
    report = json.loads(report_path.read_text())
    validate_report(report, source_sha, version, expected_sha)
    if hashlib.sha256(zip_path.read_bytes()).hexdigest() != expected_sha:
        raise ReleaseError("ZIP changed after successful preflight")
    with ZipFile(zip_path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        build = json.loads(archive.read("release-build.json"))
        if manifest.get("version") != version or build.get("version") != version or build.get("source_sha") != source_sha:
            raise ReleaseError("Packaged source/version does not match approval")
        if archive.read("LICENSE") != (repo / "LICENSE").read_bytes():
            raise ReleaseError("Packaged licence differs from approved source")
    return report


def publish_validated(api, artifacts: Path, source_sha: str, version: str, expected_sha: str, *, publish=False):
    """Sólo se invoca después de todas las comprobaciones; sin flag no hay escrituras."""
    if not publish:
        return {"status": "dry-run", "tag": f"v{version}", "source_sha": source_sha, "zip_sha256": expected_sha}
    release = api.request("POST", "releases", data={
        "tag_name": f"v{version}", "target_commitish": source_sha,
        "name": f"Tu Compra — Australian fork {version}", "draft": True, "prerelease": False,
        "body": f"Maintained Australian fork of Tu Compra.\n\nSource commit: `{source_sha}`\nZIP SHA-256: `{expected_sha}`\n\nOriginal MIT copyright and licence are included in the ZIP. See the attached validation report.",
    })
    release_id = release["id"]
    upload = release["upload_url"].split("{", 1)[0]
    expected_prefix = f"https://uploads.github.com/repos/{REPOSITORY}/releases/{release_id}/assets"
    if upload != expected_prefix:
        raise ReleaseError("Unexpected upload destination; release remains draft")
    wanted = {}
    for name in ("tucompra.zip", "release-report.json"):
        content = (artifacts / name).read_bytes()
        wanted[name] = {"sha": hashlib.sha256(content).hexdigest(), "size": len(content)}
        api.request("POST", f"{upload}?name={urllib.parse.quote(name)}", binary=content)
    assets = api.request("GET", f"releases/{release_id}/assets")
    if len(assets) != len(wanted) or {a["name"] for a in assets} != set(wanted):
        raise ReleaseError("Uploaded assets are incomplete; release remains draft")
    for asset in assets:
        expected = wanted[asset["name"]]
        if asset.get("state") != "uploaded" or asset.get("size") != expected["size"] or asset.get("digest") != f"sha256:{expected['sha']}":
            raise ReleaseError("Uploaded asset digest/size mismatch; release remains draft")
    api.request("PATCH", f"releases/{release_id}", data={"draft": False, "make_latest": "true"})
    return {"status": "published", "release_id": release_id, "source_sha": source_sha, "zip_sha256": expected_sha}


def publish_release(repo: Path, artifacts: Path, source_sha: str, version: str, expected_sha: str, *, publish=False, api=None):
    validate_version(version)
    validate_source(repo, source_sha)
    tag_context(repo, source_sha, version)
    tags, releases = remote_inventory(repo)
    validate_collisions(version, tags, releases, new_tag_source=source_sha)
    inspect_artifacts(artifacts, repo, source_sha, version, expected_sha)
    if publish and os.environ.get("GITHUB_ACTIONS") != "true":
        raise ReleaseError("Actual publishing is only permitted in the dedicated GitHub Actions job")
    if publish and api is None:
        api = GitHub(os.environ.get("GH_TOKEN", ""))
    return publish_validated(api, artifacts, source_sha, version, expected_sha, publish=publish)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--artifacts", required=True, type=Path)
    parser.add_argument("--expected-zip-sha", required=True)
    parser.add_argument("--publish", action="store_true", help="Write only after all approval, collision and artifact gates pass; default is read-only")
    args = parser.parse_args()
    try:
        result = publish_release(Path(__file__).resolve().parents[1], args.artifacts, args.source_sha, args.version, args.expected_zip_sha, publish=args.publish)
    except Exception as exc:
        parser.exit(1, f"Publication rejected: {exc}\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
