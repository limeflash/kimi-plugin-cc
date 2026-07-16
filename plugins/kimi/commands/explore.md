---
description: Deep codebase exploration using Kimi's native explore subagent. Produces Executive Summary, Health Score, and Architecture Deep Dive.
argument-hint: [--background] [--output html]
allowed-tools: [Bash, Read, Task]
---

# /kimi:explore

> Structured codebase analysis: Executive Summary + Health Score + Architecture Deep Dive.

## Usage

```
/kimi:explore
/kimi:explore --background
/kimi:explore --output html
```

## Process

1. **Load explore prompt template**
   ```
   Read("plugins/kimi/prompts/explore.md")
   ```

2. **Dispatch to Kimi**
   - Prompt: "Analyze the codebase at $(pwd) and produce a structured report."
   - Use `explore.yaml` agent file.
   ```
   Bash("node plugins/kimi/scripts/broker.mjs dispatch \
     --prompt 'Analyze the codebase at $(pwd). Follow the explore prompt template.' \
     --agent-file '$(pwd)/plugins/kimi/agent-files/explore.yaml' \
     --mode explore \
     [--background]")
   ```

3. **Parse and render**
   - Parse JSON output for `summary`, `healthScore`, `techStack`, `insights`, `architecture`.
   - If `--output html`, generate a visual explainer HTML page.
   - Otherwise, render markdown report.

## Output

```markdown
## 🎯 Executive Summary
...
### Health Score: 8/10
...
### Tech Stack
...
### Key Insights
...
```

## Notes

- Uses Kimi's native `explore` subagent — fast, read-only, scoped.
- Inspired by `.claude/agents/exploration/codebase-explorer.md`.
