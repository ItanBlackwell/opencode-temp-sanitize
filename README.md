# opencode-temp-sanitize

OpenCode 2 plugin that gives each project its own temporary directory.

## Why

OpenCode tells every model to prefer `$TMPDIR/opencode` (usually `/tmp/opencode`) over
`/tmp` for scratch files, and pre-approves it for external access. All projects and
sessions share that one directory, so it grows without bound and nobody can tell which
project left what. On hosts where `/tmp` is a size- or quota-limited tmpfs this
eventually breaks unrelated programs.

## What it does

- Creates `/tmp/opencode/<slug>` for the current project, where `<slug>` is the project
  directory relative to `$HOME` with `/` replaced by `-`, plus the CRC32 of the OpenCode
  project id: `~/work/example-app` becomes `work-example-app-1a2b3c4d`. Sessions outside
  any project use `global`.
- Rewrites the core temporary-directory hint in the system prompt to point at that
  directory, and asks models to delete files there that they or their subagents created
  once those files are certainly no longer needed. The directory stays inside the
  pre-approved tree, so no new permission prompts.
- Sets `TMPDIR`, `TEMP` and `TMP` to the same directory for shell commands the agent runs.
- Scans inactive project directories on startup and hourly, retaining files accessed or modified within seven days by default. Deletes only when automatic cleanup is enabled or a manual cleanup is confirmed.
- A process lease protects the entire project while its OpenCode plugin instance is alive. PID reuse can conservatively delay cleanup. This is not a guarantee against concurrent external writers or detached child processes.
- Never follows symlinks during normal traversal; preserves uploads, special files and active lease metadata. Failed deletions are counted in operation summaries and retried on later sweeps.
- Quotas are soft per-swept-directory warning thresholds, not hard limits. Recent files and live projects are never sacrificed to meet a quota.

### Desktop settings (0.3.11)

OpenCode Desktop 2.2+ loads the experimental GUI export from the globally configured plugin.
Open Settings > Temporary Files (localized to the active interface language). Preview uses the current valid settings, including unsaved edits, and never deletes files or writes settings. Save the policy before real manual cleanup. Unsaved previews are not added to shared cleanup history. Each cleanup parameter and the update-mode selector has a native tooltip, accessible on hover or keyboard focus. The GUI declares 63 locales matching OpenCode Desktop's current locale registry, with 57 plugin-specific keys per locale; shared actions use OpenCode's translations. Technical RPC diagnostics, file paths and project names are intentionally not translated. Translations are machine-authored and have not received native-speaker review.
The compact page shows automatic cleanup, the cleanup indicator preference, retention, storage analysis and cleanup actions. The indicator is enabled by default (including migrations) and appears only if saved automatic cleanup is off and the current saved-policy candidate snapshot contains removable entries. It uses a 28px amber (#E4AD59) trash-ring SVG in a 32px transparent button. Hover shows the count and logical byte total; clicking opens settings with the candidate list expanded and scrolled into view. A small status-only RPC is polled every five seconds and refreshed after user actions; no background scans or disk caches are created by the icon. The desktop-only DOM adapter positions the control after the Usage Dashboard button and any actual docked native update control without relocating or restyling either; when space is insufficient, it uses its own row or hides in a clipped/unknown layout. The adapter uses current host DOM slots, not a guaranteed public placement API, and disposes its observers, timer and element when disabled or unloaded. Live desktop layout should be verified with both plugins installed. Other controls, per-project statistics and history are collapsed under Advanced; storage is scanned only when Analyze is requested. The size warning is edited in GiB and stored in bytes. A single Save/Cancel toolbar appears in the native sticky page header while policy changes are pending, with a localized Unsaved changes status; it does not move when Advanced is expanded. Invalid policy values disable Save; valid unsaved edits can be previewed. Preview and real cleanup are distinct; preview remains available for a valid unsaved policy. Real cleanup is disabled while changes are unsaved and requires confirmation. Turning automatic cleanup off schedules read-only candidate scans at the same configured interval, rather than disabling the scheduler. The separate preview-only toggle is removed. Existing preview-only settings migrate to automatic cleanup off; previously active automatic deletion remains active. New installations default to scan-only. A compatibility dryRun field is written to disk for rollback, but is not part of the current UI or RPC policy. Updates remain accessible in the footer. The server reads the saved policy every 15 seconds. Settings are shared across projects on the same server.

Configuration is stored at:
- Windows: %LOCALAPPDATA%/opencode-temp-sanitize/settings.json
- Linux/macOS: $XDG_CONFIG_HOME/opencode-temp-sanitize/settings.json (or ~/.config/opencode-temp-sanitize/settings.json)

Defaults: automatic cleanup off (scheduled scans), seven days, hourly, soft 2 GiB / 100000 files per inactive project, legacy preview disabled. Legacy files are preview-only because ownership
cannot be established while the server is running. The old environment variables are no
longer used. History contains up to 50 runs in memory and resets on server restart.
Storage scans report the logical file sizes across the entire server temporary tree, including uploads, root files and unrecognized directories. The scanner does not follow symbolic links or junctions; it excludes internal lease markers and reports unreadable entries as warnings. The canonical scanned root is shown under Advanced. Storage analysis returns only aggregate totals and a snapshot identifier. The detailed Storage Overview loads at most 50 top-level entries per page, only when expanded. One inventory snapshot is retained in server memory, replaced on the next analysis and invalidated by real cleanup; navigating pages does not rescan the filesystem. The section is titled Storage Overview without a redundant Details suffix. Inventory coverage is independent of cleanup eligibility: protected projects, uploads and unrecognized directories remain outside the existing deletion scope. The storage value is displayed in the label column with the scan button in a separate padded control column. Candidate scans stream file metadata into one in-memory server snapshot, without sorting a separate preview array or transferring all paths to the renderer. The UI polls a small summary every five seconds while settings are open and clean; it requests only 50 entries per page when expanded. Select individual eligible files or a page, up to 500 per confirmed deletion request. Selection is tied to a snapshot identifier and is reset when the list changes. Changed or newly protected files are skipped, and the operation reports warnings. Legacy root files remain a separate non-deletable count. Unsaved previews can be inspected but cannot be used for deletion until their policy is saved. Selected deletion uses server-held identities, never renderer-supplied file paths, and rechecks saved policy, age, canonical ancestry, leases and file metadata before unlinking. The snapshot is held in memory, not persisted; large scans still require filesystem traversal and memory proportional to the number of candidates. Quotas warn rather than force eviction.

Build locally before installing from a directory:
```sh
npm install
npm run build
npm test
```
Add the absolute local repository directory to the global opencode.json plugins array.
The GUI bundle must exist at dist/gui-experimental.cjs. The old npm release does not contain this GUI.

Models treat the hint as advice; nothing prevents them from writing elsewhere.

## Windows Portable installation

Extract the ZIP and run Install.cmd. Like Usage Dashboard, files are installed directly under the global OpenCode plugins directory, honoring OPENCODE_CONFIG_DIR. No process detection, worker or waiting is involved. Restart OpenCode (including its server if needed) to load the new server part. If an old explicit plugin entry exists in opencode.json(c), remove it to avoid duplicates.

Update.cmd downloads stable releases from this fork, verifies SHA-256 and installs immediately. The Desktop update check distinguishes an empty public release collection from an HTTP/network failure: a 404 from /releases/latest is confirmed using the release collection endpoint before displaying No published stable release. Actual errors show a short diagnostic code. CI artifacts are not treated as releases or installed automatically. The Desktop settings Updates section offers Notify (default, daily checks), Automatic and Manual modes. Only the already-installed local updater is invoked; the GUI receives status via desktop-main IPC. Cleanup actions are gated on matching server and GUI versions. Uninstall.cmd removes the package from discovery without deleting settings; Rollback.cmd restores the latest saved payload. Existing files are backed up outside the plugins directory and restored if replacement fails. Old pending operations from the deferred installer are cancelled under its original lock. No downloaded installer is executed. The GUI can reload before the server; restart the server if versions differ. Individual replacements are atomic, not an atomic multi-file transaction. Locked files may require retrying after closing OpenCode.

## Plugin-owned data and retention

Automatic user-file cleanup is **off by default**. An existing explicit user choice is preserved. The scheduled scan may reclaim only empty, strictly recognized lease markers whose recorded owner process is confirmed dead, plus abandoned settings writes with a confirmed dead owner. Manual preview remains read-only. Ambiguous PIDs, links, unknown files and unrelated data are preserved.

- One candidate snapshot and at most 50 small operation summaries are kept in RAM, not on disk. The previous snapshot is released before a new scan; memory remains proportional to current eligible file count. Shutdown clears these structures.
- Settings and update-mode files are replaced atomically; temporary names carry the writer PID. Dead-writer debris is removed during scheduled maintenance, subsequent writes or updater startup.
- Repeated per-file errors are counted instead of emitted individually. Repeated scheduled-operation failures are logged at most hourly per manager; prompt and RPC warnings are bounded per server process. OpenCode controls retention of its own logs.
- Successful installation retains the newest two complete recognized rollback payloads. Abandoned recognized installation and pre-commit backup stages are reclaimed under the installation lock; incomplete historical recovery backups and directories containing unexpected files are deliberately preserved. Update downloads use a separate locked workspace and are reclaimed on subsequent update attempts, including after interruption. Atomic swap debris is reclaimed after a successful install.
- Empty project directories, old temp files without verifiable ownership, and legacy update downloads outside the plugin's dedicated workspace are not removed by maintenance. PID reuse may delay cleanup of orphaned markers. User-created temporary files can still grow while automatic deletion is off; this is intentional.

## Upstream dependency

The rewrite matches the exact sentence emitted by OpenCode core in
`packages/core/src/instructions/builtins.ts` (`core/environment`, verified at v2.2.6),
and assumes the shared directory is `path.join(os.tmpdir(), "opencode")` as in
`packages/util/src/global-roots.ts`. If upstream changes the wording, the plugin logs
`[temp-sanitize] tmp hint not found` once per server process and models fall back to the shared
directory. `tests/project-tmp.test.js` pins the sentence.

## Development

```sh
npm ci
npm run coverage   # vitest, 80% thresholds
npm run lint       # biome
npm run knip
```

Logic lives in `src/project-tmp.js` and `src/sweep.js`; `index.js` only wires OpenCode
hooks and the cleanup timer.

CI runs the checks above on Node 22 and 24. Also in `.github/workflows/`: CodeQL
(`security-and-quality` suite, only while the repository is public, since code scanning on
private repositories needs GitHub Advanced Security), OpenSSF Scorecard, and dependency
review on pull requests. Security reports: see [SECURITY.md](SECURITY.md).
