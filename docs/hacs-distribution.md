# HACS distribution evidence

This investigation, completed on 8 October 2026, supports the fork's
[release procedure](fork-release.md) and [installation guide](fork-installation.md).
It establishes source behavior and focused local validation. It does not
establish hosted validation, rendered HACS behavior or Home Assistant acceptance.

## Which ref HACS reads

The inspected latest published HACS release was **2.0.5**, backend commit
`c0dfd8b44297c3673c21973e2539375a53687a9c`. Current backend main was
`adb7d83e33d24325535fb43b8226572405143757`.

Registration reads repository and release metadata before selecting the source
tree. The first eligible stable release supplies the available version.
`hacs.json` and the integration manifest are fetched from that selected version;
without releases, selection falls back to the repository's default branch.
An explicit selected ref can override normal selection. Refresh follows the
same release-first ordering. See the pinned
[registration and refresh code](https://github.com/hacs/integration/blob/c0dfd8b44297c3673c21973e2539375a53687a9c/custom_components/hacs/repositories/base.py#L470-L554),
[release selection](https://github.com/hacs/integration/blob/c0dfd8b44297c3673c21973e2539375a53687a9c/custom_components/hacs/repositories/base.py#L1100-L1166),
[HACS manifest fetch](https://github.com/hacs/integration/blob/c0dfd8b44297c3673c21973e2539375a53687a9c/custom_components/hacs/repositories/base.py#L715-L730),
and [version resolver](https://github.com/hacs/integration/blob/c0dfd8b44297c3673c21973e2539375a53687a9c/custom_components/hacs/repositories/base.py#L1304-L1321).

Eight local scenarios executed these actual methods from both pinned backends,
with network responses and repository models replaced by controlled fixtures:

| Scenario, repeated for each backend | Tree and manifest ref |
|---|---|
| Fresh registration without releases | `main` |
| Fresh registration with a fork release | Release tag |
| Forced refresh after publication, initially cached upstream configuration | Release tag |
| Explicit selection of `main` despite a release | `main` |

All eight passed. Decorators were omitted from the extracted methods. This was
method execution, not a running HACS instance.

## Default-branch presentation

The preparation branch sets `hide_default_branch: true`. Carry that setting into
every fork release. The ordinary post-publication paths above read it from the
release; changing upstream-identical `main` is not necessary for those paths.
Before publication, HACS reads `main`, so a release-only flag cannot protect
pre-release registration. Explicit backend requests also remain possible.

[HACS documentation](https://hacs.xyz/docs/publish/start/) describes the flag as
controlling whether the default branch is offered. Its
[integration guide](https://hacs.xyz/docs/publish/integration/) describes a
release-and-default-branch selector. However, the frontend bundled with HACS
2.0.5, version `20250128065759`, commit
`a35b1b82058052e66eae7af49350a72cc4fdac62`, lists release records only and does
not consume this flag. Current frontend commit
`d97dce047de482e6993419aa898f2267cfb5a152` behaves likewise. See the released
[selector](https://github.com/hacs/frontend/blob/a35b1b82058052e66eae7af49350a72cc4fdac62/src/components/dialogs/hacs-download-dialog.ts#L217-L257)
and [release fetch](https://github.com/hacs/frontend/blob/a35b1b82058052e66eae7af49350a72cc4fdac62/src/components/dialogs/hacs-download-dialog.ts#L339-L348).

Consequently, do not attribute that frontend's omission of `main` solely to the
flag. Treat it as presentation configuration, not download authorization.
Require a published fork release, then verify fresh registration, refresh and
version choices on the intended HACS installation. If another version requires
default-branch metadata, report that conflict before changing repository
settings. Changing the default branch or using a separate distribution
repository would require a separate decision; neither is implemented here.

## ZIP installation contract

HACS downloads the configured release asset and extracts its members directly
into `<config>/custom_components/tucompra`. Therefore `__init__.py`,
`manifest.json`, `catalog.json`, `LICENSE` and `panel/` belong at archive root.
An outer `custom_components/tucompra/` directory is incorrect.
`content_in_root: false` describes the source repository, not an extra ZIP
directory. See pinned [ZIP extraction](https://github.com/hacs/integration/blob/c0dfd8b44297c3673c21973e2539375a53687a9c/custom_components/hacs/repositories/base.py#L562-L616)
and [installation path](https://github.com/hacs/integration/blob/c0dfd8b44297c3673c21973e2539375a53687a9c/custom_components/hacs/repositories/integration.py#L35-L38).

## Version and ownership checks

The proposed first tag is `v2026.10.1`, subject to separate approval; distributed
versions omit `v`. Actual AwesomeVersion **25.8.0** execution classified both
forms as CALVER and compared them equal. All six ordering checks passed:

- `2026.10.1 > 0.3.56` and `v2026.10.1 > v0.3.56`.
- `2026.10.1 > 2026.9.9` and `2026.10.2 > 2026.10.1`.
- `2026.11.1 > 2026.10.2` and `2027.1.1 > 2026.12.9`.

Use `YYYY.M.sequence` with positive, unpadded numbers. Keep publication order
monotonic: release discovery uses GitHub's returned release order, while
[HACS version comparison](https://github.com/hacs/integration/blob/c0dfd8b44297c3673c21973e2539375a53687a9c/custom_components/hacs/utils/version.py)
determines upgrade ordering. An older version requires explicit rollback.

The actual preparation JSON files passed the extracted current HACS manifest
schema and Hassfest custom-manifest schema. Hassfest source was pinned to
`d8668bb69320af8d50182091f48fcec6699d7185`. Its
[version validator](https://github.com/home-assistant/core/blob/d8668bb69320af8d50182091f48fcec6699d7185/script/hassfest/manifest.py#L180-L196)
accepts CALVER. Its [codeowner validator](https://github.com/home-assistant/core/blob/d8668bb69320af8d50182091f48fcec6699d7185/script/hassfest/codeowners.py#L78-L115)
accepted `@theaussiepom` and rejected a negative fixture without `@`; GitHub also
confirmed the account exists.

These checks used isolated schema libraries. Helpers for absent optional
discovery fields were replaced with functions that fail if invoked; validators
for every present manifest field executed from pinned source. Full Hassfest
dependency/platform checks, the full HACS Action and real installation remain
separate validation boundaries.
