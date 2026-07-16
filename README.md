# Kimi plugin for Claude Code

> [!IMPORTANT]
> **This is the [limeflash](https://github.com/limeflash/kimi-plugin-cc) fork — ported to [kimi-code](https://github.com/MoonshotAI/kimi-code), the actively maintained TypeScript CLI.**
> The upstream plugin targets the legacy Python `kimi-cli`, which is deprecated and frozen. This fork does **not** use or support the legacy CLI at all — there is no `--agent-file`, no `--print`, no `pip install`. If you have the old Python `kimi-cli` installed, run `kimi migrate` from kimi-code and remove it.
>
> On top of the port, this fork adds a hardened security model (three independent barriers around read-only commands), truly non-blocking background jobs, and a number of bug fixes. See [How this fork differs](#how-this-fork-differs-from-upstream). Upstream: [luanmorenommaciel/kimi-plugin-cc](https://github.com/luanmorenommaciel/kimi-plugin-cc).

Use [Kimi](https://www.kimi.com/code/) from inside Claude Code for code reviews, codebase exploration, or to delegate tasks to Kimi — without leaving the workflow you already have.

## What You Get

- `/kimi:review` — a read-only code review of your uncommitted changes or a branch diff
- `/kimi:challenge` — a steerable adversarial review that questions your design
- `/kimi:explore` — read-only codebase exploration and architecture analysis
- `/kimi:plan` — a structured implementation plan (read-only, pure planning)
- `/kimi:crank` — delegate a task file (`tasks/T-*.md`) or a free-form task to Kimi for execution
- `/kimi:status`, `/kimi:result`, `/kimi:cancel` — manage background jobs
- `/kimi:setup` — verify install, auth, config, and toggles

## How this fork differs from upstream

| Area | Upstream | This fork |
|---|---|---|
| CLI | Legacy Python `kimi-cli` (deprecated, frozen) | **kimi-code ≥ 0.26.0** (TypeScript, maintained): `kimi -p … --output-format stream-json` |
| Read-only guarantee | Agent-file deny-list (fail-open) | **Three barriers**: secret scan → fail-closed permission deny rule → snapshot isolation (see [Security model](#security-model)) |
| `--background` | Blocks the caller until the job finishes | **Returns in ~100 ms**; a detached supervisor owns the job |
| Read-only runs & git | Could sweep your uncommitted work into a "kimi session" commit | **Never commit**; your tree and history are untouched |
| `/kimi:plan` | Ran with full write/shell access | **Read-only**, as documented |
| Transient errors | Broker respawned kimi on exit 75 | kimi-code retries internally; any non-zero exit is terminal |

Full details in [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md).

## Requirements

- **kimi-code v0.26.0 or later** — the TypeScript CLI.
  - Install: `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash` (macOS/Linux) or `npm install -g @moonshot-ai/kimi-code`
  - Verify: `kimi --version`. The installer puts the binary at `~/.kimi-code/bin/kimi`; the plugin finds it there even if it is not on your PATH (override with `KIMI_BIN`).
- **Node.js 18.18 or later** — the broker that dispatches commands to Kimi is a Node.js application.
- **A Kimi account** — run `kimi login` (device-code OAuth flow) or configure an API provider in `~/.kimi-code/config.toml`.

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add limeflash/kimi-plugin-cc
```

Install the plugin:

```bash
/plugin install kimi@limeflash-kimi
```

Reload plugins and verify:

```bash
/reload-plugins
/kimi:setup
```

## Update

```bash
/kimi:update --check-only   # check for updates
/kimi:update                # install the latest version
```

After install, you should see the slash commands listed below and the `kimi:kimi-delegate` subagent in `/agents`.

A simple first run:

```bash
/kimi:review --background
/kimi:status
/kimi:result
```

## Usage

### `/kimi:review`

Runs a standard code review on your current work — the same review quality as running kimi-code directly.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text — use [`/kimi:challenge`](#kimichallenge) for that.

```bash
/kimi:review
/kimi:review --base main
/kimi:review --background
```

Read-only: it cannot change your files, and it never commits.

> [!NOTE]
> Reviews of multi-file changes can take a while — run them in the background and check in with `/kimi:status`.

### `/kimi:challenge`

A **steerable** adversarial review that questions the chosen implementation and design: assumptions, trade-offs, failure modes, and whether a different approach would have been safer or simpler.

Same target selection as `/kimi:review` (including `--base <ref>`, `--wait`, `--background`), plus free-form focus text after the flags.

```bash
/kimi:challenge
/kimi:challenge --base main challenge whether this was the right caching and retry design
/kimi:challenge --background look for race conditions and question the chosen approach
```

Read-only. It does not fix code.

### `/kimi:explore`

Read-only codebase exploration and architecture analysis.

Use it to:

- understand a new codebase or module
- find all call sites of a function or API
- answer questions about how a feature works
- generate an architecture overview before making changes

```bash
/kimi:explore how does the auth module work?
/kimi:explore find all database connection code
/kimi:explore --background give me an architecture overview
```

The exploration sees your **live tree** — including uncommitted changes and untracked files — but runs against an isolated snapshot, so it physically cannot write into your repository (and cannot read your gitignored files like `.env`).

### `/kimi:plan`

Generates a structured implementation plan from a task description. Read-only, pure planning — no shell, no writes, never commits.

```bash
/kimi:plan "Add a new file type parser for the TDDF module"
/kimi:plan --background "Refactor the bronze layer to use a single table"
```

The output (state machine, API signatures, file list, edge cases, test requirements) can be fed straight into `/kimi:crank`.

### `/kimi:crank`

Delegates a task to Kimi through the `kimi:kimi-delegate` subagent. **Write-capable**: it modifies files, runs commands, and commits its work per the auto-commit policy.

Use it to:

- implement a feature from a task spec file (`tasks/T-*.md`)
- investigate a bug or try a fix
- continue a previous Kimi task
- take a faster pass with a different model

It supports `--background`, `--wait`, `--resume`, and `--fresh`. If you omit `--resume`/`--fresh`, the plugin can offer to continue the latest task thread for this repo.

`--model <alias>` selects a model alias from your kimi-code `config.toml` (e.g. `kimi-code/k3`, `kimi-code/kimi-for-coding-highspeed`).

```bash
/kimi:crank tasks/T-20260521-xref-descriptions-merge-pipeline.md
/kimi:crank --resume apply the top fix from the last run
/kimi:crank --model kimi-code/kimi-for-coding-highspeed --background implement the bronze layer parser
/kimi:crank --fresh investigate why the tests started failing
```

You can also just ask: *"Ask Kimi to redesign the database connection to be more resilient."*

> [!NOTE]
> Long tasks are best run with `--background`. Without `--model`, the plugin uses `default_model` from your kimi-code config.

### `/kimi:status` and `/kimi:result`

```bash
/kimi:status            # running and recent jobs for this repo
/kimi:status <id>       # one job's details
/kimi:result            # final output of the latest finished job
/kimi:result <id>       # final output of a specific job
```

`/kimi:status <id>` includes the kimi-code session id (`kimi_session_id`), so you can reopen that exact run inside Kimi with `kimi -r <session-id>` (same directory).

### `/kimi:cancel`

Cancels an active background job — kills the kimi process and marks the session `cancelled`.

```bash
/kimi:cancel
/kimi:cancel <id>
```

### `/kimi:setup`

Verifies the kimi-code install, auth, config (`kimi doctor`), MCP parity, and the plugin's agent files. Also manages two optional toggles:

**Review gate** — a `Stop` hook that runs a targeted Kimi review of Claude's response before Claude stops; if issues are found, the stop is blocked so Claude addresses them first.

```bash
/kimi:setup --enable-review-gate
/kimi:setup --disable-review-gate
```

> [!WARNING]
> The review gate can create a long-running Claude/Kimi loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

**Permission default** — writes `default_permission_mode = "yolo"` (or back to `"manual"`) into your kimi-code config:

```bash
/kimi:setup --enable-afk-default
/kimi:setup --disable-afk-default
```

Note: this affects **your own interactive `kimi` sessions** only. Plugin dispatches always run kimi-code in print mode (`-p`), which uses the `auto` permission policy regardless of this setting — with the plugin's own deny rules as the hard gate for read-only commands.

## Typical Flows

```bash
# Review before shipping
/kimi:review

# Hand a problem to Kimi
/kimi:crank investigate why the build is failing in CI

# Explore a new codebase
/kimi:explore give me an architecture overview

# Start something long-running, then check in
/kimi:challenge --background
/kimi:crank --background investigate the flaky test
/kimi:status
/kimi:result
```

## Security model

The read-only commands (`/kimi:review`, `/kimi:challenge`, `/kimi:explore`, `/kimi:plan`) are guarded by **three independent barriers**:

1. **Secret scan** — the assembled prompt (diff + context + your text) is scanned for credentials (AWS, GitHub, Slack, `sk-…` keys, PEM blocks) before anything is sent to the provider. A hit aborts the dispatch (`KIMI_ALLOW_SECRETS=1` overrides).
2. **Fail-closed permission deny rule** — read-only runs execute under an ephemeral `KIMI_CODE_HOME` whose config denies every tool except `Read`, `Grep`, `Glob`, `ReadMediaFile`. Deny rules are the only hard gate in kimi-code's print mode, and the rule matches *any* tool not on the allow-list — including MCP tools, plugin tools, and tools added in future kimi-code versions. Your global `mcp.json`, hooks, and skills never load into these runs.
3. **Snapshot isolation** — the run's working directory is a throwaway copy of your repo (`git archive HEAD` + your uncommitted diff + untracked files), built outside the working tree. Writes physically cannot reach your repository; gitignored files (`.env` and friends) are absent, so they cannot even be read; there is no `.git` inside, and repo-locating `GIT_*` env vars are stripped.

Read-only runs also **never commit** — your uncommitted work stays exactly where it was. The full-access crank (`coder.yaml`) intentionally bypasses all three barriers; that is its job.

Details, verification transcripts, and residual risks: [SECURITY.md](SECURITY.md).

## Configuration

The plugin wraps your local [kimi-code](https://github.com/MoonshotAI/kimi-code) install: same binary, same login, same config.

To change the default model, set `default_model` in your kimi-code config:

```toml
# ~/.kimi-code/config.toml
default_model = "kimi-code/k3"
```

Configuration is picked up from:

- user-level config in `~/.kimi-code/config.toml` (or `$KIMI_CODE_HOME/config.toml`)
- project-level workspace settings in `.kimi-code/local.toml`

### Environment variables

| Variable | Default | Effect |
|---|---|---|
| `KIMI_BIN` | `kimi` on PATH, else `~/.kimi-code/bin/kimi` | kimi-code binary override |
| `KIMI_PLUGIN_DATA` | `~/.kimi-plugin-cc/` | Root dir for the plugin's session state |
| `KIMI_CODE_USER_HOME` | `$KIMI_CODE_HOME` or `~/.kimi-code` | Where your real config/credentials are read from when building the read-only home |
| `KIMI_DISPATCH_TIMEOUT_MS` | `1800000` (30 min) | Hard wall-clock cap per crank |
| `KIMI_IDLE_TIMEOUT_MS` | `300000` (5 min) | Idle-output watchdog |
| `KIMI_ALLOW_SECRETS` | unset | `1` disables the secret-scan preflight (not recommended) |
| `KIMI_KEEP_SNAPSHOT` | unset | `1` keeps the read-only snapshot workspace after a run (debugging) |

### Reliability & timeouts

Every crank runs under two limits so a hung or looping Kimi process can't block you forever:

- `KIMI_DISPATCH_TIMEOUT_MS` — the absolute ceiling, no matter what Kimi is doing.
- `KIMI_IDLE_TIMEOUT_MS` — if Kimi stops emitting output for this long, the crank is treated as stalled and killed. This catches loops and hangs the wall-clock cap alone would let run for the full 30 minutes.

When either limit fires, the crank is terminated (SIGTERM, then SIGKILL after 2 s) and **fails fast with exit code 6**. A timeout is terminal — it is not retried (kimi-code retries transient provider errors internally). The session is marked `status: failed`, `reason: timeout`, and your work is left **uncommitted** so you can inspect the partial diff or resume with `/kimi:crank --resume`.

In a `crank-batch` wave, any session still stuck at the batch deadline is auto-cancelled so one hung task can't pin the whole wave.

```bash
export KIMI_DISPATCH_TIMEOUT_MS=5400000   # 90 minutes for a big refactor
/kimi:crank tasks/T-large-migration.md
```

### Background jobs

`--background` returns immediately (~100 ms): the broker hands the job to a **detached supervisor process** that owns the kimi child, the idle watchdog, and the finalization (status, commit for cranks, telemetry, snapshot cleanup). The job keeps running even after the dispatching command returns; check in with `/kimi:status` and `/kimi:result`, stop it with `/kimi:cancel`.

### Moving the work over to Kimi

Any delegated run can be reopened directly inside kimi-code:

```bash
kimi -r <session-id>    # kimi_session_id from /kimi:status <id>
```

(Resume works from the same directory the session was created in.)

## FAQ

### Do I need a separate Kimi account for this plugin?

No. The plugin uses your local kimi-code authentication. If you are signed in (`kimi login`), it works immediately. Run `/kimi:setup` to check.

### Does the plugin use a separate Kimi runtime?

No. It delegates through your local [kimi-code](https://github.com/MoonshotAI/kimi-code) CLI on the same machine — same install, same login, same repository checkout.

### Will it use the same Kimi config I already have?

Yes — `default_model`, providers, and model aliases from `~/.kimi-code/config.toml` all apply. Read-only commands run under an ephemeral *copy* of that config with the deny rule appended; your real config is never modified.

### Can I keep using my current API key or base URL setup?

Yes. Whatever providers you configured in kimi-code (`[providers.*]` in `config.toml`, OAuth or API key) are what the plugin uses.

### What is the difference between `/kimi:review` and `/kimi:challenge`?

`/kimi:review` is a standard code review — bugs, style, improvements. `/kimi:challenge` is adversarial — it questions design decisions, hidden assumptions, and alternatives. Use it before shipping anything critical.

### What is the difference between `/kimi:explore` and `/kimi:crank`?

`/kimi:explore` is read-only and triple-guarded (see [Security model](#security-model)) — it cannot write files, run shell commands, or start subagents. `/kimi:crank` is write-capable: it modifies files, runs tests, implements features, and commits its work.

### What happened to the legacy `kimi-cli` support?

It's gone by design. The Python `kimi-cli` is deprecated and frozen upstream; kimi-code is the maintained CLI, with a different invocation contract (`-p`, stream-json, permission modes instead of agent files). This fork re-implemented the plugin — including its entire read-only security model — on kimi-code's native mechanisms. If you still have the legacy CLI, `kimi migrate` (built into kimi-code) moves your data over.

## Attribution

This is a fork of [luanmorenommaciel/kimi-plugin-cc](https://github.com/luanmorenommaciel/kimi-plugin-cc) by Luan Moreno (MIT). See [NOTICE](NOTICE) and [LICENSE](LICENSE).
