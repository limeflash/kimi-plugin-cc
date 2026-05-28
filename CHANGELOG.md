# Changelog

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
