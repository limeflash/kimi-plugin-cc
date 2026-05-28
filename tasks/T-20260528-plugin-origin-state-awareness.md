---
id: T-20260528-plugin-origin-state-awareness
title: Add origin-state awareness to broker (gitignored .kimi/state cache)
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on: []
touches_paths:
  - plugins/kimi/scripts/lib/git.mjs
  - plugins/kimi/scripts/lib/job-control.mjs
  - plugins/kimi/scripts/broker.mjs
  - .gitignore
source_note: notes/2026-05-27-task-spec-crank-experiment.md
created: 2026-05-28T11:30:00Z
tags: [plugin-enhancement, origin-state, race-condition, orchestration]
owner: Luan Moreno
priority: P1
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: Wave 2b lost 12 min to an origin-divergence race during the crank experiment
---

# Add origin-state awareness to broker (gitignored .kimi/state cache)

> **Why:** During a 13-task autonomous crank experiment, one session (Wave 2b) ran for 12 minutes solving a problem that had been independently committed and pushed to origin/master 8 minutes earlier. Kimi cannot sense its environment changing under it. The broker must fetch origin and detect divergence in the task's touches_paths BEFORE dispatching, so the orchestrator can abort or pause instead of burning a session on already-solved work.

---

## Goal

At dispatch time, the broker runs `git fetch origin` (quiet), compares `origin/<branch>` against the local branch for the task's touches_paths, and writes a state snapshot to a gitignored `.kimi/state/` directory. If origin has diverged in any touched path, the broker refuses to dispatch (exit non-zero) with a structured JSON message naming the conflicting paths, so the orchestrator (Claude) can decide: rebase, skip, or override with `--force-dispatch`.

---

## Context

The plugin currently dispatches Kimi blind to remote state. The broker's `lib/git.mjs` already does diff-capture; it needs a `fetchAndCompare(touchesPaths)` function. State lives under a new gitignored `.kimi/state/` directory in the host repo:

- `.kimi/state/origin-{branch}.json` — last-known origin SHA + fetch timestamp
- `.kimi/state/inflight.json` — touches_paths claimed by running sessions (parallel-crank safety)

The broker reads touches_paths from the task file's frontmatter (already parsed elsewhere). On divergence, emit `{"status":"blocked","reason":"origin-diverged","conflicting_paths":[...]}` and exit 2. A `--force-dispatch` flag overrides for cases where the orchestrator knows the divergence is benign.

---

## Success Criteria

Each criterion is a runnable bash function returning 0 (pass) or non-zero (fail).

```bash
# eval-1: broker has a fetch-and-compare capability gated before dispatch
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'fetchAndCompare|fetch.*origin|origin-diverged' plugins/kimi/scripts/lib/git.mjs plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: no origin fetch-and-compare logic found"; return 1; }
  echo "PASS: broker has origin fetch-and-compare capability"
}

# eval-2: .gitignore excludes the .kimi/state cache directory
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE '\.kimi/state|\.kimi/' .gitignore \
    || { echo "FAIL: .gitignore does not exclude .kimi/state"; return 1; }
  echo "PASS: .kimi/state is gitignored"
}

# eval-3: --force-dispatch flag is documented and parsed
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'force-dispatch|forceDispatch' plugins/kimi/scripts/broker.mjs plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: --force-dispatch override not implemented"; return 1; }
  echo "PASS: --force-dispatch override implemented"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: Broker has origin fetch-and-compare capability
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: .kimi/state is gitignored
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: --force-dispatch override implemented
    runnable: bash
    terminal: true
    expected_duration_sec: 1

retry_policy:
  max_iterations: 15
  circuit_breaker_no_progress: 3
  on_terminal_failure: park_with_context

agent_contract:
  version: 2
  read: [intent, contract, guardrails, operations]
  produce:
    - code
    - config
  required_tools: [git, bash, node]
  timeout_minutes: 30
  sandbox_type: host
  output_artifacts:
    - path: plugins/kimi/scripts/lib/git.mjs
      type: code
  mcp_dependencies: []
  emit:
    - pass
    - fail
    - retry_with_reason
    - parked_with_context
  codex_metadata: {}
  kimi_metadata: {}
```

---

## Exit Check

```bash
eval_1 && eval_2 && eval_3
```

---

## Rollback Plan

1. **Git revert** — `git revert --no-commit HEAD` (additive feature; safe to revert)
2. **File restore** — `git checkout -- plugins/kimi/scripts/lib/git.mjs plugins/kimi/scripts/broker.mjs`
3. The `.kimi/state/` directory is gitignored runtime cache; deleting it is harmless.

---

## Observability Hooks

- **Expected duration:** fetch-and-compare adds ~1-3s per dispatch (network)
- **Key metric:** dispatches blocked by origin-divergence per day
- **Alert condition:** if every dispatch blocks, the fetch logic is too strict
- **Log tail:** `.kimi/state/origin-*.json` timestamps

---

## Anti-Patterns

- **Don't make the fetch a hard blocker with no override** — network flakiness shouldn't halt all work. `--force-dispatch` must always be available.
- **Don't fetch on EVERY broker subcommand** — only on `dispatch`. Status/result/cancel don't need network.
- **Don't compare the whole tree** — only the task's touches_paths. A divergence in unrelated files is irrelevant to this task.

---

## Do-Not-Touch

- The existing diff-capture logic in `lib/git.mjs` — extend, don't replace.
- `lib/kimi.mjs` (the Kimi CLI wrapper) — out of scope.

---

## Open Questions

1. **Should fetch be `git fetch origin` or `git fetch origin <branch>`?** — Branch-scoped is faster; recommend branch-scoped with full-fetch fallback.
2. **What's the staleness window for the cached origin SHA?** — Recommend re-fetch if the cached snapshot is older than 60 seconds, else trust cache.
