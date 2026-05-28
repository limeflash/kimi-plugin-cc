---
id: T-20260528-kimi-resume-checkpoint
title: Resume + checkpoint — recover an interrupted crank without losing work
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on:
  - T-20260528-kimi-broker-test-coverage
touches_paths:
  - plugins/kimi/scripts/lib/job-control.mjs
  - plugins/kimi/scripts/broker.mjs
  - plugins/kimi/commands/kimi:crank.md
source_note: notes/2026-05-28-kimi-plugin-sota-backlog.md
created: 2026-05-28T12:00:00Z
tags: [kimi-plugin, resume, checkpoint, resilience, sota]
owner: Luan Moreno
priority: P2
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: Wave 2a + 2b had to be killed; the partial work was recovered manually via git stash
---

# Resume + checkpoint — recover an interrupted crank without losing work

> **Why:** Two sessions in the crank experiment had to be killed (Wave 2a buggy evals, Wave 2b origin race). Recovering Kimi's partial-but-correct work required manual git stash juggling. The crank command advertises --resume but it only continues the latest session prompt; it doesn't checkpoint working-tree state. State-of-the-art tooling should checkpoint progress so a killed session's work is recoverable, not lost.

---

## Goal

Add working-tree checkpointing to crank: before dispatch, snapshot a clean baseline; periodically (or on cancel) stash the in-progress diff to a named, recoverable checkpoint under `.kimi/state/checkpoints/`. Enhance `--resume` to optionally restore the last checkpoint's working-tree state plus continue the prompt. Add `broker.mjs checkpoint --session-id <id> --restore|--list` for explicit recovery.

---

## Context

Today `--resume` (per crank.md) reads `.kimi/.session` and prepends "Continue from previous session" — prompt continuity only, no working-tree recovery. When Wave 2a was killed, its correct +144-line implementation lived in the uncommitted working tree; I had to `git stash push` specific files manually.

Checkpointing:
- On dispatch: record baseline SHA in the session meta
- On cancel (cancelSession): `git stash push -m "kimi-checkpoint-<session>"` the session's touched files into a named stash, recorded in `.kimi/state/checkpoints/<session>.json`
- `checkpoint --restore`: `git stash apply` the named checkpoint
- `checkpoint --list`: show recoverable checkpoints with timestamps + touched files

This makes a killed session non-destructive: the work is parked, not lost.

---

## Success Criteria

```bash
# eval-1: checkpoint subcommand exists with restore + list
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE "checkpoint" plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: no checkpoint subcommand"; return 1; }
  grep -qE "restore|--list" plugins/kimi/scripts/broker.mjs plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: checkpoint lacks restore/list"; return 1; }
  echo "PASS: checkpoint subcommand with restore + list"
}

# eval-2: cancel stashes in-progress work to a named checkpoint
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE "stash|checkpoint" plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: cancel does not checkpoint work"; return 1; }
  echo "PASS: cancel checkpoints in-progress work"
}

# eval-3: checkpoints stored under gitignored .kimi/state
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE "checkpoints|\.kimi/state" plugins/kimi/scripts/lib/job-control.mjs plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: checkpoints not under .kimi/state"; return 1; }
  echo "PASS: checkpoints stored under .kimi/state"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: checkpoint subcommand with restore + list
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: cancel checkpoints in-progress work
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: checkpoints stored under .kimi/state
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
    - path: plugins/kimi/scripts/lib/job-control.mjs
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
2. **File restore** — restore job-control.mjs, broker.mjs, crank.md
3. Existing git stashes created by checkpoints are independent of this code; they survive a revert and can be applied/dropped manually.

---

## Observability Hooks

- **Expected duration:** checkpoint stash adds ~200ms on cancel
- **Key metric:** checkpoints created vs restored (how often recovery is used)
- **Alert condition:** stash apply conflicts on restore → surface to orchestrator
- **Log tail:** `.kimi/state/checkpoints/*.json`

---

## Anti-Patterns

- **Don't auto-restore on resume without consent** — restoring a stash can conflict with current state. Make restore explicit (--restore flag).
- **Don't checkpoint the WHOLE working tree** — only the session's touched files, to avoid stashing unrelated work.
- **Don't drop checkpoints automatically** — keep them until explicitly cleared; lost-work recovery is the whole point.

---

## Do-Not-Touch

- The existing --resume prompt-continuity behavior — extend it, don't break it.
- git diff-capture logic — checkpoint is a separate stash-based concern.

---

## Open Questions

1. **git stash vs a patch file under .kimi/state?** — Stash is native but pollutes the stash list. Patch files (git diff > file) are self-contained. Recommend patch files under .kimi/state/checkpoints for isolation.
2. **When to auto-clear old checkpoints?** — Recommend keep last N per session + a `checkpoint --prune` command; never auto-delete.
