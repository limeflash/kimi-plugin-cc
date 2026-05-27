---
name: kimi:plan
description: Generate a structured implementation plan using Kimi's native plan subagent. No shell, no write tools.
argument-hint: <feature-description> [--output html]
allowed-tools: [Bash, Read, Task]
---

# /kimi:plan

> Produce a detailed implementation plan for a feature or task.

## Usage

```
/kimi:plan "Add OAuth2 authentication"
/kimi:plan "Add OAuth2 authentication" --output html
```

## Process

1. **Gather context**
   - Read `CLAUDE.md`, `README.md`, and relevant source files.
   - Identify extension points, hooks, and existing patterns.

2. **Dispatch to Kimi**
   - Use `plan` subagent via `coder.yaml` with `plan-sub.yaml`.
   - Prompt includes feature description + gathered context.
   ```
   Bash("node plugins/kimi/scripts/broker.mjs dispatch \
     --prompt 'Create an implementation plan for: <feature>. Context: ...' \
     --agent-file '$(pwd)/plugins/kimi/agent-files/coder.yaml' \
     --mode plan")
   ```

3. **Render plan**
   - Parse structured output.
   - If `--output html`, generate a visual plan page with state machine, API design, edge cases.
   - Otherwise, output markdown.

## Output

- State machine (Mermaid)
- API signatures
- File modification list
- Edge cases table
- Test requirements

## Notes

- Uses `plan` subagent: no Shell, no WriteFile. Pure planning.
- Can be fed into `/kimi:crank` for execution.
