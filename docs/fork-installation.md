# Installing and restoring the Australian Tu Compra fork

This is the independently maintained Australian extension of
[Tu Compra by maestrea76](https://github.com/maestrea76/ListaCompra).
[theaussiepom/ListaCompra](https://github.com/theaussiepom/ListaCompra) maintains
and supports this fork. The software remains MIT licensed, with the original
copyright and permission notice preserved. Fork maintenance does not imply
endorsement or support from the original author.

**Current status:** no fork release has been published. Publication, Home
Assistant installation and real-device acceptance require separate approval.
These instructions prepare that future controlled acceptance; they are not a
claim that it has already happened.

## Choose the correct distribution

- Use a version published on the
  [fork's Releases page](https://github.com/theaussiepom/ListaCompra/releases)
  with an attached **`tucompra.zip`** and its release evidence.
- Fork `main` intentionally remains aligned with the original project. It does
  **not** contain this fork's Australian extension. Do not select it in HACS,
  even if it appears in the version selector.
- Inherited upstream tags, a branch checkout, GitHub's automatic source ZIP and
  a locally generated candidate ZIP are not a published fork release.
- Both projects use **`tucompra`**, with the application name **Tu Compra**.
  This fork replaces the original integration; it cannot run beside it as a
  second domain.
- Home Assistant **2024.7 or later** is required. The bundled integration icon
  requires Home Assistant **2026.3 or later** to display.

Default-branch visibility is not the acceptance criterion: confirm the selected
version exists on the fork's Releases page and includes the validated release
asset. If no such version is available, stop before downloading. Source
branches are not substitutes for a missing release.

## Before installation or upgrade

1. Take a full Home Assistant backup and verify that it is accessible outside
   the running instance. Record the HA version, current Tu Compra source
   repository, installed version and intended target release.
2. For an existing installation, keep a known-good copy of
   `custom_components/tucompra/` and the corresponding Tu Compra state from the
   same backup. HA stores that state in **`.storage/tucompra`** under its
   configuration directory. It includes share membership, list snapshots and
   the Open Food Facts lookup cache; it is not just disposable cache data.
3. Allow household clients to finish syncing, then close their Tu Compra
   panels. Record any unsynced changes before proceeding. Keep them closed
   during replacement or restoration so a client does not submit stale state.
4. Record representative existing lists, custom products, store preferences,
   share membership and their current catalogue. Include a populated shared
   list and a personal list if both are used.
5. Keep the selected release ZIP and its published SHA-256 alongside the backup.
   Verify the download hash against the release evidence before manual handling
   of the package. A backup plan needs both compatible code and state.

Do not edit `.storage/tucompra` while Home Assistant is running. Prefer HA's
supported backup/restore process. If a separately reviewed file-level restore
is needed, stop Home Assistant first and preserve file ownership and permissions.

## First installation

1. In **HACS → Custom repositories**, add
   **`https://github.com/theaussiepom/ListaCompra`** as an **Integration**.
2. Open **Tu Compra** and select a published fork version with the
   `tucompra.zip` release asset. Check the repository and version before
   downloading. Do not choose `main`.
3. Install, then restart Home Assistant as HACS requests.
4. Add the following to `configuration.yaml` if it is not already present:

   ```yaml
   tucompra:
   ```

5. Restart after a configuration change and open **Tu Compra** in the sidebar.
   Complete the verification below before accepting the installation.

Product lookup through Open Food Facts is optional. Adding
`product_lookup: true` under `tucompra:` enables it; the barcode scanner itself
does not require that setting. Keep the existing choice when replacing an
installation.

## Replacing an existing Tu Compra installation

1. Complete the backup steps before changing HACS source selection. Check
   whether HACS currently manages the original repository or this fork; the
   application name alone does not distinguish them.
2. Change the HACS repository supplying the existing `tucompra` integration to
   the fork, then select the published fork release. Follow the source-switch
   prompts for the installed HACS version. If HACS reports a duplicate
   integration or does not offer a clear source replacement, stop and resolve
   that repository selection before downloading. Do not create a second
   `custom_components` directory or rename the integration domain.
3. Preserve `configuration.yaml` and **`.storage/tucompra`**. Removing stored
   shares, resetting the application or recreating household lists is not part
   of the source switch.
4. Restart Home Assistant after the package is replaced. Verify the installed
   manifest version and repository in HACS, then open one client first.
5. Check existing list contents and catalogue identity before reconnecting the
   remaining household clients. Confirm each client's changes sync correctly.

This is a source-replacement procedure to validate during controlled HA
acceptance, not a verified UI sequence for every HACS version. The same-domain
replacement and recovery must be exercised on the intended installation.

## Verify the installation

- Confirm HACS identifies the fork and selected published version. Its version,
  the installed `manifest.json` version and the panel's visible version must
  agree after a fresh panel load. Inspect HA logs for setup, resource-loading
  and synchronization errors.
- For a **new or empty share**, HA language `en` with country `AU` selects the
  Australian catalogue. Browser-only selection uses `en-AU`. Confirm the AU
  flag and the nine starter stores: **Woolworths, Coles, ALDI, IGA, Butcher,
  Bakery, Seafood shop, Chemist Warehouse and Bunnings**. Kmart, IKEA and the
  deferred optional stores are not seeded.
- The release catalogue contains **1,518 AU products: 1,285 canonical products
  and 233 mirrors**, with **450 runtime aliases**. These are catalogue totals,
  not the number visible in every filtered store view. The original six
  catalogues remain included.
- A populated or explicitly pinned share retains its catalogue and product
  IDs. In particular, an existing UK-backed share remains UK-backed when HA's
  country or the display language changes. There is no automatic UK-to-AU
  migration. Do not delete a working share to force AU selection.
- Verify existing item quantities, checked state, custom products, store
  choices and share membership. Add a reversible test item, confirm it on a
  second authorized client, remove it and verify the removal syncs.
- In a fresh AU share, supermarket routing is intentionally ambiguous until a
  default is chosen: the four supermarket stores do not imply a preference.
  Check Inbox routing and then an explicitly selected default.
- Test the intended HA browser/Companion devices, including iPhone barcode
  scanning, native or bundled WASM scanning as applicable, manual barcode
  entry, camera switching and torch support where available. If Open Food
  Facts is enabled, verify lookup separately from camera decoding.

Local automated tests and a valid release ZIP do not establish real-device
acceptance. Record the actual HA, HACS, browser and device versions and results.

## Rollback

1. Close Tu Compra on all household clients and preserve a backup of the failed
   state for investigation. Record any changes made since the pre-upgrade
   backup; restoring that backup may lose those later edits.
2. Select the known-good **published fork release** in HACS if it is available,
   or restore the matching backed-up integration package through the planned
   recovery procedure. HACS update ordering does not itself perform a rollback.
   Do not select upstream-only `main` as a recovery version for AU data.
3. Restore **compatible state** with that code. Prefer the corresponding full
   HA backup. A code downgrade alone does not undo persisted `catalogLocale`,
   retained catalogue references, synchronization state or AU product IDs.
   Returning to upstream code is a separate compatibility decision, not an
   interchangeable version choice.
4. Start Home Assistant and inspect logs before reopening one client. Make sure
   the panel resources belong to the restored version; reload stale browser
   resources as needed. Do not clear client storage without preserving any
   unsynced changes first.
5. Verify restored versions, share membership, list data, catalogue pinning and
   a two-client sync cycle. Reconnect other clients only after confirming the
   restored server state. A successful restart alone does not verify recovery.

### Open Food Facts cache downgrade

This fork stores language-neutral **version 2** lookup records in
`lookup_cache` inside `.storage/tucompra`, with a `names` map. Older code may
expect a single localized `name` instead. It can read the record as a cached
result without producing a usable product name.

Restore the cache from the matching known-good backup when downgrading. If a
cache-only reset is chosen instead, it needs a backed-up, stopped-instance
procedure that affects only `lookup_cache`, preserves `shares`, and verifies
fresh lookups after restart. Never delete `.storage/tucompra` to clear lookup
cache: that also deletes shared-list state. Resetting the cache does not resolve
any other catalogue or synchronization downgrade incompatibility.

## Support and attribution

Report fork-specific problems to
[theaussiepom/ListaCompra issues](https://github.com/theaussiepom/ListaCompra/issues).
Include the published version, HA/HACS versions, device details, reproduction
steps and sanitized logs. Do not post credentials, access tokens or private
share-storage dumps.

The [original project](https://github.com/maestrea76/ListaCompra) remains credited
under its MIT licence: **Copyright (c) 2026 maestrea76**. The unchanged original
licence is included in `tucompra.zip`. The
[upstream browser demo](https://maestrea76.github.io/ListaCompra/) does not
necessarily show the Australian features in this maintained fork.
