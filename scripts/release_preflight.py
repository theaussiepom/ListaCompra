#!/usr/bin/env python3
"""Construye y valida un candidato exacto sin publicar ni cambiar referencias."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

from release_guard import (
    ReleaseError, git, remote_inventory, tag_context,
    validate_collisions, validate_source, validate_version,
)
from release_package import package


def execute_checks(root: Path, output: Path, python: str, report: dict, runner=subprocess.run):
    env = dict(os.environ, ASTRO_TELEMETRY_DISABLED="1", PYTHONDONTWRITEBYTECODE="1")
    env.pop("GITHUB_PAGES", None)
    env.pop("HA_PANEL", None)
    commands = [
        ("npm-ci", ["npm", "ci"]),
        ("types", ["npm", "run", "check"]),
        ("catalogue", ["npm", "run", "export:catalog"]),
        ("node-tests", ["node", "--import", "tsx", "--test", *[str(p.relative_to(root)) for p in sorted((root / "tests").glob("*.test.mjs"))]]),
        ("python-tests", [python, "-m", "pytest", "tests/", "-q"]),
        ("ha-build", ["npm", "run", "build:ha"]),
    ]
    if len(commands[3][1]) == 4:
        raise ReleaseError("Candidate has no frontend regression tests")
    for name, command in commands:
        log = output / f"{name}.log"
        print(f"Validating {name}…", flush=True)
        with log.open("w") as stream:
            result = runner(command, cwd=root, env=env, stdout=stream, stderr=subprocess.STDOUT)
        report["checks"][name] = "passed" if result.returncode == 0 else "failed"
        if result.returncode:
            raise ReleaseError(f"{name} failed; see {log}")


def stage_version(root: Path, version: str):
    for relative in ("custom_components/tucompra/manifest.json", "package.json", "package-lock.json"):
        path = root / relative
        data = json.loads(path.read_text())
        data["version"] = version
        if relative == "package-lock.json":
            data["packages"][""]["version"] = version
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def preflight(repo: Path, source_sha: str, version: str, output: Path, *, tag_event=False):
    validate_version(version)
    identity = validate_source(repo, source_sha)
    output = output.resolve()
    if output == repo or repo in output.parents:
        raise ReleaseError("Output must be outside the source checkout")
    if output.exists() and any(output.iterdir()):
        raise ReleaseError("Output directory must be new or empty; stale evidence cannot be reused")
    output.mkdir(parents=True, exist_ok=True)
    report = {"schema": 1, "status": "failed", **identity, "version": version, "checks": {}, "publishing": False}
    try:
        if sys.version_info[:2] != (3, 13):
            raise ReleaseError("Release preflight requires Python 3.13")
        node = subprocess.check_output(["node", "--version"], text=True).strip()
        if node != "v20.20.2":
            raise ReleaseError("Release preflight requires Node 20.20.2")
        report["runtime"] = {"node": node, "python": sys.version.split()[0]}
        live = git(repo, "ls-remote", "origin", "refs/heads/ben/tucompra").split()
        if not live or live[0] != identity["maintained_sha"]:
            raise ReleaseError("Fetch the current maintained fork before preflight")
        if tag_event:
            tag_context(repo, source_sha, version)
        tags, releases = remote_inventory(repo)
        local_tags = {name: git(repo, "rev-parse", f"refs/tags/{name}^{{commit}}") for name in git(repo, "tag", "--list").splitlines()}
        validate_collisions(version, local_tags, [], new_tag_source=source_sha if tag_event else None)
        validate_collisions(version, tags, releases, new_tag_source=source_sha if tag_event else None)
        report["checks"]["identity"] = "passed"
        report["checks"]["version-collision"] = "passed"
        with tempfile.TemporaryDirectory(prefix="tucompra-preflight-") as work:
            temp = Path(work)
            snapshot = temp / "source"
            snapshot.mkdir()
            archive = temp / "source.tar"
            subprocess.run(["git", "archive", "--format=tar", "--output", str(archive), source_sha], cwd=repo, check=True)
            with tarfile.open(archive) as source:
                source.extractall(snapshot, filter="data")
            stage_version(snapshot, version)
            lock_before = hashlib.sha256((snapshot / "package-lock.json").read_bytes()).hexdigest()
            venv = temp / "venv"
            subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
            python = str(venv / "bin/python")
            with (output / "python-install.log").open("w") as log:
                subprocess.run([python, "-m", "pip", "install", "-r", str(snapshot / "requirements-release.txt")], stdout=log, stderr=subprocess.STDOUT, check=True)
            report["checks"]["python-install"] = "passed"
            execute_checks(snapshot, output, python, report)
            if hashlib.sha256((snapshot / "package-lock.json").read_bytes()).hexdigest() != lock_before:
                raise ReleaseError("Locked dependency installation/build changed package-lock.json")
            # Las cachés sólo pertenecen a esta copia temporal generada.
            for cache in (snapshot / "custom_components/tucompra").rglob("__pycache__"):
                shutil.rmtree(cache)
            package_report = package(snapshot, output / "tucompra.zip", version, source_sha)
            report["package"] = package_report
            report["zip_sha256"] = hashlib.sha256((output / "tucompra.zip").read_bytes()).hexdigest()
            report["checks"]["zip"] = "passed"
            report["status"] = "passed"
        return report
    except Exception as exc:
        report["error"] = str(exc)
        (output / "tucompra.zip").unlink(missing_ok=True)
        raise
    finally:
        (output / "release-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--tag-event", action="store_true", help="Require explicit repository approval and a newly created matching tag; never publishes")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    try:
        report = preflight(repo, args.source_sha, args.version, args.output, tag_event=args.tag_event)
    except Exception as exc:
        parser.exit(1, f"Preflight rejected: {exc}\n")
    print(json.dumps({k: report[k] for k in ("status", "source_sha", "version", "zip_sha256")}, indent=2))


if __name__ == "__main__":
    main()
