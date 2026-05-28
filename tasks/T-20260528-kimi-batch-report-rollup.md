---
id: T-20260528-kimi-batch-report-rollup
title: Batch report rollup — aggregate session outcomes across a crank batch
status: ready
format_version: 2
effort: S
budget_iterations: 15
agent: any
depends_on:
  - T-20260528-kimi-session-telemetry
touches_paths:
  - plugins/kimi/scripts/lib/render.mjs
  - plugins/kimi/scripts/broker.mjs
source_note: notes/2026-05-28-kimi-plugin-sota-backlog.md
created: 2026-05-28T12:00:00Z
tags: [kimi-plugin, reporting, rollup, observability, sota]
owner: Luan Moreno
priority: P2
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: After 13 waves I hand-built the per-wave summary table; should be a command
---

# Batch report rollup — aggregate session outcomes across a crank batch

> **Why:** After the 13-task crank experiment, I hand-assembled a per-wave summary (runtime, auto-commit, files, evals, commit SHA). That aggregation is mechanical and should be a command. A `broker.mjs report` that rolls up all sessions in a time window or matching a tag gives the orchestrator (and the user) an at-a-glance batch outcome without manual bookkeeping.

---

## Goal

Add `broker.mjs report [--since <iso>] [--tag <tag>] [--format table|json|md]` that scans session meta.json files, aggregates outcome (status, duration, exit_code, committed, commit_sha, telemetry tokens/cost), and renders a summary. The markdown format produces the exact per-session table I built by hand. Reuses the existing render.mjs for formatting.

---

## Context

Session metadata lives at `~/.kimi-plugin-cc/sessions/<id>/meta.json`. After the telemetry task lands, each meta has tokens + cost + phase timings. The report command:

- Scans all session dirs (or filters by --since / --tag)
- Sorts by started_at
- Renders one row per session: id, status, duration, committed, commit_sha, tokens, est_cost
- Footer: totals (sessions, total duration, total tokens, total cost, pass rate)

This is the missing "what did my batch do?" view. The existing render.mjs already does markdown table formatting for review output; extend it.

---

## Success Criteria

```bash
# eval-1: report subcommand exists with format options
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE "report" plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: no report subcommand"; return 1; }
  grep -qE "format|table|json" plugins/kimi/scripts/broker.mjs plugins/kimi/scripts/lib/render.mjs \
    || { echo "FAIL: report lacks format options"; return 1; }
  echo "PASS: report subcommand with format options"
}

# eval-2: report aggregates status + duration + committed across sessions
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE "status|duration|committed|commit_sha|totals|pass.rate" plugins/kimi/scripts/lib/render.mjs plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: report does not aggregate outcomes"; return 1; }
  echo "PASS: report aggregates session outcomes"
}

# eval-3: --since and --tag filters are supported
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE -- "--since|--tag" plugins/kimi/scripts/broker.mjs \
    || { echo "FAIL: report lacks --since/--tag filters"; return 1; }
  echo "PASS: report supports --since and --tag filters"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: report subcommand with format options
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: report aggregates session outcomes
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: report supports --since and --tag filters
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
    - path: plugins/kimi/scripts/lib/render.mjs
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
2. **File restore** — restore render.mjs and broker.mjs
3. No persistent state.

---

## Observability Hooks

- **Expected duration:** report scans session dirs in <1s for typical counts
- **Key metric:** the report IS the observability rollup
- **Alert condition:** sessions with missing meta.json → flag as incomplete in the report
- **Log tail:** report stdout

---

## Anti-Patterns

- **Don't recompute telemetry in the report** — read it from meta.json (the telemetry task computes it once at session close).
- **Don't fail the whole report if one session's meta is malformed** — skip + note it, render the rest.
- **Don't default to scanning ALL history** — default to a sensible window (e.g. last 24h); --since overrides.

---

## Do-Not-Touch

- The telemetry computation — report consumes it; the session-telemetry task owns producing it.
- Individual session meta.json files — report is read-only over them.

---

## Open Questions

1. **Where does --tag come from?** — Sessions don't carry tags today. Recommend optionally tagging at dispatch (--tag flag) stored in meta; report filters on it. If untagged, --tag filter matches nothing gracefully.
2. **Default time window?** — Recommend last 24h for the default report; document that --since=0 shows all.
