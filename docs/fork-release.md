# Maintained fork release procedure

This procedure applies only to
[theaussiepom/ListaCompra](https://github.com/theaussiepom/ListaCompra).
It prepares an independently maintained Australian Tu Compra distribution under
the original MIT licence. It neither publishes an upstream contribution nor
changes the integration's `tucompra` domain.

**Publication is not authorized by release preparation.** No tag, draft release,
prerelease, repository setting change or Home Assistant installation is part of
the preparation task. A future operator must receive a separate instruction
before performing those actions.

## Branches and source approval

- `main` remains identical to upstream and is not an Australian release source.
- `ben/tucompra` is the maintained Australian implementation track.
- `release/fork-hacs-prep` contains the proposed fork metadata, packaging,
  validation and publication guards, based on the verified integrated fork.
- Generic `fix/`, `feature/` and `contrib/` branches remain separate from fork
  distribution changes.

Do not advance the maintained branch or reuse an older SHA implicitly. Before a
first release, separately decide how to adopt the preparation work into the
maintained release track. The release candidate is one exact, reviewed commit
containing the preparation safeguards and Australian implementation. Record its
full 40-character SHA and rerun preflight on that final clean commit.

Tag publication additionally requires these repository Actions variables:

| Variable | Required value |
| --- | --- |
| `FORK_RELEASE_APPROVED_SHA` | Exact approved candidate commit SHA |
| `FORK_RELEASE_APPROVED_VERSION` | Approved version without the `v` prefix |

Missing, stale or different values must fail the tag gates. Setting these
variables is an explicit future maintainer operation following approval; their
names alone do not authorize publication. Limit who can change them. Clear or
rotate the approved values after a completed or abandoned release.

## Close the inherited publication path before creating tags

The new `.github/workflows/fork-release.yml` validates and publishes the fork.
The old `.github/workflows/release.yml` is a read-only retirement notice on the
preparation branch. **That file change cannot protect tags pointing to older
commits:** upstream-only `main` and historical commits still contain the former
unguarded publishing workflow.

Before any `v*` tag is created, a separately authorized administrator must:

1. Locate the registered GitHub Actions workflow whose path is
   `.github/workflows/release.yml` and disable that workflow repository-wide.
   Confirm its disabled state through GitHub's workflow API or Actions UI. If
   it has not yet registered, resolve that registration and verify the workflow
   identity before relying on the control.
2. Configure tag rules for `v*` to restrict creation to the authorized release
   operator and prevent unapproved updates and deletions. Review bypass actors
   and existing inherited tags; do not grant broad bypass permissions merely to
   make a release pass.
3. Confirm the new fork release workflow is enabled and its read-only preflight
   passes on the exact intended candidate.

These settings are not changed by a local preflight or by the preparation
branch push. Until they are explicitly configured and verified, protection
against tags on historical commits remains **conditional**. Do not test the
boundary by pushing a throwaway tag: the old workflow can publish it.

The retirement workflow intentionally fails if invoked by a tag. This is a
notice, not a substitute for disabling historical executions. Branch pushes run
only its harmless notice step so the legacy workflow can be identified.

## Version proposal and ordering

The proposed first fork release is **`v2026.10.1`**, subject to separate
approval. It uses calendar year, month and a positive release sequence:

- October's next releases would be `v2026.10.2`, `v2026.10.3`, and so on.
- November's first release would be `v2026.11.1`.
- Use unpadded decimal fields. Do not use suffixes such as `-au`, `-rc` or
  `+fork`, and do not reuse an existing upstream or fork version.
- Keep versions increasing even after merging newer upstream work. The fork
  sequence is independent of upstream's `v0.3.x` numbering.

The supported numeric calendar form is compatible with HACS/AwesomeVersion
ordering; executable version tests document the accepted format and comparison
examples. The leading `v` belongs to the Git tag. The generated
`manifest.json`, package version and panel version use `2026.10.1` without it.
Packaging sets these versions in its isolated build checkout, leaving the
source checkout unchanged.

Inherited upstream tags are not published fork releases. Before accepting a
version, check both remote tags and GitHub releases, including drafts. The tag
event gate permits only the newly created tag for the approved SHA; a rerun
must not overwrite an existing release or its assets. Never force-update a tag
or push all local tags.

A rollback is an intentional selection of an older compatible fork package
and state. It is not an increasing-version update; see the
[installation and rollback guide](fork-installation.md#rollback).

## Local candidate preflight: no publishing

Use the required Node **20.20.2** and Python **3.13** runtimes. Install the pinned
Python validation dependencies from `requirements-release.txt`. Run from a
clean, committed candidate checkout, with GitHub CLI authentication available
for read-only remote collision checks:

```sh
python -m pip install -r requirements-release.txt
python scripts/release_preflight.py \
  --source-sha FULL_CANDIDATE_COMMIT_SHA \
  --version 2026.10.1 \
  --output /tmp/tucompra-release-candidate
```

Replace the SHA with the approved-to-test full commit; do not use the literal
placeholder. This command is non-publishing and does not create a tag. The
version here is a proposal to exercise preflight, not publication approval.

The script checks source identity and version/collision rules, creates an
isolated checkout, runs `npm ci`, `npm run check`, catalogue export, the Node
and Python suites, and `npm run build:ha`. It stages the runtime integration
with a byte-identical copy of the root MIT `LICENSE`, creates `tucompra.zip`,
opens and validates the archive, and writes `release-report.json` including the
source SHA and ZIP SHA-256. It requires no pre-existing generated panel or
catalogue and must stop on any install, test, build or archive failure.

The locked Astro build includes the absolute temporary checkout path in its
client-only island identifier. After building, preflight normalizes only that
development hot-reload identifier in the generated HTML using the island's
runtime attributes. It preserves every other byte. The helper requires the
reviewed Astro/Svelte adapter versions and the single empty client-only AppShell
contract, and refuses changed structure or additional identifier references.
This removes checkout-path variation without changing source files or runtime
hydration inputs. Re-review the helper when upgrading these dependencies or
changing the island structure. ZIP entry order, timestamps and permissions are
also fixed; repeat preflight in separate temporary directories to verify the
candidate archive's reproducibility under the recorded toolchain.

Archive validation checks the actual root layout, required Python and panel
files, catalogue, manifest version and original licence. It rejects development
files, caches and other unexpected distribution content. It also verifies
seven catalogues, all six original locales, and the AU totals of 1,518 products,
1,285 canonical products, 233 mirrors, 450 aliases and nine stores. Kmart, IKEA
and the deferred optional stores must remain absent.

Retain both output files together. A successful local candidate build is
evidence for that SHA and those inputs, not a GitHub release, hosted validation
or completed Home Assistant acceptance. The report identifies the exact
archive; reproducible inputs do not justify assuming the hash of an unbuilt
candidate.

## GitHub Actions validation and publication separation

The fork workflow runs a read-only preflight on pushes to
`release/fork-hacs-prep` and `ben/tucompra`. These branch runs cannot publish.
For non-tag runs, the candidate version comes from an explicit manual input,
then the optional `FORK_RELEASE_PREFLIGHT_VERSION` repository Actions variable,
then the initial proposal `2026.10.1`. Set that optional variable to the next
unused candidate version after publishing a release; otherwise later branch
preflights correctly fail the existing-version collision check. This variable
selects only a version to test and has no publication-approval meaning. Tag
runs always use the tag version and require the separate approved SHA/version
variables.

The workflow also supports non-publishing manual preflight, but GitHub's dispatch
availability depends on its default-branch workflow registration; this project
does not change upstream-only `main` to make dispatch available. Branch push
and local preflight do not depend on manual dispatch.

For a tag event, preflight receives `--tag-event` and verifies the event,
repository, exact candidate, version and approved repository variables before
the release build. The job has only `contents: read`; its GitHub token is used
for inspection, not publication. It uploads the validated ZIP and evidence as
an Actions artifact and exports the ZIP hash.

Only the publishing job has `contents: write`. It requires both a `v*` tag push
and successful preflight. It downloads the artifact from that same run,
checks out the same source SHA, and rechecks the approval, evidence and expected
ZIP digest. It does not reinstall frontend dependencies or rebuild the asset.
It then creates a draft, uploads and verifies the asset, and publishes only
after those gates succeed. A failed validation cannot fall back to another
package or publication route. A failure after draft creation may leave a draft
for investigation; it must not be reused or overwritten automatically.

`scripts/release_publish.py` defaults to a non-publishing guard check; the
explicit `--publish` flag is reserved for the gated publishing job. Controlled
failure fixtures exercise source, version, collision, missing-content and
failed-validation paths without creating real tags or releases.

## HACS selection and installation acceptance

HACS uses the fork's published release and the configured **`tucompra.zip`**
asset. The ZIP contains the integration files at archive root, including
`manifest.json`, Python modules, `catalog.json`, `panel/` and `LICENSE`;
it must not add an outer `custom_components/tucompra/` wrapper.

Fork `main` remains upstream-identical. The inspected HACS backend reads the
release's `hacs.json` after publication, so its `hide_default_branch: true`
setting can be available without editing `main`. The inspected current frontend
offers release versions and does not consume that flag; an explicit backend
request for the default branch remains possible. The flag is therefore not a
backend prohibition or proof across HACS versions. See the
[HACS implementation analysis](hacs-distribution.md) for exact refs and evidence.
Real HACS acceptance remains conditional: select a published fork release and
avoid `main`, even if a client offers it.

Before first publication, separately authorize controlled HA acceptance of the
candidate ZIP and resolve the HACS eligibility/default-branch decision. Actual
HACS download and installation of the first published release can only be
verified after that release exists; keep that acceptance step explicit rather
than claiming local packaging proves it.

Fork support metadata points to this fork. The initial documentation URL uses
`release/fork-hacs-prep`, where the guide is present; review that URL when
adopting the preparation work into the maintained release track. Do not change
protected branches merely to make a documentation URL shorter.

## Next approval gate

After a **separate instruction authorizes the first controlled release**:

1. Approve the final candidate SHA and version, the maintained-branch adoption
   decision, and the conditional HACS/HA acceptance results.
2. Disable and verify the legacy workflow, configure tag safeguards, and set the
   exact approved SHA/version Actions variables.
3. Run fresh preflight on that exact commit; review the ZIP, licence, catalogue,
   version evidence and SHA-256.
4. Only then create and push that one approved version tag. Let the guarded
   workflow build and publish; inspect the release asset and evidence.
5. Separately perform the controlled HACS installation and recovery checks, then
   record acceptance before wider rollout.

Preparation alone authorizes none of steps 1–5. Do not create a tag or release
until that separate instruction is given.
