---
id: T-20260528-kimi-broker-test-coverage
title: Broker test coverage — job-control, dispatch, cancel, preflight under test
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on: []
touches_paths:
  - tests/helpers.mjs
creates_paths:
  - tests/job-control.test.mjs
  - tests/broker.test.mjs
source_note: notes/2026-05-28-kimi-plugin-sota-backlog.md
created: 2026-05-28T12:00:00Z
tags: [kimi-plugin, testing, regression, sota]
owner: Luan Moreno
priority: P0
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: The cancelSession SESSIONS_DIR bug shipped because job-control.mjs had zero tests
---

# Broker test coverage — job-control, dispatch, cancel, preflight under test

> **Why:** The plugin has tests for git/render/state/workspace but NONE for job-control.mjs — the most critical module (dispatch, background spawn, cancel). A real bug shipped: cancelSession referenced an undefined SESSIONS_DIR and threw on every invocation, undetected because nothing tested it. State-of-the-art orchestration tooling must test its own control plane.

---

## Goal

Add test coverage for job-control.mjs and the broker's command dispatch. Cover: session-dir resolution (the exact bug that shipped), startBackground meta.json creation, cancelSession SIGTERM/SIGKILL path with a mock pid, and broker argument parsing for each subcommand. Use the existing test harness (node:test, per the existing *.test.mjs files). Mock the kimi spawn so tests run offline.

---

## Context

Existing tests live in `tests/` using node's built-in test runner (`tests/git.test.mjs`, `state.test.mjs`, etc.) with a shared `tests/helpers.mjs`. The untested surface:

- `lib/job-control.mjs`: `getSessionsDir()`, `startBackground()`, `cancelSession()` — the module where the SESSIONS_DIR bug lived
- `broker.mjs`: argument parsing + dispatch routing for status/result/cancel/dispatch/diff-capture

Mock strategy: stub `child_process.spawn` so `startBackground` doesn't launch a real kimi; assert meta.json shape + pid file write. For cancel, write a fake pid file pointing at a sleep process, cancel it, assert it dies + meta flips to cancelled.

---

## Success Criteria

```bash
# eval-1: job-control test file exists and passes
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  [ -f tests/job-control.test.mjs ] \
    || { echo "FAIL: tests/job-control.test.mjs missing"; return 1; }
  node --test tests/job-control.test.mjs >/dev/null 2>&1 \
    || { echo "FAIL: job-control tests do not pass"; return 1; }
  echo "PASS: job-control.test.mjs exists and passes"
}

# eval-2: test covers the getSessionsDir resolution (the bug that shipped)
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'getSessionsDir|sessions.*dir|SESSIONS_DIR|cancelSession' tests/job-control.test.mjs \
    || { echo "FAIL: no test for session-dir resolution / cancel"; return 1; }
  echo "PASS: test covers session-dir resolution + cancel"
}

# eval-3: full suite still green
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  node --test tests/*.test.mjs >/dev/null 2>&1 \
    || { echo "FAIL: full test suite not green"; return 1; }
  echo "PASS: full test suite green"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: job-control.test.mjs exists and passes
    runnable: bash
    terminal: true
    expected_duration_sec: 5
  - id: eval_2
    description: test covers session-dir resolution + cancel
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: full test suite green
    runnable: bash
    terminal: true
    expected_duration_sec: 10

retry_policy:
  max_iterations: 15
  circuit_breaker_no_progress: 3
  on_terminal_failure: park_with_context

agent_contract:
  version: 2
  read: [intent, contract, guardrails, operations]
  produce:
    - tests
  required_tools: [git, bash, node]
  timeout_minutes: 30
  sandbox_type: host
  output_artifacts:
    - path: tests/job-control.test.mjs
      type: tests
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

1. **Git revert** — additive test files, `git revert --no-commit HEAD`
2. **File restore** — delete the new test files
3. No persistent state; tests are pure additions.

---

## Observability Hooks

- **Expected duration:** test suite runs in <15s
- **Key metric:** broker module line coverage (target: job-control.mjs > 80%)
- **Alert condition:** any test flakiness (spawn mocks must be deterministic)
- **Log tail:** CI test output

---

## Anti-Patterns

- **Don't launch real kimi processes in tests** — mock spawn; tests must run offline and deterministically.
- **Don't test against the real ~/.kimi-plugin-cc directory** — use a temp HOME or KIMI_PLUGIN_DATA override so tests don't pollute real sessions.
- **Don't skip the cancel-path test** — that's the exact bug that shipped; it MUST be covered.

---

## Do-Not-Touch

- Existing test files (git/render/state/workspace) — add new ones, don't rewrite.
- `lib/job-control.mjs` production code — this task is tests only; if a bug is found, file a separate task.

---

## Open Questions

1. **How to mock child_process.spawn cleanly in node:test?** — Use a module mock or dependency injection. Recommend injecting a spawn function param with a default, testable override.
2. **Temp-HOME strategy?** — Set KIMI_PLUGIN_DATA to a mktemp dir per test; clean up in afterEach.
