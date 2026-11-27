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

### Configuration

Set these environment variables before starting the OpenCode server:

| Variable | Default | Meaning |
| --- | --- | --- |
| OPENCODE_SANITIZE_DAYS | 7 | Minimum idle age in days |
| OPENCODE_SANITIZE_MAX_BYTES | 2147483648 | Soft per-directory byte threshold |
| OPENCODE_SANITIZE_MAX_FILES | 100000 | Soft per-directory file threshold |
| OPENCODE_SANITIZE_DRY_RUN | 0 | Set to 1 to report candidates without deleting |
| OPENCODE_SANITIZE_LEGACY | 0 | Set to 1 to include loose root files |

Legacy mode has no session ownership information. Enable it only with exclusive control of the host and after reviewing dry-run output. It does not recurse into unknown directories or uploads. Windows access timestamps may be disabled; age is therefore not proof that a file is unused. Locked files are skipped; Unix permits unlinking open files, so process leases are the primary protection. A long-lived server may keep projects protected until shutdown. Cleanup is best effort, not a security boundary against malicious concurrent filesystem changes.

Models treat the hint as advice; nothing prevents them from writing elsewhere.

## Install

Add to the `plugins` array in `opencode.json`, pinned to a version:

```json
{
  "plugins": ["@gfn-cis/opencode-temp-sanitize@0.3.0"]
}
```

or straight from a git tag:

```json
{
  "plugins": [
    "@gfn-cis/opencode-temp-sanitize@git+https://github.com/GFN-CIS/opencode-temp-sanitize.git#v0.3.0"
  ]
}
```

Requires OpenCode 2.

Each tag has a [GitHub Release](https://github.com/GFN-CIS/opencode-temp-sanitize/releases)
with the `npm pack` tarball, `SHA256SUMS` and a Sigstore build-provenance bundle; CI then
publishes that same tarball to npm via trusted publishing (OIDC, no tokens). Verify a
downloaded tarball with:

```sh
gh attestation verify gfn-cis-opencode-temp-sanitize-<version>.tgz --repo GFN-CIS/opencode-temp-sanitize
```

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
