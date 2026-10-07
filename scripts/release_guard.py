"""Identidad y autorización explícita de las publicaciones del fork."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess

REPOSITORY = "theaussiepom/ListaCompra"
MAINTAINED_REF = "refs/remotes/origin/ben/tucompra"
REQUIRED_CHECKS = ("identity", "version-collision", "python-install", "npm-ci", "types", "catalogue", "node-tests", "python-tests", "ha-build", "zip")


class ReleaseError(ValueError):
    pass


def run(args, *, cwd=None):
    result = subprocess.run(args, cwd=cwd, text=True, capture_output=True)
    if result.returncode:
        raise ReleaseError(f"Command failed: {args[0]} {args[1]}: {result.stderr.strip()}")
    return result.stdout.strip()


def git(repo, *args):
    return run(["git", *args], cwd=repo)


def validate_version(version: str) -> tuple[int, int, int]:
    if not re.fullmatch(r"20\d{2}\.(?:[1-9]|1[0-2])\.[1-9]\d*", version):
        raise ReleaseError("Version must be YYYY.M.sequence (2000–2099, month 1–12, positive sequence); no v prefix or prerelease")
    return tuple(map(int, version.split(".")))


def validate_source(repo: Path, source_sha: str) -> dict:
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha):
        raise ReleaseError("Source must be an exact 40-character commit SHA")
    if git(repo, "rev-parse", "HEAD") != source_sha:
        raise ReleaseError("Source SHA does not equal the checked-out HEAD")
    if git(repo, "status", "--porcelain", "--untracked-files=all"):
        raise ReleaseError("Source checkout must be clean; commit preparation changes first")
    url = git(repo, "remote", "get-url", "origin")
    if url.removesuffix(".git").removesuffix("/") not in {
        f"https://github.com/{REPOSITORY}", f"git@github.com:{REPOSITORY}",
    }:
        raise ReleaseError("origin must be the maintained fork")
    maintained = git(repo, "rev-parse", f"{MAINTAINED_REF}^{{commit}}")
    if subprocess.run(["git", "merge-base", "--is-ancestor", maintained, source_sha], cwd=repo, capture_output=True).returncode:
        raise ReleaseError("Source does not descend from the fetched maintained fork; upstream-only main is forbidden")
    return {"source_sha": source_sha, "source_tree": git(repo, "rev-parse", "HEAD^{tree}"), "maintained_sha": maintained}


def remote_inventory(repo: Path) -> tuple[dict[str, str], list[dict]]:
    # Sólo se consulta el fork; nunca se publica desde el preflight.
    lines = git(repo, "ls-remote", "--tags", "origin").splitlines()
    tags = {}
    for line in lines:
        sha, ref = line.split()
        name = ref.removeprefix("refs/tags/")
        if name.endswith("^{}"):
            tags[name[:-3]] = sha
        elif name not in tags:
            tags[name] = sha
    pages = json.loads(run(["gh", "api", "--paginate", "--slurp", f"repos/{REPOSITORY}/releases?per_page=100"]))
    return tags, [release for page in pages for release in page]


def validate_collisions(version: str, tags: dict[str, str], releases: list[dict], *, new_tag_source: str | None = None):
    candidate = validate_version(version)
    tag = f"v{version}"
    if new_tag_source is not None and tags.get(tag) != new_tag_source:
        raise ReleaseError("The new remote tag is missing or points at another commit")
    for name in (version, tag):
        if name in tags and not (name == tag and new_tag_source is not None and tags[name] == new_tag_source):
            raise ReleaseError(f"Version/tag collision: {name}")
    for release in releases:
        name = release.get("tag_name", "")
        if name in (version, tag):
            raise ReleaseError(f"Release already exists, including draft/prerelease: {name}")
    for name in set(tags) | {r.get("tag_name", "") for r in releases}:
        bare = name.removeprefix("v")
        if bare == version:
            continue
        try:
            previous = validate_version(bare)
        except ReleaseError:
            continue
        if previous >= candidate:
            raise ReleaseError(f"Version must advance the fork sequence beyond {name}")


def validate_approval(source_sha: str, version: str, environ: dict, event: dict):
    validate_version(version)
    if environ.get("GITHUB_REPOSITORY") != REPOSITORY or environ.get("GITHUB_EVENT_NAME") != "push":
        raise ReleaseError("Publication requires a push event in the maintained fork")
    if environ.get("GITHUB_REF") != f"refs/tags/v{version}" or event.get("ref") != f"refs/tags/v{version}":
        raise ReleaseError("Event must name the exact version tag")
    if event.get("created") is not True or event.get("deleted") or event.get("forced") or event.get("before") != "0" * 40:
        raise ReleaseError("Only initial tag creation is allowed; updates, deletions and replayed pushes are rejected")
    if environ.get("FORK_RELEASE_APPROVED_SHA") != source_sha or environ.get("FORK_RELEASE_APPROVED_VERSION") != version:
        raise ReleaseError("Candidate SHA and version lack matching explicit repository approval")


def tag_context(repo: Path, source_sha: str, version: str, environ=None):
    env = dict(os.environ if environ is None else environ)
    try:
        event = json.loads(Path(env["GITHUB_EVENT_PATH"]).read_text())
    except (KeyError, OSError, ValueError) as exc:
        raise ReleaseError("Missing valid GitHub tag event") from exc
    validate_approval(source_sha, version, env, event)
    if git(repo, "rev-parse", f"refs/tags/v{version}^{{commit}}") != source_sha:
        raise ReleaseError("Tag points at the wrong source SHA")


def validate_report(report: dict, source_sha: str, version: str, expected_zip_sha: str):
    if report.get("schema") != 1 or report.get("status") != "passed" or report.get("source_sha") != source_sha or report.get("version") != version:
        raise ReleaseError("A passed report for this exact source/version is required")
    checks = report.get("checks", {})
    if any(checks.get(name) != "passed" for name in REQUIRED_CHECKS) or any(value != "passed" for value in checks.values()):
        raise ReleaseError("Publication denied after missing or failed validation")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_zip_sha) or report.get("zip_sha256") != expected_zip_sha:
        raise ReleaseError("Validated ZIP hash does not match the build job output")
    package = report.get("package", {})
    if package.get("status") != "validated" or package.get("source_sha") != source_sha or package.get("version") != version or package.get("sha256") != expected_zip_sha:
        raise ReleaseError("Package evidence does not match the validated source/version/hash")
