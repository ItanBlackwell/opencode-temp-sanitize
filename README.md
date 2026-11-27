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
- Sweeps inactive project directories on startup and hourly, retaining files accessed or modified within seven days by default.
- A process lease protects the entire project while its OpenCode plugin instance is alive. PID reuse can conservatively delay cleanup. This is not a guarantee against concurrent external writers or detached child processes.
- Never follows symlinks during normal traversal; preserves uploads, special files and lease metadata. Failed deletions are logged and retried on later sweeps.
- Quotas are soft per-swept-directory warning thresholds, not hard limits. Recent files and live projects are never sacrificed to meet a quota.

### Desktop settings (0.5.0)

OpenCode Desktop 2.2+ loads the experimental GUI export from the globally configured plugin.
Open Settings > Temporary Files. Save the policy before preview or manual cleanup.
The server reads the saved policy every 15 seconds. Settings are shared across projects on the same server.

Configuration is stored at:
- Windows: %LOCALAPPDATA%/opencode-temp-sanitize/settings.json
- Linux/macOS: $XDG_CONFIG_HOME/opencode-temp-sanitize/settings.json (or ~/.config/opencode-temp-sanitize/settings.json)

Defaults: enabled, seven days, hourly, soft 2 GiB / 100000 files per inactive project,
dry-run enabled, legacy preview disabled. Legacy files are preview-only because ownership
cannot be established while the server is running. The old environment variables are no
longer used. History contains up to 50 runs in memory and resets on server restart.
Storage scans include protected projects but cleanup excludes them. Preview samples up to
100 paths; counts cover the whole scan. Quotas warn rather than force eviction.

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

Extract the Portable ZIP and run Install.cmd. You do not have to stop OpenCode.
Install, Update, Uninstall and Rollback prepare a pending operation under
`<config root>/.temp-sanitize-install` (outside the watched plugins directory).
A detached local PowerShell worker checks for OpenCode processes and applies the
operation only when none are detected. No process is killed or restarted.
If OpenCode is already stopped the operation is applied synchronously.

The current installation remains untouched while OpenCode runs. Keep the ZIP
until activation completes; Apply.cmd retries a pending operation, Rollback.cmd
queues restoration from the newest backup. The most recently queued operation
wins. Backups and settings are retained; old staged payloads are not automatically
removed. A worker interrupted by logoff/reboot must be restarted by running
Apply.cmd after OpenCode exits. Check activation.log for errors.

Activation is best effort: process-name detection cannot identify every custom
server, and there is a small race if OpenCode starts during the directory switch.
If no idle interval is observed, the operation remains queued. Close a custom
or remote server manually before activation when applicable.

## Upstream dependency

The rewrite matches the exact sentence emitted by OpenCode core in
`packages/core/src/instructions/builtins.ts` (`core/environment`, verified at v2.2.6),
and assumes the shared directory is `path.join(os.tmpdir(), "opencode")` as in
`packages/util/src/global-roots.ts`. If upstream changes the wording, the plugin logs
`[temp-sanitize] tmp hint not found` once per session and models fall back to the shared
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
