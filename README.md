# Kimi plugin for Claude Code

Use [Kimi](https://kimi.ai) from inside Claude Code for code reviews, codebase exploration, or to delegate tasks to Kimi.

This plugin is for Claude Code users who want an easy way to start using Kimi from the workflow they already have.

## What You Get

- `/kimi:review` for a normal read-only code review
- `/kimi:challenge` for a steerable adversarial review that questions your design
- `/kimi:explore` for read-only codebase exploration and architecture analysis
- `/kimi:crank` to delegate a task file (`tasks/T-*.md`) to Kimi for execution
- `/kimi:plan` to generate a structured implementation plan from a task description
- `/kimi:status`, `/kimi:result`, and `/kimi:cancel` to manage background jobs

## Requirements

- **kimi-code v0.26.0 or later** (the actively maintained TypeScript CLI; the
  deprecated Python `kimi-cli` is no longer supported).
  - Install with: `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`
    (macOS/Linux) or `npm install -g @moonshot-ai/kimi-code`
  - Verify with: `kimi --version` (the installer puts the binary at
    `~/.kimi-code/bin/kimi`; the plugin finds it there even if it is not on
    your PATH — override with `KIMI_BIN` if needed)
- **Node.js 18.18 or later**
  - The broker that dispatches commands to Kimi is a Node.js application.
- **A Kimi account with API access.**
  - Run `kimi login` to authenticate.

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add luanmorenommaciel/kimi-plugin-cc
```

Install the plugin:

```bash
/plugin install kimi@luanmorenommaciel-kimi
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/kimi:setup
```

## Update

Check for updates:

```bash
/kimi:update --check-only
```

Install the latest version:

```bash
/kimi:update
```

Or manually:

```bash
cd $(git rev-parse --show-toplevel) && git pull
/reload-plugins
```

`/kimi:setup` will tell you whether Kimi is ready. If Kimi CLI is missing, it will guide you to install it. If Kimi is installed but not logged in yet, run:

```bash
!kimi login
```

After install, you should see:

- the slash commands listed below
- the `kimi:kimi-delegate` subagent in `/agents`

One simple first run is:

```bash
/kimi:review --background
/kimi:status
/kimi:result
```

## Usage

### `/kimi:review`

Runs a normal code review on your current work. It gives you the same quality of code review as running `/review` inside Kimi directly.

> [!NOTE]
> Code review especially for multi-file changes might take a while. It's generally recommended to run it in the background.

Use it when you want:

- a review of your current uncommitted changes
- a review of your branch compared to a base branch like `main`

Use `--base <ref>` for branch review. It also supports `--wait` and `--background`. It is not steerable and does not take custom focus text. Use [`/kimi:challenge`](#kimichallenge) when you want to challenge a specific decision or risk area.

Examples:

```bash
/kimi:review
/kimi:review --base main
/kimi:review --background
```

This command is read-only and will not perform any changes. When run in the background you can use [`/kimi:status`](#kimistatus) to check on the progress and [`/kimi:cancel`](#kimicancel) to cancel the ongoing task.

### `/kimi:challenge`

Runs a **steerable** review that questions the chosen implementation and design.

It can be used to pressure-test assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

It uses the same review target selection as `/kimi:review`, including `--base <ref>` for branch review. It also supports `--wait` and `--background`. Unlike `/kimi:review`, it can take extra focus text after the flags.

Use it when you want:

- a review before shipping that challenges the direction, not just the code details
- review focused on design choices, tradeoffs, hidden assumptions, and alternative approaches
- pressure-testing around specific risk areas like auth, data loss, rollback, race conditions, or reliability

Examples:

```bash
/kimi:challenge
/kimi:challenge --base main challenge whether this was the right caching and retry design
/kimi:challenge --background look for race conditions and question the chosen approach
```

This command is read-only. It does not fix code.

### `/kimi:explore`

Runs a read-only codebase exploration and architecture analysis.

Use it when you want:

- to understand a new codebase or module
- to find all call sites of a function or API
- to answer questions about how a feature works
- to generate an architecture overview before making changes

It uses a read-only agent that cannot write files, spawn shells, or start subagents — making it safe to run on any codebase.

Examples:

```bash
/kimi:explore how does the auth module work?
/kimi:explore find all database connection code
/kimi:explore --background give me an architecture overview
```

### `/kimi:crank`

Delegates a task to Kimi through the `kimi:kimi-delegate` subagent.

Use it when you want Kimi to:

- implement a feature from a task spec file (`tasks/T-*.md`)
- investigate a bug
- try a fix
- continue a previous Kimi task
- take a faster or cheaper pass with a smaller model

> [!NOTE]
> Depending on the task and the model you choose these tasks might take a long time and it's generally recommended to force the task to be in the background or move the agent to the background.

It supports `--background`, `--wait`, `--resume`, and `--fresh`. If you omit `--resume` and `--fresh`, the plugin can offer to continue the latest task thread for this repo.

It also supports `--model <model>` to choose a specific model alias from your
kimi-code `config.toml` (e.g. `kimi-code/k3`, `kimi-code/kimi-for-coding`).

Examples:

```bash
/kimi:crank tasks/T-20260521-xref-descriptions-merge-pipeline.md
/kimi:crank --resume apply the top fix from the last run
/kimi:crank --model kimi-k1-5 --background implement the bronze layer parser
/kimi:crank --fresh investigate why the tests started failing
```

You can also just ask for a task to be delegated to Kimi:

```text
Ask Kimi to redesign the database connection to be more resilient.
```

**Notes:**

- if you do not pass `--model`, the plugin uses the default model from your Kimi config.
- follow-up crank requests can continue the latest Kimi task in the repo

### `/kimi:plan`

Generates a structured implementation plan from a task description.

Use it when you want:

- a step-by-step implementation plan before writing code
- to identify key files and architectural decisions
- to estimate scope and risk before committing to a task

The plan agent is read-only and will not write any files. It outputs a structured plan you can review before delegating to `/kimi:crank`.

Examples:

```bash
/kimi:plan "Add a new file type parser for the TDDF module"
/kimi:plan --background "Refactor the bronze layer to use a single table"
```

### `/kimi:status`

Shows running and recent Kimi jobs for the current repository.

Examples:

```bash
/kimi:status
/kimi:status task-abc123
```

Use it to:

- check progress on background work
- see the latest completed job
- confirm whether a task is still running

### `/kimi:result`

Shows the final stored Kimi output for a finished job.
When available, it also includes the Kimi session ID so you can reopen that run directly in Kimi with `kimi resume <session-id>`.

Examples:

```bash
/kimi:result
/kimi:result task-abc123
```

### `/kimi:cancel`

Cancels an active background Kimi job.

Examples:

```bash
/kimi:cancel
/kimi:cancel task-abc123
```

### `/kimi:setup`

Checks whether Kimi CLI is installed and authenticated.
If Kimi CLI is missing, it will guide you to install it.

You can also use `/kimi:setup` to manage the optional review gate.

#### Enabling review gate

```bash
/kimi:setup --enable-review-gate
/kimi:setup --disable-review-gate
```

When the review gate is enabled, the plugin uses a `Stop` hook to run a targeted Kimi review based on Claude's response. If that review finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Kimi loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

#### Enabling AFK/YOLO default

```bash
/kimi:setup --enable-afk-default
/kimi:setup --disable-afk-default
```

When AFK default is enabled, all Kimi tasks run in `--yolo` mode automatically, meaning no interactive prompts will block execution. This is useful for long-running background tasks.

## Typical Flows

### Review Before Shipping

```bash
/kimi:review
```

### Hand A Problem To Kimi

```bash
/kimi:crank investigate why the build is failing in CI
```

### Explore A New Codebase

```bash
/kimi:explore give me an architecture overview
```

### Start Something Long-Running

```bash
/kimi:challenge --background
/kimi:crank --background investigate the flaky test
```

Then check in with:

```bash
/kimi:status
/kimi:result
```

## Kimi Integration

The Kimi plugin wraps [kimi-code](https://github.com/MoonshotAI/kimi-code). It
uses your installed `kimi` binary (PATH or `~/.kimi-code/bin/kimi`; override
with `KIMI_BIN`) and applies the same configuration.

### Common Configurations

If you want to change the default model that gets used by the plugin, set
`default_model` in your kimi-code `config.toml`:

```toml
# ~/.kimi-code/config.toml
default_model = "kimi-code/k3"
```

Your configuration will be picked up based on:

- user-level config in `~/.kimi-code/config.toml` (or `$KIMI_CODE_HOME/config.toml`)
- project-level workspace settings in `.kimi-code/local.toml`

Read-only commands (`/kimi:review`, `/kimi:challenge`, `/kimi:explore`) run
under an ephemeral copy of that config with a fail-closed deny rule appended —
see [SECURITY.md](SECURITY.md).

### Reliability & timeouts

Every crank runs under two limits so a hung or looping Kimi process can't block you forever:

- `KIMI_DISPATCH_TIMEOUT_MS` — hard wall-clock cap on a single crank. Default 30 minutes (`1800000`). This is the absolute ceiling, no matter what Kimi is doing.
- `KIMI_IDLE_TIMEOUT_MS` — idle-output watchdog. Default 5 minutes (`300000`). If Kimi stops emitting output for this long, the crank is treated as stalled and killed — this catches loops and hangs that the wall-clock cap alone would let run for the full 30 minutes.

When either limit fires, the crank is terminated (SIGTERM, then SIGKILL after 2s) and **fails fast with exit code 6**. A timeout is terminal — it is not retried. The session is marked `status: failed`, `reason: timeout`, and your work is left **uncommitted** so you can inspect the partial diff or resume it with `/kimi:crank --resume`.

In a `crank-batch` wave, any session still stuck at the batch deadline is auto-cancelled (killed and marked `cancelled`) so one hung task can't pin the whole wave.

Override a default per-task when you expect a long run:

```bash
export KIMI_DISPATCH_TIMEOUT_MS=5400000   # 90 minutes for a big refactor
/kimi:crank tasks/T-large-migration.md
```

### Moving The Work Over To Kimi

Delegated tasks and any [stop gate](#what-does-the-review-gate-do) run can also be directly resumed inside Kimi by running `kimi resume` either with the specific session ID you received from running `/kimi:result` or `/kimi:status` or by selecting it from the list.

This way you can review the Kimi work or continue the work there.

## FAQ

### Do I need a separate Kimi account for this plugin?

If you are already signed into Kimi on this machine, that account should work immediately here too. This plugin uses your local Kimi CLI authentication.

If you only use Claude Code today and have not used Kimi yet, you will also need to sign in to Kimi. Run `/kimi:setup` to check whether Kimi is ready, and use `!kimi login` if it is not.

### Does the plugin use a separate Kimi runtime?

No. This plugin delegates through your local [Kimi CLI](https://github.com/MoonshotAI/Kimi-Chat) on the same machine.

That means:

- it uses the same Kimi install you would use directly
- it uses the same local authentication state
- it uses the same repository checkout and machine-local environment

### Will it use the same Kimi config I already have?

Yes. If you already use Kimi, the plugin picks up the same [configuration](#common-configurations).

### Can I keep using my current API key or base URL setup?

Yes. Because the plugin uses your local Kimi CLI, your existing sign-in method and config still apply.

If you need to point Kimi at a different endpoint, set `api_base` in your [Kimi config](https://github.com/MoonshotAI/Kimi-Chat#configuration).

### What is the difference between `/kimi:review` and `/kimi:challenge`?

`/kimi:review` is a standard code review — it finds bugs, style issues, and suggests improvements.

`/kimi:challenge` is an adversarial review — it questions your design decisions, finds hidden assumptions, and suggests alternative approaches. Use it before shipping anything critical.

### What is the difference between `/kimi:explore` and `/kimi:crank`?

`/kimi:explore` is read-only. It cannot write files, run shell commands, or start subagents. Use it to understand code safely.

`/kimi:crank` is write-capable. It can modify files, run tests, and implement features. Use it when you want Kimi to actually do work.

### What does the review gate do?

When enabled, every time Claude stops to ask you something, the plugin runs a quick Kimi review on Claude's proposed response. If Kimi finds issues, the stop is blocked and Claude is asked to fix them first. This creates an extra safety net but can be slow.

### What does AFK/YOLO mode do?

When enabled via `/kimi:setup --enable-afk-default`, all Kimi tasks run with `--yolo` mode. This means Kimi will not prompt you for confirmation on tool calls — it will just execute them. This is essential for background tasks but use with caution on production code.
