# Temp Sanitize for OpenCode

**Per-project temporary storage, safe cleanup, and a compact Desktop interface.**

OpenCode agents can create large amounts of temporary data in a shared `opencode` directory. Temp Sanitize separates that workspace by project, identifies stale files, and lets you decide when to reclaim space without treating every temporary file as disposable.

> **Automatic cleanup is off by default.** On a fresh installation, the plugin periodically checks for cleanup candidates without deleting project data. Enable automatic cleanup only if you want it to remove eligible files unattended.

[Stable releases](https://github.com/ItanBlackwell/opencode-temp-sanitize/releases) · [Windows test builds](https://github.com/ItanBlackwell/opencode-temp-sanitize/actions/workflows/portable-ci.yml) · [Report an issue](https://github.com/ItanBlackwell/opencode-temp-sanitize/issues)

## Features

- **Project isolation:** a dedicated temporary directory for each OpenCode project and its shell commands.
- **Safe scheduled cleanup:** configurable retention, periodic scans, and protection for active projects.
- **Manual control:** preview the current settings, select individual files or entire pages, and confirm deletion.
- **Storage overview:** total logical size and file counts across the OpenCode temporary tree, with paginated directory statistics.
- **Cleanup indicator:** a compact amber trash icon in the lower-left Desktop area, compatible by design with [Usage Dashboard](https://github.com/ItanBlackwell/usage-dashboard).
- **Native settings:** compact controls, contextual help, a sticky Save/Cancel toolbar, and translations for all 63 supported Desktop locales.
- **Portable Windows installation:** direct install, update, uninstall, and rollback commands; no permanently running installer worker.

## Requirements and installation

- OpenCode 2.2 or later with the experimental GUI and plugin RPC APIs for the full Desktop experience.
- Windows is the supported portable installer target. The server-side JavaScript is intended to be cross-platform; the Windows installer and Desktop updater do not run on Linux or macOS.
- For source builds, Node.js 24 is recommended (package minimum: 22.12) and Python 3 is required to create the portable ZIP.

### Windows (recommended)

1. Download `Temp-Sanitize-Portable-<version>.zip` from [Releases](https://github.com/ItanBlackwell/opencode-temp-sanitize/releases). If no stable release has been published yet, open a successful [Portable test build](https://github.com/ItanBlackwell/opencode-temp-sanitize/actions/workflows/portable-ci.yml) and download its `Temp-Sanitize-test-build` artifact. The artifact contains the portable ZIP and `SHA256SUMS.txt`.
2. Optionally verify the portable ZIP against the supplied SHA-256 checksum.
3. Extract the portable ZIP, then run `Install.cmd` inside the extracted `Temp-Sanitize` directory.
4. Restart OpenCode Desktop, including its server process if necessary.
5. Open **Settings → Temporary Files** (translated according to your interface language).

The installer places the bundled plugin under `%USERPROFILE%\.config\opencode\plugins\opencode-temp-sanitize`, or under `OPENCODE_CONFIG_DIR\plugins\opencode-temp-sanitize` if that environment variable is configured. No separate Node.js dependency installation is required for the portable package. Remove any older explicit reference to this plugin in `opencode.json` or `opencode.jsonc` to avoid loading it twice.

To verify a downloaded ZIP in PowerShell:

```powershell
Get-FileHash .\Temp-Sanitize-Portable-0.3.11.zip -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Compare the computed hash with the entry for the same ZIP filename.

| Command | Purpose |
| --- | --- |
| `Install.cmd` | Install or replace the local plugin; preserve saved settings. |
| `Update.cmd` | Download and verify a newer stable release from this fork. |
| `Uninstall.cmd` | Remove the plugin from discovery while retaining settings and a recovery copy. |
| `Rollback.cmd` | Restore the latest saved installation payload. |

These commands do not stop OpenCode. Close the application and retry if Windows reports locked files. Restart after installation, update, rollback, or removal.

### Build and install from source

```sh
git clone -b safe-cleanup https://github.com/ItanBlackwell/opencode-temp-sanitize.git
cd opencode-temp-sanitize
npm install
npm run build
```

To build the portable Windows package, run `npm run portable`. The ZIP and its checksum are written to `release/`.

For a local source installation, use the absolute path to the built repository in the global OpenCode configuration's `plugins` array, for example:

```json
{
  "plugins": ["C:/dev/opencode-temp-sanitize"]
}
```

Use the correct path for your machine and keep any existing plugin entries. The repository must contain the built `dist/gui-experimental.cjs` for Desktop settings. Do not install the old upstream npm release expecting the extended features documented here; this fork is distributed as a portable package or built from source.

## Using Temp Sanitize

### Cleanup modes

| Automatic cleanup | Scheduled behavior |
| --- | --- |
| Off (default) | Discover eligible files and refresh the candidate list; do not delete project data. |
| On | Find and remove eligible files using the saved cleanup policy. |

The first scheduled operation runs on startup. Both modes use the same configured interval; the scheduler checks whether an operation is due approximately every 15 seconds while the server runs. The plugin also performs narrowly scoped maintenance of its own abandoned metadata, independently of the automatic cleanup switch.

### Preview and manual cleanup

1. Adjust **Keep unused files (days)** and any advanced cleanup settings.
2. Click **Preview cleanup** to see candidates using the currently entered, valid settings, even before saving.
3. Review the number of candidates, their combined logical size, and individual paths. Open the list to inspect 50 entries at a time.
4. Save the settings before deleting files. Select individual entries or the current page, then click **Clean selected** and confirm. Alternatively, use **Clean now** and confirm to run the complete saved cleanup policy.

You can select files across pages, up to 500 per confirmed selection. A refreshed candidate snapshot resets selection to prevent stale IDs from targeting a different file. Previewing unsaved settings does not persist them or perform deletion. Invalid settings block preview/save; real deletion is disabled while the settings have unsaved changes.

> **Deletion is permanent, not a move to the Recycle Bin.** Installation rollback restores plugin files, not deleted temporary data. Always review candidates before enabling automatic deletion or confirming manual cleanup.

### Cleanup indicator

The sidebar indicator is an amber (`#E4AD59`) ring with a theme-aware trash glyph, rendered at 28 × 28 px in a transparent 32 × 32 px button.

It is visible only when all of the following conditions hold:

- **Show cleanup indicator** is enabled (default).
- Automatic cleanup is off in the saved settings.
- The current candidate snapshot matches the saved cleanup policy and contains files eligible for deletion.

Hover over the icon to see the number of files and their total logical size. Click it to open the plugin settings, expand the candidate list, and navigate to that section. The icon itself never deletes files.

The indicator uses a small status-only RPC every five seconds, with additional refreshes after relevant user actions. It does not scan the disk, load the full candidate list, or create a persistent cache. It hides when the conditions are no longer met.

When Usage Dashboard is installed, Temp Sanitize attempts to align after its indicator and the docked native OpenCode update control without changing their nodes or styles. If the sidebar is too narrow, it uses a separate row where possible or hides when the layout cannot be safely identified. The integration uses current Desktop DOM slots rather than a guaranteed public placement API, so compatibility must be checked after OpenCode layout changes.

### Storage Overview

Click **Analyze** to measure the entire temporary directory of the server running the plugin. The summary includes regular file sizes in the root, project directories, uploads, and other recognized or unrecognized subdirectories. Internal lease markers are excluded; symbolic links and junctions are not traversed.

Open **Advanced → Storage Overview** for top-level directory statistics, including file count, size, protection status, and scan warnings. Only 50 rows are loaded per page, and changing pages does not repeat the filesystem scan. The actual canonical root path is shown under Advanced.

The scanned size is a logical file-size total, not physical allocated disk space. It can differ from Windows Explorer because of filesystem allocation, inaccessible files, links, or files changing during analysis. **Total storage is not the same as reclaimable storage.** The cleanup candidate list intentionally excludes protected or unowned data.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| Automatic cleanup | Off | Delete eligible files automatically, or only scan for candidates when off. |
| Show cleanup indicator | On | Show the sidebar notification when manual cleanup is available. |
| Keep unused files (days) | 7 | Age threshold based on last access or modification. Range: 1–3650 days. |
| Check interval (minutes) | 60 | Shared interval for both scheduled modes. Range: 1–1440 minutes. |
| Size warning (GiB) | 2 | Soft size threshold per swept project, not a hard quota. |
| File count warning | 100,000 | Soft file-count threshold per swept project. |
| Legacy preview | Off | Include a separate read-only count of stale loose files in the shared root. |
| Update mode | Notify | Check daily for new stable releases without automatically installing them. |

Advanced settings are collapsed by default. The Save and Cancel buttons appear in the sticky page header when the cleanup policy changes. Each setting has a hover/focus tooltip. Update mode is stored separately and takes effect when changed.

Settings are shared by projects using the same server-side configuration. The cleanup policy is stored in:

| Platform | Path |
| --- | --- |
| Windows | `%LOCALAPPDATA%\opencode-temp-sanitize\settings.json` |
| Linux / macOS | `$XDG_CONFIG_HOME/opencode-temp-sanitize/settings.json`, or `~/.config/opencode-temp-sanitize/settings.json` |

Windows updater preferences are stored in `.temp-sanitize-install\update-mode.json` under the OpenCode configuration directory.

Existing settings are preserved during an upgrade. Older preview-only policies migrate to automatic cleanup off; the new indicator preference defaults to on if it was absent. Previously enabled automatic deletion is preserved. A compatibility `dryRun` field remains in the saved JSON for older versions but is no longer a separate UI or RPC setting.

## Cleanup scope and safeguards

The shared root is the canonical form of `path.join(os.tmpdir(), "opencode")`, typically `%TEMP%\opencode` on Windows or `/tmp/opencode` on Linux. The plugin creates a readable per-project subdirectory with an eight-digit CRC32 suffix derived from the project ID. Sessions without a project use `global`.

The plugin rewrites OpenCode's temporary-directory instruction and sets `TMPDIR`, `TEMP`, and `TMP` for agent shell commands. These changes guide agents and their tools toward the project workspace; they are **not a filesystem sandbox** and do not prevent software from writing elsewhere.

Cleanup is intentionally conservative:

- Only recognized project directories are swept. Loose root files and unrelated directories remain outside the deletion scope.
- A live process lease protects the entire project directory, even if its files are old. PID reuse or an ambiguous process check may delay cleanup.
- Eligible files must be older than the saved retention period according to both access and modification time. Recent files are retained even when a warning threshold is exceeded.
- Uploads, active lease metadata and special filesystem objects are excluded. Symbolic links and junctions are not followed; eligible link entries may be removed without removing their targets.
- Selected deletion accepts server-issued snapshot IDs and entry IDs rather than arbitrary paths. It rechecks the saved policy, path ancestry, file identity/metadata, age and project leases before unlinking.
- Missing, changed, locked or newly protected files are skipped or reported as warnings. Full cleanup may remove empty nested directories but keeps project roots.

Filesystem checks reduce accidental deletion risks but cannot guarantee safety against concurrent external writers, detached child processes, or changes between validation and deletion. Soft quotas report warnings rather than force eviction. Files in active or unrelated directories can therefore continue to occupy substantial space.

## Performance and the plugin's own footprint

- Candidate and storage inventories use separate single snapshots in server RAM. New scans replace previous snapshots; real cleanup invalidates the storage inventory.
- Both detailed lists are paginated on the server (50 rows). The renderer receives aggregate summaries and requested pages, not the complete file tree.
- The history is limited to 50 small in-memory records. Candidate paths and historical inventories are not saved to disk. Shutdown clears these structures.
- Scans still require filesystem traversal, and candidate memory grows with the current number of eligible files. Pagination reduces renderer and RPC load, not the total cost of inventorying a large tree.
- Settings are written atomically. Strictly recognized orphaned settings writes and empty lease markers with confirmed dead process owners are reclaimed conservatively.
- The installer normally retains two complete recognized rollback payloads and reclaims abandoned owned staging files. Unknown files, incomplete historical recovery backups and unsafe paths are preserved rather than blindly deleted.
- Update downloads are isolated in a locked workspace and recovered on subsequent update attempts. Repeated diagnostics are bounded; OpenCode manages retention of its own logs.

The plugin does not install a separate service or keep historical scan databases. Empty project roots and old debris whose ownership cannot be established may remain. With automatic cleanup off, temporary files created by agents can still accumulate until you choose to remove them.

## Updates and recovery

The Desktop **Updates** section supports Notify (default, daily checks), Automatic (install a newer stable release), and Manual (check on demand). The **Check** button can also be used on demand.

The updater checks stable GitHub Releases from `ItanBlackwell/opencode-temp-sanitize`. It expects a matching versioned portable ZIP and `SHA256SUMS.txt`, validates the asset metadata, and verifies the archive before installing through the existing local updater script. CI artifacts and source tags without release assets are not installed automatically.

If the repository has no published stable release, the update checker displays **No published stable release**, rather than treating that condition as a failed network request. Actual failures include a short diagnostic code such as `HTTP 403`, `NETWORK`, `IPC`, or `INVALID_ASSETS`.

Installation and rollback preserve the cleanup settings. Replacements are atomic per file, not across the entire package; the installer attempts to restore affected files if replacement fails. A restart is required to synchronize the GUI and server versions. Cleanup actions are version-gated.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Settings page is missing | Use a compatible OpenCode Desktop version, install the built portable package, remove duplicate references, and restart the server. |
| RPC or version mismatch | Restart both Desktop and its server so the GUI and server bundles match. |
| Storage is large but preview is small | Inspect the Storage Overview; active projects, uploads, legacy files and unrecognized directories are not automatically eligible. |
| Cleanup icon is missing | Save the indicator preference, turn automatic cleanup off, and run a preview with the saved policy. Check that there are selectable candidates and a supported visible Desktop layout. |
| Update check shows no releases | Use the successful Portable CI ZIP until a stable release is published. |
| Update request fails | Check the diagnostic code and connectivity to GitHub; retry or install a verified ZIP manually. |

## Development

```sh
npm install
npm run build
npm test
npm run coverage
npm run lint
npm run knip
npm run portable
```

| Module | Responsibility |
| --- | --- |
| [`index.js`](index.js), [`src/project-tmp.js`](src/project-tmp.js) | OpenCode hooks, temporary directory routing, and process leases. |
| [`src/manager.js`](src/manager.js), [`src/settings.js`](src/settings.js) | Scheduling, saved policy, snapshots and bounded history. |
| [`src/sweep.js`](src/sweep.js), [`src/candidates.js`](src/candidates.js) | Safe candidate discovery, full cleanup, selection and validation. |
| [`src/storage-scan.js`](src/storage-scan.js) | Full read-only storage inventory. |
| [`src/rpc.js`](src/rpc.js), [`src/gui.jsx`](src/gui.jsx) | Server API and Desktop settings. |
| [`src/sidebar-indicator.js`](src/sidebar-indicator.js) | Indicator graphic, layout integration and lifecycle. |
| [`src/desktop-updater.js`](src/desktop-updater.js), [`installer/`](installer/) | Desktop update checks and portable installation/recovery. |
| [`src/i18n.js`](src/i18n.js), `src/i18n-*.js` | Plugin localization dictionaries for 63 locales (machine-authored; not native-speaker reviewed). |

The [Portable test build](https://github.com/ItanBlackwell/opencode-temp-sanitize/actions/workflows/portable-ci.yml) runs targeted regression tests, bundles both plugin entry points, checks the packaged server RPC and exercises the Windows installer. The wider repository also runs separate test, dependency-review and CodeQL workflows. A passing portable build does not imply that every repository-wide check passes, or that the live Desktop GUI has been visually validated.

### Upstream compatibility

The instruction rewrite depends on OpenCode's `core/environment` wording in `packages/core/src/instructions/builtins.ts` (originally verified against v2.2.6) and the shared root from `packages/util/src/global-roots.ts`. If that wording changes, the plugin logs a bounded warning and the model may continue to use the shared directory. The Desktop indicator depends on experimental GUI APIs and current sidebar markup.

## License and credits

MIT. See [LICENSE](LICENSE).

Based on the original [GFN-CIS/opencode-temp-sanitize](https://github.com/GFN-CIS/opencode-temp-sanitize), copyright © 2026 GFN-CIS. This fork extends the project with safe cleanup policies, Desktop controls, storage analysis, selective cleanup, localization, a portable installer and the sidebar indicator.

For vulnerabilities, avoid posting sensitive details publicly; see [SECURITY.md](SECURITY.md).
