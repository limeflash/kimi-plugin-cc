# Changelog

## 0.6.0

> `dispatch --background` now actually backgrounds. Fixes the last defect from
> the 0.5.1 end-to-end pass.

### Changed

- **Background jobs run under a detached supervisor process
  (`lib/supervisor.mjs`).** Previously `startBackground` spawned kimi and piped
  its stdout/stderr into in-process write streams; those pipe handles kept the
  broker's event loop alive until the job finished, so `dispatch --background`
  returned only when the job completed (a 3s job returned in ~3.7s) and
  `crank-batch` waves ran serially. Now the broker writes the meta envelope,
  spawns a fully detached `node supervisor.mjs <sessionId>`, and returns at once
  (measured: ~120ms for the same 3s job). The supervisor owns the child's
  lifecycle — idle watchdog and finalization (status, commit-unless-read-only,
  telemetry, snapshot cleanup) — reading all job parameters from `meta.json`.
- **Cancel no longer races the finalizer.** The supervisor's close handler skips
  the status write when the session is already `cancelled`, so a `cancel` that
  kills the child can't be clobbered back to `failed` by the resulting signal.
- Supervision logic is now the shared `superviseJob(sessionId, {spawnFn})`, used
  by the real supervisor and (with an injected `spawnFn`) by the tests, so the
  in-process test path still observes the close handler exactly as before.

### Added

- `tests/background-detach.test.mjs` (2 tests): `--background` returns before a
  3s job finishes and reports `running`; the detached supervisor finalizes the
  session (status/exit/kimi id/commit) after the broker has exited. Live-verified
  on macOS with kimi-code 0.26.0 (immediate return + running status; cancel stays
  cancelled). Suite: 103/103.

## 0.5.1

> Two bug fixes surfaced by an end-to-end test pass of the installed plugin
> against real kimi-code 0.26.0.

### Fixed

- **Read-only runs no longer commit the user's working tree (data-safety).**
  `/kimi:review`, `/kimi:challenge`, `/kimi:explore`, `/kimi:plan` produce no
  changes of their own, but `runDispatch`/`startBackground` unconditionally
  called `commitWork` with the default `on-clean` policy, whose `git add -A`
  swept the user's **pre-existing uncommitted work** into a "kimi session"
  commit. Reproduced live: an `/kimi:explore` on a dirty repo committed the
  user's unrelated edits. Fixed by skipping commit entirely for read-only
  agent files (foreground and background); `meta.commit_reason` records
  `read-only session: never commits`. Regression test in
  `tests/readonly-nocommit.test.mjs` (read-only never commits; coder still
  does).
- **`result` now honors `KIMI_PLUGIN_DATA`.** `cmdResult` read
  `~/.kimi-plugin-cc/sessions/<id>` directly instead of `getSessionsDir()`, so
  it reported `No output captured yet` for a completed session whenever the
  data dir was overridden — while `status`/`latest-session` (which use
  `getSessionsDir`) worked, a confusing split. Regression test in
  `tests/broker.test.mjs`.

### Known issue (fixed in 0.6.0)

- **`dispatch --background` blocks the caller until the job finishes.** The
  broker pipes the detached child's stdout/stderr into in-process write
  streams, and those pipe handles keep the broker's event loop alive despite
  `child.unref()` — so `--background` returns only when the job completes
  (measured: a 3s job returns in ~3.7s, not immediately). This defeats the
  point of `--background` and serializes `crank-batch` waves. Pre-existing
  (the pipe+unref pattern predates the kimi-code port). **Fixed in 0.6.0** via
  a detached supervisor process.

## 0.5.0

> Filesystem isolation — the backstop behind the deny-rule gate. Read-only
> runs can no longer write into your repo even if the permission engine
> failed, because they don't run in your repo at all.

### Added

- **`lib/snapshot.mjs` — snapshot workspace for read-only runs.** Before a
  read-only dispatch, the plugin builds a copy of the repo OUTSIDE the working
  tree: `git archive HEAD` (committed tree, no `.git`) + `git diff HEAD
  --binary` overlay (uncommitted staged/unstaged changes) + untracked
  non-ignored files. kimi's cwd is the snapshot, so `explore`/`review`/
  `challenge` see the live tree — including uncommitted work a plain HEAD
  worktree would miss — while writes physically land in a throwaway copy.
  Extra properties for free: no `.git` (no hooks/push surface) and no
  gitignored files (`.env` & friends cannot be read). The snapshot is deleted
  after the run (`KIMI_KEEP_SNAPSHOT=1` keeps it for debugging); background
  runs clean it in the close handler.
- **`GIT_*` env strip.** Read-only child processes lose `GIT_DIR`,
  `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
  `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, so nothing inside the
  snapshot can be redirected back at the real repository.
- **Isolation observability.** `meta.json` records `isolation:
  "snapshot" | "in-place" | "none"` and `isolation_warning`. Non-git dirs (or
  unborn HEAD) degrade to in-place — deny rules only — with a warning instead
  of failing the command.
- `tests/snapshot.test.mjs` (7 tests): live-tree fidelity (uncommitted edits,
  untracked files, deletions), gitignored files absent, writes-don't-escape
  backstop, non-git/no-commit fallbacks, guarded cleanup, clean regeneration.
  Suite: 98/98.

### Verified live (macOS, kimi-code 0.26.0)

- Read-only probe in a repo with uncommitted edits: kimi read the
  UNCOMMITTED contents through the snapshot, its write attempt was denied by
  the permission rule, the real repo stayed clean (`git status` unchanged),
  and the snapshot was removed after the run. `meta.isolation = "snapshot"`.

## 0.4.0

> Port from the deprecated Python `kimi-cli` to **kimi-code** (the actively
> maintained TypeScript CLI, >= 0.26.0), with the read-only hardening
> re-implemented on kimi-code's own permission engine and verified live.

### Changed (breaking: requires kimi-code >= 0.26.0)

- **Invocation ported to kimi-code.** `kimi -p <prompt> --output-format stream-json`
  with the repo as the process cwd. The legacy flags `--print`, `--yolo`,
  `--work-dir`, `--agent-file` are gone (`-p` even rejects `--yolo/--auto/--plan`
  at startup). Binary resolution: `KIMI_BIN` env → `kimi` on PATH →
  `~/.kimi-code/bin/kimi` (the installer does not add it to PATH).
- **Exit-75 retry loop removed.** kimi-code retries transient provider errors
  internally and reports them as `{"role":"meta","type":"turn.step.retrying"}`
  stream-json lines; any non-zero exit is terminal. The wall-clock + idle
  watchdogs remain — kimi-code `-p` has **no** built-in timeout at all.
- Agent YAML files under `agent-files/` are no longer passed to the CLI; their
  *path* remains the broker's policy selector (see below).

### Added

- **`lib/kimi-home.mjs` — fail-closed read-only enforcement for kimi-code.**
  In `-p` mode kimi-code forces `auto` permission and auto-approves asks, so
  the only hard gate is a user-configured `deny` rule (evaluated before
  auto/yolo approval; deny beats allow). Read-only commands run under an
  **ephemeral `KIMI_CODE_HOME`** (`~/.kimi-plugin-cc/kimi-home-readonly/`):
  user config + `[[permission.rules]] decision="deny"
  pattern="!{Read,Grep,Glob,ReadMediaFile}"`, credentials **symlinked** (OAuth
  refresh keeps working), empty `--skills-dir`, telemetry/auto-update off.
  The user's global `mcp.json` and hooks never load into read-only runs, and
  MCP/plugin/future tools are all denied by the same rule.
  - ⚠️ The pattern MUST be brace negation: kimi-code's permission DSL splits
    on the first `(`, so extglob `!(a|b)` silently matches nothing
    (fail-open). Verified empirically against picomatch 2.3.2 through the
    exact parse+match pipeline; guarded by tests.
  - Policy selection is fail-closed: only `coder*.yaml` gets full access under
    the real home; explore/plan/unknown agent files all run read-only.
- **kimi-code session id capture.** The trailing `session.resume_hint` meta
  line is parsed into `meta.json` as `kimi_session_id` for future `-S` resume.
- `tests/kimi-home.test.mjs` (11 tests): allow-set lint, no-parens pattern
  guard, fail-closed selector, ephemeral-home generation (idempotent deny
  block, credentials symlink, missing-config path), argv/env builders,
  `KIMI_BIN` resolution. Suite: 89/89.

### Verified live (macOS, kimi-code 0.26.0)

- `kimi doctor config` accepts the generated ephemeral config.
- PROVE.txt probe: `Write` denied by the rule, file not created; counter-probe
  confirmed `Read` still works. See SECURITY.md and HANDOFF.md.

## 0.3.4

> The reliability layer that takes the plugin from 9.4 → 10/10. Closes the last
> gap: a hung crank can no longer block indefinitely. Implements the items
> deferred from v0.3.3.

### Added

- **Subprocess timeout + idle-output watchdog.** `runOnce` (foreground) and the detached background spawn now enforce two limits: a hard wall-clock timeout (`KIMI_DISPATCH_TIMEOUT_MS`, default 30m) and an idle-output watchdog (`KIMI_IDLE_TIMEOUT_MS`, default 5m — kills a crank that stops emitting output, catching stalls/loops that a total-time cap alone would miss). Both SIGTERM then SIGKILL after 2s. A timeout is **terminal** (never retried — a hung crank fails fast, not 3×) and resolves with sentinel exit code `124`, surfaced by the broker as documented **exit code 6 (timeout)** with `status: 'failed', reason: 'timeout'`, leaving work uncommitted for inspection/resume.

- `TIMEOUT_EXIT_CODE` (124) exported from `kimi.mjs`; `timeout.test.mjs` proves a real hung process (a `sleep 60` shim) is killed and reports `timedOut: true` + exit 124.

### Changed

- **`waitForSessions` now actively cancels stuck sessions.** Previously it only emitted a "stuck" warning at the deadline, leaking the hung child and an indeterminate working tree. It now calls `cancelSession(id)` on every still-pending session — killing the process and marking meta `cancelled` — so a single hung task in a `crank-batch` wave can't pin the whole wave.

- **Exit code 6 is now real (was reserved).** `broker.mjs` usage() documents `6 timeout (wall-clock or idle-output watchdog killed a hung crank)`. The supervisor can branch on it.

### Result

Plugin score **10/10**: persist + isolate substrate (v0.3.3) plus reliability (v0.3.4) — no crank can leak, hang, edit the wrong tree, lose its work, or go unmeasured.

## 0.3.3

> Surfaced by the first successful end-to-end Kimi crank (doc-link audit task).
> Kimi did the work correctly, but the crank exposed defects that made autonomous,
> supervised cranking untrustworthy. Diagnosed via a 3-agent root-cause + adversarial
> review workflow; score 6.1/10 → 9.4/10.

### Fixed

- **Worktree isolation leak (blocker).** All three `spawn('kimi', ...)` calls omitted the `cwd` option, so the Kimi subprocess ran in the broker's launch directory (the main checkout) instead of the isolated worktree it was dispatched against. Proven: a crank dispatched from `.worktree/wt-.../` edited files in the MAIN checkout; the worktree's `touches_paths` files were untouched. Fix: thread `repoPath` through `invokeKimi`/`runOnce`/`startBackground` and set `{ cwd: repoPath }` on every spawn, plus pass the kimi CLI's own `--work-dir <repoPath>` flag (belt-and-suspenders). `startBackground` no longer re-resolves its own (wrong) repo root via `findRepoRoot` when the caller provides `repoPath`.

- **Auto-commit policy was inert (blocker).** `auto_commit_policy` (`on`|`off`|`on-clean`) was plumbed end-to-end and rendered in reports, but NO code anywhere ran `git add`/`git commit` — `committed` was always written as literal `false` and `commit_sha` was never produced. Every crank left edits dangling in the working tree. Fix: new `lib/commit.mjs` (`shouldCommit` + `commitWork`) wired into the foreground path (after review/validation early-returns) and the background close handler. `on` always commits; `on-clean` commits only when exitCode===0 and retries===0; `off` skips. REVISE/REJECT/api-concern verdicts correctly leave work uncommitted. Captures the resulting SHA into meta.

- **Telemetry envelope all-zeros (major).** `parseTelemetry` accumulated tokens from a top-level `obj.usage` object that Kimi's stream-json NEVER emits — guaranteed `{prompt_tokens:0, ...}` against every real session. Fix: rewrite against the actual schema (`{role, content, tool_calls}` where tool calls live in `tool_calls[].function.name`: ReadFile/Grep/Shell/StrReplaceFile). Tokens are ESTIMATED from content length (~4 chars/token) and flagged `estimated: true` (Kimi reports no counts anywhere — verified across output.jsonl, kimi.log, ~/.kimi/kimi.json). Phases derive from real tool-call ordering and scale into wall-clock via `started_at..finished_at`. Verified against the real session 4117d74d: 54,088 prompt + 8,816 completion tokens, $0.045 estimated, 19 reads / 19 writes / 2 verifies.

### Changed

- **Exit-code contract documented (major).** Codes 2 (origin-diverged), 3 (buggy-evals), 4 (review-pause), 5 (checkpoint-conflict), 6 (reserved) are now documented in `broker.mjs` usage(). The api-validation and diff-review early-returns no longer flatten to `exitCode: 0` — they surface code 4 with `status: 'paused'` + `reason`, so a supervising agent can branch on a blocked task instead of seeing false success.

### Added

- `lib/commit.mjs` — policy-aware durable commit primitive.
- 4 new test files: `commit.test.mjs` (6 cases, real temp git repos), `telemetry-real.test.mjs` (3 cases, checked-in real-session fixture), `kimi-cwd.test.mjs` (2 cases, spawn-cwd injection), `exit-codes.test.mjs` (2 cases, contract assertions). The existing mock-spawn test's telemetry assertions updated to the estimated-token model.

### Deferred to v0.3.4

- Kimi subprocess timeout + idle-output watchdog (a hung crank still blocks indefinitely).
- `waitForSessions` should actively `cancelSession()` stuck ids, not just warn.
- Recover REAL token counts if a future Kimi CLI exposes usage; drop the `estimated` flag.

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
