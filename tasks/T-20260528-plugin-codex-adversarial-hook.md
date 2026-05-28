---
id: T-20260528-plugin-codex-adversarial-hook
title: Codex adversarial hooks — plan-review before crank, diff-review before commit
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on:
  - T-20260528-plugin-multifile-transaction-mode
touches_paths:
  - plugins/kimi/scripts/lib/codex-bridge.mjs
  - plugins/kimi/scripts/lib/job-control.mjs
  - plugins/kimi/scripts/broker.mjs
  - plugins/kimi/commands/crank.md
source_note: notes/2026-05-27-task-spec-crank-experiment.md
created: 2026-05-28T11:30:00Z
tags: [plugin-enhancement, codex, adversarial, three-agent, review-gate]
owner: Luan Moreno
priority: P2
severity: feature
precondition: Codex CLI/plugin must be installed and callable
blocked_reason: (none)
security_class: (none)
source_action_item: Three-agent architecture — Claude orchestrates, Codex challenges, Kimi works
---

# Codex adversarial hooks — plan-review before crank, diff-review before commit

> **Why:** The target architecture is Claude-as-orchestrator, Codex-as-adversary, Kimi-as-worker. Kimi currently commits autonomously with no second opinion. Two failure modes from the crank experiment (Wave 2a buggy evals, Wave 2b origin race) would have been caught by an adversarial reviewer. This wires optional Codex hooks: a pre-crank plan-review (challenge the approach before 8 min of Kimi work) and a post-crank diff-review (challenge the diff before commit).

---

## Goal

Add two optional Codex review hooks to the crank flow, both off by default and enabled per-invocation. (1) `--plan-review`: before dispatching Kimi, send the task spec + repo context to Codex for an adversarial plan critique; surface APPROVE | CONCERN | DIFFERENT_APPROACH to the orchestrator. (2) `--diff-review`: after Kimi writes but before commit, send the diff to Codex for an adversarial review; surface APPROVE_COMMIT | REVISE | REJECT. The orchestrator (Claude) makes the final call; Codex only advises. A `lib/codex-bridge.mjs` abstracts the Codex invocation so the plugin doesn't hard-depend on a specific Codex CLI shape.

---

## Context

The host environment has a Codex plugin (slash commands like `/codex:rescue`, and a codex-companion runtime). The bridge shells out to whatever Codex entrypoint is configured (env var `CODEX_CMD` or auto-detect), passes a structured prompt, and parses a verdict.

Hook points in the crank flow:
1. **Pre-dispatch** (if `--plan-review`): bridge sends `{task_spec, project_context}` → Codex → verdict. On CONCERN/DIFFERENT_APPROACH, the broker emits the verdict and pauses (exit code signals orchestrator to decide).
2. **Post-write, pre-commit** (if `--diff-review`): bridge sends `git diff` → Codex → verdict. On REVISE/REJECT, leave changes staged, emit verdict, don't commit.

Both hooks degrade gracefully: if Codex is unavailable, warn + skip (don't block the crank).

---

## Success Criteria

```bash
# eval-1: codex-bridge module exists with verdict parsing
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  [ -f plugins/kimi/scripts/lib/codex-bridge.mjs ] \
    || { echo "FAIL: lib/codex-bridge.mjs missing"; return 1; }
  grep -qE 'APPROVE|CONCERN|REVISE|REJECT|verdict' plugins/kimi/scripts/lib/codex-bridge.mjs \
    || { echo "FAIL: codex-bridge has no verdict parsing"; return 1; }
  echo "PASS: codex-bridge module exists with verdict parsing"
}

# eval-2: --plan-review and --diff-review flags wired
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'plan-review|planReview' plugins/kimi/scripts/broker.mjs plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: --plan-review flag missing"; return 1; }
  grep -qE 'diff-review|diffReview' plugins/kimi/scripts/broker.mjs plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: --diff-review flag missing"; return 1; }
  echo "PASS: --plan-review and --diff-review flags wired"
}

# eval-3: graceful degradation when Codex unavailable
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qiE 'codex.*unavailable|skip.*codex|warn.*codex|graceful' plugins/kimi/scripts/lib/codex-bridge.mjs \
    || { echo "FAIL: no graceful degradation when Codex unavailable"; return 1; }
  echo "PASS: graceful degradation when Codex unavailable"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: codex-bridge module exists with verdict parsing
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: --plan-review and --diff-review flags wired
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: graceful degradation when Codex unavailable
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
    - path: plugins/kimi/scripts/lib/codex-bridge.mjs
      type: code
  mcp_dependencies: []
  emit:
    - pass
    - fail
    - retry_with_reason
    - parked_with_context
  codex_metadata:
    role: adversarial-reviewer
    invocation: cli-shellout
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
2. **File restore** — delete `lib/codex-bridge.mjs`, restore job-control.mjs, broker.mjs, crank.md
3. Both hooks are off-by-default, so reverting is low-risk.

---

## Observability Hooks

- **Expected duration:** each Codex review adds 1-3 min (Codex session)
- **Key metric:** Codex CONCERN/REVISE/REJECT rate (signal:noise — too many = Codex is noise; zero = Codex is rubber-stamp)
- **Alert condition:** if Codex review takes >5 min, it's a bottleneck; consider async
- **Log tail:** `.kimi/state/codex-verdict-{task}.json`

---

## Anti-Patterns

- **Don't let Codex auto-block the crank** — Codex ADVISES; the orchestrator (Claude/human) decides. CONCERN pauses for a decision; it doesn't hard-fail.
- **Don't hard-depend on a specific Codex CLI version** — abstract via codex-bridge.mjs + CODEX_CMD env var so the plugin survives Codex changes.
- **Don't run Codex review when the diff is trivial** — skip review for doc-only or single-line changes to avoid noise; make the threshold configurable.

---

## Do-Not-Touch

- The Kimi dispatch core — Codex hooks wrap it, never modify Kimi's own execution.
- The origin-state + preflight modules — separate gates; Codex is the adversarial layer on top.

---

## Open Questions

1. **What's the Codex invocation contract?** — Need to confirm the exact CLI/plugin entrypoint (codex exec? a slash command? the codex-companion runtime?). The bridge should auto-detect or read CODEX_CMD. Resolve during build against the installed Codex plugin.
2. **Structured verdict format from Codex?** — Codex returns prose; the bridge must parse a verdict. Recommend prompting Codex to emit a final line `VERDICT: APPROVE|CONCERN|REVISE|REJECT` and grep for it, with a conservative default (CONCERN) if unparseable.
