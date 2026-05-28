---
id: T-20260528-plugin-project-context-injection
title: Inject CLAUDE.md / AGENTS.md / scoped rules into Kimi crank prompt
status: ready
format_version: 2
effort: M
budget_iterations: 15
agent: any
depends_on: []
touches_paths:
  - plugins/kimi/scripts/lib/job-control.mjs
  - plugins/kimi/scripts/lib/context.mjs
  - plugins/kimi/scripts/broker.mjs
source_note: notes/2026-05-27-task-spec-crank-experiment.md
created: 2026-05-28T11:30:00Z
tags: [plugin-enhancement, context-injection, env-awareness, quality]
owner: Luan Moreno
priority: P1
severity: feature
precondition: (none)
blocked_reason: (none)
security_class: (none)
source_action_item: Kimi rediscovers project conventions from scratch every session
---

# Inject CLAUDE.md / AGENTS.md / scoped rules into Kimi crank prompt

> **Why:** Across 13 crank sessions, Kimi spent ~15% of each session re-exploring the codebase to rediscover conventions (no-comments policy, src/ vs functions/ boundary, config-source pattern) that are already documented in CLAUDE.md and .claude/rules/. Kimi never reads these because the plugin doesn't inject them. Auto-discovering and prepending project context would make Kimi environment-aware from token zero.

---

## Goal

Before dispatch, the broker walks up from the task's touches_paths to discover project-context files (`CLAUDE.md`, `AGENTS.md`, and any `.claude/rules/*.md` whose scope globs match the touched paths), assembles a compact "PROJECT CONTEXT" preamble, and prepends it to the Kimi prompt. The preamble is size-bounded (truncate rules to their headers + key bullets) so it doesn't blow the context budget. A `--no-context` flag disables injection.

---

## Context

Kimi's `coder.yaml` agent file shapes behavior but carries no project-specific knowledge. The host repo has authoritative context:

- `CLAUDE.md` at repo root — project mission, stack, conventions
- `AGENTS.md` (if present) — agent-specific directives
- `.claude/rules/*.md` — path-scoped rules (e.g., a rule scoped to `src/core/parsers/**` applies when the task touches a parser)

A new `lib/context.mjs` module: `discoverContext(touchesPaths, repoRoot)` returns a context string. It reads CLAUDE.md/AGENTS.md fully (they're concise), and for scoped rules, matches each rule's frontmatter glob scope against touches_paths, including only matching rules. The assembled block is capped (e.g., 8KB) and prepended to the prompt with a clear `=== PROJECT CONTEXT (read-only reference) ===` delimiter so Kimi knows it's reference, not task.

---

## Success Criteria

```bash
# eval-1: context discovery module exists and is wired into dispatch
eval_1() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  [ -f plugins/kimi/scripts/lib/context.mjs ] \
    || { echo "FAIL: lib/context.mjs missing"; return 1; }
  grep -qE 'discoverContext|PROJECT CONTEXT|CLAUDE\.md' plugins/kimi/scripts/lib/job-control.mjs plugins/kimi/scripts/lib/context.mjs \
    || { echo "FAIL: context injection not wired into dispatch"; return 1; }
  echo "PASS: context discovery module exists and is wired"
}

# eval-2: scoped-rule matching against touches_paths is implemented
eval_2() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'rules|glob|scope|minimatch|fnmatch' plugins/kimi/scripts/lib/context.mjs \
    || { echo "FAIL: scoped-rule glob matching not implemented"; return 1; }
  echo "PASS: scoped-rule matching implemented"
}

# eval-3: --no-context flag disables injection
eval_3() {
  cd "$(git rev-parse --show-toplevel)" || return 1
  grep -qE 'no-context|noContext' plugins/kimi/scripts/broker.mjs plugins/kimi/scripts/lib/job-control.mjs \
    || { echo "FAIL: --no-context flag not implemented"; return 1; }
  echo "PASS: --no-context flag implemented"
}
```

---

## Validation Card

```yaml
success_criteria:
  - id: eval_1
    description: Context discovery module exists and is wired into dispatch
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_2
    description: Scoped-rule glob matching implemented
    runnable: bash
    terminal: true
    expected_duration_sec: 1
  - id: eval_3
    description: --no-context flag disables injection
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
    - path: plugins/kimi/scripts/lib/context.mjs
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

1. **Git revert** — additive feature, `git revert --no-commit HEAD`
2. **File restore** — `git checkout -- plugins/kimi/scripts/lib/job-control.mjs` and delete `lib/context.mjs`
3. No persistent state to clean.

---

## Observability Hooks

- **Expected duration:** context discovery adds ~100-300ms per dispatch (file reads)
- **Key metric:** prompt-token reduction from Kimi not re-exploring (compare session exploration-phase length before/after)
- **Alert condition:** context block exceeds 8KB cap → truncation logic broken
- **Log tail:** session output.jsonl exploration phase

---

## Anti-Patterns

- **Don't inject ALL rules regardless of scope** — only rules whose glob matches the task's touches_paths. Injecting every rule bloats the prompt.
- **Don't read CLAUDE.md fresh on every subcommand** — only on dispatch; cache within the dispatch call.
- **Don't fail dispatch if CLAUDE.md is absent** — context injection is best-effort; a repo without CLAUDE.md still dispatches fine.

---

## Do-Not-Touch

- `coder.yaml` agent file — context goes in the PROMPT, not the agent file (keeps the agent file portable).
- `lib/kimi.mjs` CLI wrapper — out of scope.

---

## Open Questions

1. **How to parse scoped-rule globs?** — The .claude/rules/*.md files have frontmatter or a table declaring scope. Recommend reading frontmatter `globs:` or a documented convention; fall back to filename-based matching.
2. **What's the context size cap?** — Recommend 8KB total; truncate rules to headers + first bullet per section if over.
