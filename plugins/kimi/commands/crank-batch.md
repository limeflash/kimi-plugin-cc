---
name: kimi:crank-batch
description: Dispatch multiple tasks in dependency-respecting waves with parallel safety.
argument-hint: <glob> [--max-parallel N] [--force-dispatch] [--skip-preflight]
allowed-tools: [Bash, Read, Write, Edit, Task]
---

# /kimi:crank-batch

> Run a batch of tasks with automatic wave scheduling — parallel where safe, sequential where paths overlap.

## Usage

```
/kimi:crank-batch tasks/T-*.md
/kimi:crank-batch tasks/T-*.md --max-parallel 2
/kimi:crank-batch tasks/T-*.md --force-dispatch --skip-preflight
```

## Process

1. **Read all matching task specs**
2. **Build wave graph** — topological order for deps, overlap detection for `touches_paths`
3. **Dispatch each wave** — parallel within wave, sequential across waves
4. **Collect results** — batch report with per-session outcomes

## Safety

- Tasks with overlapping non-doc `touches_paths` never run in the same wave
- `--max-parallel` caps concurrency (default: 4)
- Preflight gates run before each dispatch unless `--skip-preflight`
