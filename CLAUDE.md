# kimi-plugin-cc — Project Context

## Overview

`kimi-plugin-cc` is a Claude Code plugin that bridges Claude Code and the Kimi CLI, enabling users to:

1. **Review code** with Kimi (standard or adversarial)
2. **Explore codebases** read-only before making changes
3. **Delegate tasks** to Kimi for execution
4. **Generate plans** before implementation
5. **Manage background jobs** with status/result/cancel

## Architecture

```
Claude Code  ──►  slash command  ──►  broker.mjs  ──►  kimi CLI
                    (.md file)         (Node.js)        (local process)
```

The plugin is a Node.js application with a central broker that:
- Parses CLI arguments
- Dispatches to the appropriate lib module
- Manages session state in `~/.kimi-plugin-cc/`
- Captures diffs via git
- Returns structured JSON to Claude Code

## Key Files

| File | Purpose |
|------|---------|
| `plugins/kimi/scripts/broker.mjs` | Central entry point, argument parsing, dispatch |
| `plugins/kimi/scripts/lib/kimi.mjs` | Wraps the `kimi` CLI (kimi-code) with watchdogs and JSONL capture |
| `plugins/kimi/scripts/lib/kimi-home.mjs` | Invocation policy: binary resolution, read-only enforcement, ephemeral `KIMI_CODE_HOME` |
| `plugins/kimi/scripts/lib/snapshot.mjs` | Filesystem isolation: snapshot workspace (HEAD + uncommitted diff + untracked) for read-only runs |
| `plugins/kimi/scripts/lib/state.mjs` | Session metadata persistence |
| `plugins/kimi/scripts/lib/git.mjs` | Diff capture and git operations |
| `plugins/kimi/scripts/lib/workspace.mjs` | Repo root detection, session tracking per repo |
| `plugins/kimi/scripts/lib/job-control.mjs` | Background job spawning and cancellation |
| `plugins/kimi/scripts/lib/render.mjs` | Markdown formatting for review/explore output |

## Agent Security Model

The plugin targets **kimi-code** (TypeScript CLI, >= 0.26.0), which has no
`--agent-file`. The legacy agent-file *path* is kept as the policy selector the
slash commands pass to the broker; `kimi-home.mjs` maps it to a policy:

| Agent file | Policy | Use Case |
|-----------|--------|----------|
| `coder.yaml` / `coder-sub.yaml` | Full access under the user's real `KIMI_CODE_HOME` | Task execution (`/kimi:crank`) |
| anything else (`explore.yaml`, `plan-sub.yaml`, unknown) | **Read-only, fail-closed** | Reviews, exploration, planning |

Read-only runs use an ephemeral `KIMI_CODE_HOME` (user config + one deny rule
`pattern = "!{Read,Grep,Glob,ReadMediaFile}"`, credentials symlinked, empty
`--skills-dir`). Deny rules are the only hard gate in `-p` mode — see
SECURITY.md. NEVER use extglob `!(...)` in a permission pattern: the DSL splits
on the first `(` and the rule silently matches nothing (fail-open).

On top of the deny rule, read-only runs execute in a **snapshot workspace**
(`snapshot.mjs`: `git archive HEAD` + uncommitted diff + untracked files,
gitignored files absent, no `.git`) outside the repo, with `GIT_DIR`/`GIT_WORK_TREE`/…
stripped from the child env. Writes physically cannot reach the working tree.
Non-git dirs degrade to in-place (deny rules only), recorded as
`meta.isolation: "in-place"`.

## Session Model

- Sessions are stored in `~/.kimi-plugin-cc/sessions/<uuid>/`
- Each session has: `meta.json`, `output.jsonl`, `kimi.log`, `pid`
- The latest session per repo is tracked in `.kimi/.session`
- Background jobs are detached processes with PID files

## Configuration

- kimi-code user config: `~/.kimi-code/config.toml` (or `$KIMI_CODE_HOME/config.toml`)
- Read-only runs: ephemeral home at `~/.kimi-plugin-cc/kimi-home-readonly/`, regenerated from the user config on every spawn
- Plugin data: `~/.kimi-plugin-cc/` (or `KIMI_PLUGIN_DATA` env var)

### Runtime env contract

| Env var | Default | Effect |
|---------|---------|--------|
| `KIMI_PLUGIN_DATA` | `~/.kimi-plugin-cc/` | Root dir for session state |
| `KIMI_BIN` | `kimi` on PATH, else `~/.kimi-code/bin/kimi` | kimi-code binary override |
| `KIMI_CODE_USER_HOME` | `$KIMI_CODE_HOME` or `~/.kimi-code` | Where the user's real config/credentials are read from when building the read-only home |
| `KIMI_DISPATCH_TIMEOUT_MS` | `1800000` (30m) | Hard wall-clock timeout per crank (`runOnce` foreground). On expiry: SIGTERM, then SIGKILL after 2s. |
| `KIMI_IDLE_TIMEOUT_MS` | `300000` (5m) | Idle-output watchdog (foreground `runOnce` and detached background spawn). Kills a crank that stops emitting output. |
| `KIMI_ALLOW_SECRETS` | unset | Set to `1` to override the secret-scan preflight (not recommended) |
| `KIMI_KEEP_SNAPSHOT` | unset | Set to `1` to keep the read-only snapshot workspace after a run (debugging) |

A timeout is **terminal** and resolves with the internal sentinel `TIMEOUT_EXIT_CODE` (124), surfacing to the supervisor as broker exit code **6** with `status: failed`, `reason: timeout`, `committed: false`. There is no retry loop: kimi-code handles transient provider errors internally (stream-json `meta turn.step.retrying` lines); the legacy exit-75 retry contract is gone. kimi-code `-p` itself has **no** built-in timeout, so these watchdogs are the only bound on a hung run.

### Broker exit codes (`dispatch`)

| Code | Meaning |
|------|---------|
| 0 | ok / dispatched |
| 2 | origin-diverged |
| 3 | buggy-evals |
| 4 | review-pause (plan/diff review or api-validation concern) |
| 5 | checkpoint-conflict |
| 6 | timeout (wall-clock or idle-output watchdog killed a hung crank) |

## Testing

- Unit tests: `npm test` (Node.js built-in test runner)
- Smoke tests: `npm run smoke` (end-to-end with temp git repo)
- CI: GitHub Actions on push/PR to main

## Release Checklist

1. Update version in `package.json`, `marketplace.json`, `plugin.json`
2. Add release notes to `CHANGELOG.md`
3. Run `npm test && npm run smoke`
4. Commit, tag, push
