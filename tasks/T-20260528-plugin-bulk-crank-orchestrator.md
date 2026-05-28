---
id: T-20260528-plugin-bulk-crank-orchestrator
title: Bulk-crank orchestrator (crank-batch + crank-next respecting deps + touches_paths)
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on:
  - T-20260528-plugin-origin-state-awareness
  - T-20260528-plugin-preflight-eval-check
touches_paths:
  - plugins/kimi/scripts/lib/orchestrate.mjs
  - plugins/kimi/scripts/broker.mjs
  - plugins/kimi/commands/crank-batch.md
  - plugins/kimi/commands/crank-next.md
source_note: notes/2026-05-27-task-spec-crank-experiment.md
created: 2026-05-28T11:30:00Z
tags: [plugin-enhancement, orchestration, batch, parallel, wave-runner]
owner: Luan Moreno
priority: P2
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: The 13-task experiment was run by hand-typing each crank + wait loop
---

# Bulk-crank orchestrator (crank-batch + crank-next respecting deps + touches_paths)

> **Why:** The 13-task crank experiment was driven entirely by hand: type a crank command, arm a wait loop, verify, commit, repeat — 13 times, plus dependency reasoning (sequential vs parallel based on touches_paths overlap). That's exactly the wave-runner logic that should be a first-class plugin command. crank-batch walks a file glob, builds a dependency + touches_paths-overlap graph, and runs tasks in safe waves (parallel where disjoint, sequential where shared).

---

## Goal

Add two commands. `crank-batch <glob>` reads all matching task specs, parses their `depends_on` + `touches_paths`, builds an execution graph (topological order for deps; overlap detection for parallel-safety), and dispatches in waves — parallel where touches_paths are disjoint, sequential where they overlap. `crank-next` picks the single highest-priority `status: ready` task whose deps are satisfied and dispatches it. Both honor the origin-state + preflight gates from their dependency tasks. Results roll up into a batch report.

---

## Context

This codifies the manual orchestration from the experiment. A new `lib/orchestrate.mjs`:

- `buildGraph(taskPaths)` — parse frontmatter, return `{ waves: [[task...], [task...]], conflicts: [...] }`
- Wave assignment: a task joins the earliest wave where (a) all its deps are in prior waves, and (b) its touches_paths don't overlap any task already in that wave (except grep-and-append files like SKILL.md/README.md, which are allowed to share).
- `crank-batch` dispatches each wave, waits for completion, runs post-flight, then proceeds. `--max-parallel N` caps concurrency (Kimi config default is 4).
- `crank-next` is the single-task selector for incremental work.

The overlap heuristic reuses the host repo's `lint-backlog.sh` if present (the task-spec skill ships it), else a built-in.

---

## Success Criteria

```bash
# eval-1: orchestrate module + both commands exist
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  [ -f plugins/kimi/scripts/lib/orchestrate.mjs ] \
    || { echo "FAIL: lib/orchestrate.mjs missing"; return 1; }
  [ -f plugins/kimi/commands/crank-batch.md ] && [ -f plugins/kimi/commands/crank-next.md ] \
    || { echo "FAIL: crank-batch.md or crank-next.md command missing"; return 1; }
  echo "PASS: orchestrate module + both commands exist"
}

# eval-2: wave-graph builder handles deps + touches_paths overlap
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'buildGraph|waves|topolog|overlap|disjoint' plugins/kimi/scripts/lib/orchestrate.mjs \
    || { echo "FAIL: wave-graph builder not implemented"; return 1; }
  grep -qE 'depends_on|touches_paths' plugins/kimi/scripts/lib/orchestrate.mjs \
    || { echo "FAIL: graph builder does not parse deps/touches_paths"; return 1; }
  echo "PASS: wave-graph builder handles deps + overlap"
}

# eval-3: --max-parallel cap + batch report
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'max-parallel|maxParallel' plugins/kimi/scripts/lib/orchestrate.mjs plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: --max-parallel cap not implemented"; return 1; }
  grep -qiE 'report|summary|rollup' plugins/kimi/scripts/lib/orchestrate.mjs \
    || { echo "FAIL: batch report not implemented"; return 1; }
  echo "PASS: --max-parallel cap + batch report implemented"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: orchestrate module + both commands exist
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: wave-graph builder handles deps + touches_paths overlap
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: --max-parallel cap + batch report implemented
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
    - docs
  required_tools: [git, bash, node]
  timeout_minutes: 30
  sandbox_type: host
  output_artifacts:
    - path: plugins/kimi/scripts/lib/orchestrate.mjs
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

1. **Git revert** — `git revert --no-commit HEAD`
2. **File restore** — delete `lib/orchestrate.mjs`, `commands/crank-batch.md`, `commands/crank-next.md`; restore broker.mjs
3. No persistent state.

---

## Observability Hooks

- **Expected duration:** graph build is instant; batch runtime = sum of wave runtimes
- **Key metric:** wall-clock saved by parallel waves vs sequential
- **Alert condition:** a wave with overlapping touches_paths gets parallelized → merge conflict
- **Log tail:** batch report JSON + per-session meta.json

---

## Anti-Patterns

- **Don't parallelize tasks with overlapping non-trivial touches_paths** — only grep-and-append files (SKILL.md, README.md) may be shared in a wave. Code/script files must serialize.
- **Don't ignore depends_on** — a task must never run before its declared dependency completes.
- **Don't exceed Kimi's max_running_tasks** — respect the config ceiling (default 4); --max-parallel caps it lower if desired.

---

## Do-Not-Touch

- The single-task `crank` command — crank-batch wraps it, doesn't replace it.
- Origin-state + preflight modules — consumed as dependencies, not modified here.

---

## Open Questions

1. **How to resolve the grep-and-append allowlist?** — Files like SKILL.md/README.md are safe to share in a wave. Recommend a configurable allowlist; default to *.md docs at repo root + SKILL.md/README.md.
2. **Sequential fallback if dependency tasks (origin-state, preflight) aren't built yet?** — crank-batch should degrade gracefully: warn that gates are unavailable, run sequentially-only. Document the degraded mode.
