---
id: T-20260528-plugin-multifile-transaction-mode
title: Multi-file transaction framing + deterministic auto-commit policy
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on: []
touches_paths:
  - plugins/kimi/agent-files/coder-system.md
  - plugins/kimi/scripts/lib/job-control.mjs
  - plugins/kimi/scripts/broker.mjs
source_note: notes/2026-05-27-task-spec-crank-experiment.md
created: 2026-05-28T11:30:00Z
tags: [plugin-enhancement, multi-file, auto-commit, determinism]
owner: Luan Moreno
priority: P1
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: Multi-file waves were correct but slow and never auto-committed
---

# Multi-file transaction framing + deterministic auto-commit policy

> **Why:** In the crank experiment, single-file tasks auto-committed cleanly and ran fast (Wave 4b: 80s). Multi-file tasks (Wave 1b, 3a) were correct but slower (think-edit-think-edit ping-pong) and never auto-committed — Kimi treated each file as a separate decision and stalled at commit. Auto-commit was a per-session coin flip across all 13 waves. Two fixes: frame multi-file changes as one transaction in the coder system prompt, and make auto-commit a deterministic, flag-controlled policy.

---

## Goal

Two coordinated changes. (1) Update `coder-system.md` to instruct Kimi: when a task touches multiple files, produce a complete edit plan covering ALL files first, then apply them as one logical transaction, verify once, commit once. (2) Add a deterministic auto-commit policy controlled by `--auto-commit=on|off|on-clean` (default `on-clean`: auto-commit only when all evals pass on first verification; otherwise leave staged for orchestrator review). The chosen policy is recorded in session meta.json so the orchestrator can predict behavior.

---

## Context

The `coder-system.md` is the system prompt for the coder agent. Today it lacks explicit multi-file transaction framing, so Kimi handles files iteratively. Adding a "transaction discipline" section addresses the ping-pong.

Auto-commit today is implicit Kimi behavior — unpredictable. The fix makes it a broker-controlled flag:
- `on`: always commit after evals pass
- `off`: never commit; leave changes staged + report
- `on-clean` (default): commit only if evals pass on the FIRST verification pass (no debugging iterations needed)

The policy + outcome are written to `meta.json` (`auto_commit_policy`, `committed: true|false`, `commit_sha`).

---

## Success Criteria

```bash
# eval-1: coder-system.md has multi-file transaction discipline
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qiE 'transaction|all files first|edit plan|apply.*together|commit once' plugins/kimi/agent-files/coder-system.md \
    || { echo "FAIL: coder-system.md lacks multi-file transaction framing"; return 1; }
  echo "PASS: coder-system.md has transaction discipline"
}

# eval-2: --auto-commit flag with on|off|on-clean is parsed
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'auto-commit|autoCommit' plugins/kimi/scripts/broker.mjs plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: --auto-commit flag not implemented"; return 1; }
  grep -qE 'on-clean|onClean' plugins/kimi/scripts/lib/job-control.mjs plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: on-clean policy not implemented"; return 1; }
  echo "PASS: --auto-commit on|off|on-clean implemented"
}

# eval-3: auto-commit policy + outcome recorded in session meta
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'auto_commit_policy|committed|commit_sha' plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: auto-commit outcome not recorded in meta"; return 1; }
  echo "PASS: auto-commit policy + outcome recorded in meta.json"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: coder-system.md has multi-file transaction discipline
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: --auto-commit on|off|on-clean implemented
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: auto-commit policy + outcome recorded in meta.json
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
    - path: plugins/kimi/agent-files/coder-system.md
      type: docs
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
2. **File restore** — `git checkout -- plugins/kimi/agent-files/coder-system.md plugins/kimi/scripts/lib/job-control.mjs`
3. No persistent state changes.

---

## Observability Hooks

- **Expected duration:** no runtime cost; affects Kimi's internal pacing
- **Key metric:** multi-file session duration (expect 20-30% reduction); auto-commit rate (expect deterministic)
- **Alert condition:** if on-clean never commits, the "first-pass" detection is wrong
- **Log tail:** meta.json `committed` field per session

---

## Anti-Patterns

- **Don't force auto-commit on by default** — `on-clean` is the safe default; the orchestrator should opt into `on` explicitly for trusted batches.
- **Don't let transaction framing make Kimi batch UNRELATED changes** — transaction = the files in THIS task's touches_paths, not opportunistic edits.
- **Don't commit when evals fail under any policy** — even `on` only commits after evals pass.

---

## Do-Not-Touch

- `explore.yaml` / `plan-sub.yaml` agent files — only `coder-system.md` gets transaction framing (the others don't write).
- The diff-capture logic — separate concern.

---

## Open Questions

1. **How to detect "first-pass clean" for on-clean policy?** — Count eval-execution rounds in the session; if evals passed on round 1, it's clean. Recommend tracking round count in meta.
2. **Should `off` policy stage changes or leave them unstaged?** — Recommend staged (git add) so the orchestrator's commit is one step; document the choice.
