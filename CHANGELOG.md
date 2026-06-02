# Changelog

## 0.3.2

### Fixed

- **Broker session metadata preservation** — the foreground dispatch path in `runDispatch` (commands.mjs) called `writeMeta` (full file overwrite) at three terminal sites, erasing the 11 initial-write fields (`session_id`, `agent_file`, `prompt`, `model`, `started_at`, `repo_path`, `mode`, `auto_commit_policy`, `tag`, `touches_paths`, `baseline_sha`). All three terminal sites + the two early-return branches now use `updateMeta` (read-merge-write). Background close handler (`job-control.mjs`) and `cancelSession` swapped to the same primitive for consistency.

- **Broker pipeline error recovery** — `runDispatch` had no top-level `try/catch/finally`, so an exception anywhere between `invokeKimi` and `attachTelemetry` left the session in an inconsistent terminal state (`status: 'running'`, `running: false`) forever. The body is now wrapped: `catch` calls `safeUpdateMeta({ status: 'failed', error, finished_at })` and re-throws; `finally` attaches telemetry on foreground dispatches. `safeUpdateMeta` (new) bootstraps a minimum-viable envelope if the initial `writeMeta` did not fire — closes the catch-handler-crashes-before-meta-exists trap.

- **Initial meta envelope written before any awaitable** — `writeMeta` now fires at the very top of `runDispatch` (before resume / origin-check / preflight / context injection), so every code path past that point can safely call `updateMeta`. Removes the gap where blocked-early returns (`origin-diverged`, `buggy-evals`, `already-done`, `plan-paused`, `checkpoint-conflict`) left no session record.

### Added

- `safeUpdateMeta(sessionId, patch)` — `updateMeta` with bootstrap fallback to `writeMeta`. Used by the new `catch` handler.
- `metaExists(sessionId)` — convenience predicate over `meta.json` presence.
- 6 new tests (4 in `tests/state.test.mjs` covering the 12-field envelope preservation and bootstrap-safe helpers; 2 in `tests/integration.test.mjs` covering the non-zero-exit close-handler path and `cancelSession` envelope preservation). The existing `startBackground end-to-end with mock spawn` test was extended with explicit assertions over all 11 initial fields after the close handler fires.

## 0.3.1

### Fixed

- **Marketplace install crash (`ERR_MODULE_NOT_FOUND: picomatch`)** — v0.3.0 imported `picomatch` in `commands.mjs` and `context.mjs`, but it was declared only under `devDependencies` in the repo-root `package.json`. Claude Code's plugin loader unpacks the marketplace artifact into `~/.claude/plugins/cache/.../<version>/` without running `npm install`, so the dependency was never resolved at the cache location and every broker invocation crashed at module load. Replaced both call sites with Node stdlib `path.matchesGlob` via a new `lib/glob.mjs` helper that throws on unsupported metachars (`{}()!+@[`), so future rule authors using extglob/brace syntax get a loud diagnosable error instead of a silent mismatch. Bumped `engines.node` from `>=18.18.0` to `>=20.17.0` (Node 18 EOL April 2025; `path.matchesGlob` requires 20.17+). Dropped the `picomatch` dev-dependency entirely — zero runtime deps. Added unit tests for `matchGlob` covering happy paths and all five loud-failure cases.

- **Flaky test isolation** — `node --test` runs files in parallel workers, and several tests mutated the shared `process.env.KIMI_PLUGIN_DATA` global. A sibling test deleting the var could race with the mock-spawn integration test's deferred close handler, intermittently failing `startBackground end-to-end with mock spawn`. Pinned the runner to `--test-concurrency=1` in both `package.json` and the release guardrail (`scripts/release.mjs`, which previously hardcoded its own test command and drifted from `npm test`). Hardened the env-deletion test with a `t.after()` hook that correctly restores to unset (avoiding the `process.env.X = undefined` -> string `"undefined"` coercion trap).

## 0.3.0

### MCP-Powered Features

- **Firecrawl structured extraction** (`lib/docs.mjs`) — Extracts precise API signatures (parameters, return types, examples) from docs pages via JSON schema scraping. Falls back to Tavily search.
- **Exa semantic code search** (`lib/patterns.mjs`) — Finds real-world implementation patterns via embedding-based search with token-efficient `highlights`. Wired via `--patterns` flag.
- **External doc monitoring** (`lib/monitor.mjs`) — Captures Firecrawl baselines of `external_docs:` URLs at dispatch and re-checks before commit. Emits structured warnings if docs changed mid-session.

### Core Pipeline & Safety

- **12-stage dispatch pipeline** — origin check → preflight → context → docs → research → plan review → invoke → diff review → API validation → telemetry → monitor check
- **Preflight sandboxing** (`lib/preflight.mjs`) — Dry-run evals execute in `os.tmpdir()` with side-effect detection (git commit, rm -rf, writeFile, redirection). Shellcheck integration if available.
- **Origin-state awareness** (`lib/git.mjs`) — Fetches origin, compares `touches_paths` for divergence, caches SHA with 60s TTL. Blocks dispatch if local branch diverged from origin.
- **Structured warning system** (`lib/warn.mjs`) — Replaces all silent `catch { // ignore }` patterns with JSONL append to `.kimi/state/warnings.jsonl`. Query via `broker.mjs warnings --since`.
- **Checkpoint / resume** — `cancelSession` stashes working diff as `.patch` + `.json`. `--resume` auto-restores checkpoint before continuing.
- **Post-write API validation** (`lib/validate-api.mjs`) — Scans diff for new imports, HTTP URLs, method chains. Queries Tavily to verify APIs exist and are current.

### Orchestration & Context

- **Wave-based batch execution** (`lib/orchestrate.mjs`) — Topological sort + wave assignment with `touches_paths` overlap detection. Docs allowlist prevents false conflicts. `broker.mjs batch <glob>`.
- **Scoped context injection** (`lib/context.mjs`) — Matches `.claude/rules/*.md` globs against `touches_paths` using `picomatch`. 8KB cap with intelligent truncation.
- **Library docs injection** (`lib/docs.mjs`) — Scans imports, queries Tavily for docs + API reference. 4KB cap.
- **Task web research** (`lib/research.mjs`) — Reads `research_topics:` frontmatter or extracts keywords from title. Tavily search with 2KB cap.

### Review & Telemetry

- **Codex adversarial review** (`lib/codex-bridge.mjs`) — `--plan-review` and `--diff-review` gates. Parses `VERDICT: APPROVE|CONCERN|REVISE|REJECT`. Graceful degrade if Codex unavailable.
- **Telemetry & cost tracking** (`lib/telemetry.mjs`) — Parses `output.jsonl` for token usage. Phase heuristics: ReadFile=exploration, WriteFile=implementation, Shell eval=verification. Cost estimation via `KIMI_COST_PER_1M_*` env vars.
- **Live progress streaming** (`lib/kimi.mjs`) — `watchSession` polls `output.jsonl`, emits `[exploring]`, `[editing]`, `[verifying]`, `[done]` lines.

### Developer Experience

- **Auto `.env` loading** — `broker.mjs` loads `.env` on startup if present. `.env.example` documents all optional keys.
- **Command registry pattern** — Adding a subcommand is one line: `register('name', handler)`.
- **16 broker subcommands** — dispatch, status, result, cancel, diff-capture, branch-diff, working-diff, latest-session, watch, report, telemetry, checkpoint, monitor, warnings, batch, next.
- **36 passing tests** — Unit + integration tests with mock spawn injection. No actual Kimi CLI needed for test suite.

## 0.2.1

- **Node.js broker rewrite** — replaced bash scripts with a full Node.js broker (`broker.mjs`) and 6 library modules
- **9 slash commands** — `crank`, `review`, `challenge`, `explore`, `plan`, `status`, `result`, `cancel`, `setup`
- **3 unique commands beyond Codex parity** — `challenge` (adversarial review), `explore` (read-only exploration), `plan` (structured planning)
- **AFK/YOLO support** — `--yolo` flag in broker + `/kimi:setup --enable-afk-default` config toggle
- **Workspace-aware sessions** — `.kimi/.session` tracks latest session per repo for `--resume` without session ID
- **Structured output parsing** — parses Kimi's `stream-json` output into an activity log for `--verbose` results
- **Review gate** — optional `Stop` hook for targeted review before Claude stops
- **Skills** — `kimi-cli-runtime` and `kimi-result-handling` skills
- **Agent security boundaries** — `coder.yaml` (write), `explore.yaml` (read-only), `plan-sub.yaml` (no shell/no write)

## 0.1.0

- Initial version of the Kimi plugin for Claude Code
- Bash-based implementation with `dispatch.sh`, `session-manager.sh`, `diff-capture.sh`
- 6 commands: `crank`, `review`, `status`, `result`, `cancel`, `setup`
- Basic agent file support with `coder.yaml`
