---
id: T-20260528-kimi-session-telemetry
title: Session telemetry — token counts, cost estimate, phase timings in meta.json
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on: []
touches_paths:
  - plugins/kimi/scripts/lib/kimi.mjs
  - plugins/kimi/scripts/lib/state.mjs
  - plugins/kimi/scripts/broker.mjs
source_note: notes/2026-05-28-kimi-plugin-sota-backlog.md
created: 2026-05-28T12:00:00Z
tags: [kimi-plugin, telemetry, cost, observability, sota]
owner: Luan Moreno
priority: P1
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: "User asked 'what are Kimi's costs?' and session metadata had zero token data"
---

# Session telemetry — token counts, cost estimate, phase timings in meta.json

> **Why:** During the crank experiment the user asked about Kimi costs and we could not answer — session output.jsonl carries no token counts, no cost, no phase timings. State-of-the-art agent tooling must be cost-observable. The Kimi stream-json output contains usage events; the broker must parse and persist them.

---

## Goal

Parse token-usage events from the Kimi stream-json output (`output.jsonl`) and persist a telemetry summary into meta.json: total prompt_tokens, completion_tokens, cached_tokens (if present), an estimated cost (configurable per-1M-token rate), and phase timings (exploration / implementation / verification durations derived from tool-call timestamps). Expose a `broker.mjs telemetry --session-id <id>` subcommand that prints the rollup.

---

## Context

Kimi runs with `--output-format stream-json` (seen in job-control.mjs). Each assistant message in the stream typically carries usage metadata. The broker currently pipes stdout to output.jsonl without parsing. A new parse step (in `lib/kimi.mjs` or a new `lib/telemetry.mjs`) reads the JSONL on session close, sums usage, and writes:

```json
{
  "telemetry": {
    "prompt_tokens": 12345,
    "completion_tokens": 6789,
    "cached_tokens": 2000,
    "estimated_cost_usd": 0.04,
    "phases": { "exploration_sec": 45, "implementation_sec": 120, "verification_sec": 90 }
  }
}
```

Cost rate configurable via env (`KIMI_COST_PER_1M_INPUT`, `KIMI_COST_PER_1M_OUTPUT`) with documented defaults. Phase timings derived heuristically from tool-call patterns (reads = exploration, writes = implementation, shell-with-eval = verification).

---

## Success Criteria

```bash
# eval-1: telemetry parsing module exists and is wired into session close
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'prompt_tokens|completion_tokens|telemetry|usage' plugins/kimi/scripts/lib/kimi.mjs plugins/kimi/scripts/lib/state.mjs plugins/kimi/scripts/lib/telemetry.mjs 2>/dev/null \
    || { echo "FAIL: no telemetry parsing found"; return 1; }
  echo "PASS: telemetry parsing wired"
}

# eval-2: telemetry subcommand exists
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE "telemetry" plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: broker has no telemetry subcommand"; return 1; }
  echo "PASS: broker telemetry subcommand exists"
}

# eval-3: cost rate is configurable via env with documented defaults
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE "KIMI_COST_PER_1M|cost.*rate|estimated_cost" plugins/kimi/scripts/lib/*.mjs \
    || { echo "FAIL: cost estimation not configurable"; return 1; }
  echo "PASS: cost rate configurable via env"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: telemetry parsing module wired into session close
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: broker telemetry subcommand exists
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: cost rate configurable via env
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
    - path: plugins/kimi/scripts/lib/telemetry.mjs
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
2. **File restore** — delete telemetry module, restore kimi.mjs/state.mjs/broker.mjs
3. Existing meta.json files without telemetry remain valid (additive field).

---

## Observability Hooks

- **Expected duration:** parsing adds ~50-100ms at session close
- **Key metric:** cost-per-task trend over time
- **Alert condition:** a session with 0 tokens parsed → stream format changed
- **Log tail:** meta.json telemetry block

---

## Anti-Patterns

- **Don't hard-code cost rates** — Moonshot pricing changes; use env with documented defaults.
- **Don't fail the session if usage events are absent** — telemetry is best-effort; older Kimi versions may not emit usage.
- **Don't over-engineer phase detection** — heuristic timing is fine; don't build a full execution profiler.

---

## Do-Not-Touch

- The output.jsonl raw stream — telemetry READS it, never rewrites it.
- job-control.mjs dispatch core — telemetry hooks at session-close only.

---

## Open Questions

1. **Does Kimi stream-json emit per-message usage or only a final total?** — Inspect a real output.jsonl. If per-message, sum; if final-only, read the last event. Handle both.
2. **What are the default cost rates?** — Use current Moonshot kimi-for-coding published rates as documented defaults; make overridable.
