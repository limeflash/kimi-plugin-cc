---
id: T-20260528-kimi-progress-streaming
title: Live progress streaming — broker emits phase events during long sessions
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on: []
touches_paths:
  - plugins/kimi/scripts/lib/kimi.mjs
  - plugins/kimi/scripts/broker.mjs
  - plugins/kimi/commands/kimi:status.md
source_note: notes/2026-05-28-kimi-plugin-sota-backlog.md
created: 2026-05-28T12:00:00Z
tags: [kimi-plugin, progress, observability, ux, sota]
owner: Luan Moreno
priority: P1
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: "12-min sessions were silent; had to tail output.jsonl manually to see progress"
---

# Live progress streaming — broker emits phase events during long sessions

> **Why:** During the crank experiment, 8-13 minute sessions were completely silent — to see what Kimi was doing I had to manually tail output.jsonl. State-of-the-art tooling should surface progress: which file is being edited, which eval is running, how many tool-calls in. The orchestrator (Claude) should be able to watch a one-line-per-event stream instead of polling.

---

## Goal

Add a `broker.mjs watch --session-id <id>` subcommand that tails the live output.jsonl and emits a compact one-line-per-event progress stream to stdout: `[exploring] reading SKILL.md`, `[editing] validate-task-spec.sh`, `[verifying] running eval_2`, `[done] committed abc123`. Each line is a discrete event suitable for the orchestrator's Monitor pattern. The stream exits when the session completes. This replaces the manual `tail -c` workflow.

---

## Context

Sessions write to `~/.kimi-plugin-cc/sessions/<id>/output.jsonl` as they run. A `watch` subcommand follows that file (`fs.watch` or poll), parses each new JSONL event, and maps it to a human-readable progress line:

- `tool_calls` with ReadFile → `[exploring] reading <path>`
- `tool_calls` with WriteFile/Edit → `[editing] <path>`
- `tool_calls` with Shell running eval_N → `[verifying] running <eval>`
- assistant `think` blocks → `[thinking] <first 60 chars>` (optional, --verbose)
- session close → `[done] <status> <commit-sha>`

Output is line-buffered so the orchestrator's Monitor tool gets one notification per event. Exits when meta.json status flips to completed/failed/cancelled.

---

## Success Criteria

```bash
# eval-1: watch subcommand exists
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE "watch|progress|tail.*jsonl" plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: no watch/progress subcommand"; return 1; }
  echo "PASS: watch subcommand exists"
}

# eval-2: event mapping covers explore/edit/verify phases
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qiE "exploring|editing|verifying|reading|ReadFile|WriteFile" plugins/kimi/scripts/lib/kimi.mjs plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: no phase event mapping"; return 1; }
  echo "PASS: phase event mapping present"
}

# eval-3: status command documents the watch flow
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qiE "watch|progress|stream" plugins/kimi/commands/kimi:status.md \
    || { echo "FAIL: status command does not document watch"; return 1; }
  echo "PASS: watch flow documented in status command"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: watch subcommand exists
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: phase event mapping present
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: watch flow documented
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
    - path: plugins/kimi/scripts/broker.mjs
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

1. **Git revert** — additive subcommand, `git revert --no-commit HEAD`
2. **File restore** — restore broker.mjs, kimi.mjs, kimi:status.md
3. No persistent state.

---

## Observability Hooks

- **Expected duration:** watch runs for the session's lifetime; exits on completion
- **Key metric:** events-per-minute (sanity check the stream isn't flooding)
- **Alert condition:** watch never exits → completion detection broken
- **Log tail:** the watch stream IS the observability

---

## Anti-Patterns

- **Don't emit raw JSONL** — map to compact human-readable lines; raw events flood the orchestrator.
- **Don't poll faster than 500ms** — fs.watch or 1s poll is plenty; tighter wastes CPU.
- **Don't make watch a blocking dependency of dispatch** — it's an optional observer; dispatch works without it.

---

## Do-Not-Touch

- The output.jsonl writer — watch READS it; never change how it's written.
- The status subcommand's existing metadata output — augment with watch docs, don't replace.

---

## Open Questions

1. **fs.watch vs poll for following the JSONL?** — fs.watch is event-driven but flaky across platforms; poll is robust. Recommend poll at 1s with fs.watch as an optimization.
2. **Should think-blocks stream by default?** — They're verbose. Recommend off by default, on with --verbose.
