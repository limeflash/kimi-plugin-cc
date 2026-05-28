---
id: T-20260528-plugin-preflight-eval-check
title: Pre-flight task-spec evals before dispatch (catch buggy specs early)
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on: []
touches_paths:
  - plugins/kimi/scripts/lib/preflight.mjs
  - plugins/kimi/scripts/lib/job-control.mjs
  - plugins/kimi/scripts/broker.mjs
source_note: notes/2026-05-27-task-spec-crank-experiment.md
created: 2026-05-28T11:30:00Z
tags: [plugin-enhancement, preflight, eval-quality, fail-fast]
owner: Luan Moreno
priority: P0
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: Wave 2a burned ~10 min before its buggy evals were caught
---

# Pre-flight task-spec evals before dispatch (catch buggy specs early)

> **Why:** Wave 2a's task spec had three eval bugs (mktemp filename pollution, touches_paths referencing a tmpdir-absent file, missing format_version) that Kimi spent ~10 minutes fighting before failing. The upgraded task-spec skill ships run-task-spec.sh + validate-task-spec.sh --shellcheck-evals + --dry-run-eval that would catch these in seconds. The plugin must run these pre-flight checks BEFORE spending a Kimi session.

---

## Goal

Before dispatch, the broker runs three cheap pre-flight checks on the task spec: (a) `validate-task-spec.sh --shellcheck-evals` if available, (b) a dry-run of the evals against the current repo to detect that they currently FAIL-as-expected (a task whose evals already PASS is already done → skip), and (c) a brittle-sample heuristic flagging `mktemp -t *.md` patterns and `touches_paths` referencing files outside the repo. Results are surfaced to the orchestrator as structured JSON; dispatch proceeds only on a clean (or force-overridden) pre-flight.

---

## Context

The host repo may have the task-spec skill installed (look for `.claude/skills/task-spec/scripts/validate-task-spec.sh`). If present, the broker shells out to it. If absent, the broker does a lightweight built-in check. A new `lib/preflight.mjs`: `preflight(taskPath, repoRoot)` returns `{ status: 'clean'|'already-done'|'buggy-evals', findings: [...] }`.

Key states:
- **clean**: evals currently FAIL (expected — work not yet done). Proceed.
- **already-done**: evals currently PASS. The task is satisfied (possibly by a parallel commit, cf. Wave 2b). Skip + notify.
- **buggy-evals**: shellcheck errors or brittle-sample heuristics fired. Surface to orchestrator; require `--skip-preflight` to override.

---

## Success Criteria

```bash
# eval-1: preflight module exists and is wired before dispatch
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  [ -f plugins/kimi/scripts/lib/preflight.mjs ] \
    || { echo "FAIL: lib/preflight.mjs missing"; return 1; }
  grep -qE 'preflight|already-done|buggy-evals' plugins/kimi/scripts/lib/job-control.mjs plugins/kimi/scripts/lib/preflight.mjs \
    || { echo "FAIL: preflight not wired into dispatch"; return 1; }
  echo "PASS: preflight module exists and is wired"
}

# eval-2: preflight detects already-done tasks (evals currently pass)
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'already.done|alreadyDone|evals.*pass.*skip' plugins/kimi/scripts/lib/preflight.mjs \
    || { echo "FAIL: preflight has no already-done detection"; return 1; }
  echo "PASS: preflight detects already-done tasks"
}

# eval-3: --skip-preflight override exists
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'skip-preflight|skipPreflight' plugins/kimi/scripts/broker.mjs plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: --skip-preflight override missing"; return 1; }
  echo "PASS: --skip-preflight override implemented"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: Preflight module exists and is wired before dispatch
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: Preflight detects already-done tasks
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: --skip-preflight override implemented
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
  required_tools: [git, bash, node]
  timeout_minutes: 30
  sandbox_type: host
  output_artifacts:
    - path: plugins/kimi/scripts/lib/preflight.mjs
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

1. **Git revert** — additive, `git revert --no-commit HEAD`
2. **File restore** — delete `lib/preflight.mjs`, restore `job-control.mjs` and `broker.mjs`
3. No persistent state.

---

## Observability Hooks

- **Expected duration:** preflight adds ~2-5s per dispatch (runs evals once)
- **Key metric:** sessions skipped as already-done; sessions blocked as buggy-evals
- **Alert condition:** if preflight blocks valid tasks, the brittle-sample heuristic is too aggressive
- **Log tail:** `.kimi/state/preflight-{task}.json`

---

## Anti-Patterns

- **Don't run evals that have side effects during preflight** — preflight must be read-only-ish. If an eval writes state, sandbox it or skip dry-run for that eval.
- **Don't hard-block on shellcheck warnings of severity info** — only error/warning severity blocks; info is noise (matches the validator's own convention).
- **Don't make preflight mandatory with no escape** — `--skip-preflight` must always override for edge cases.

---

## Do-Not-Touch

- The host repo's task-spec skill scripts — the plugin SHELLS OUT to them, never modifies them.
- `lib/git.mjs` — separate concern (origin-state task owns git ops).

---

## Open Questions

1. **What if the host repo doesn't have the task-spec skill installed?** — Fall back to a minimal built-in eval extractor + bash syntax check. Document the degraded mode.
2. **Should preflight run the FULL exit check or just individual evals?** — Recommend individual evals (to classify already-done vs buggy per-eval), then the exit check for the overall verdict.
