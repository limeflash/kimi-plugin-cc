# Kimi CLI Runtime

Reference skill for the `kimi-plugin-cc` plugin. Documents how the Kimi CLI is invoked in headless mode.

## Headless invocation

```bash
kimi --print --output-format stream-json --agent-file <path> -p "<prompt>"
```

## Flags

| Flag | Description |
|------|-------------|
| `--print` | Non-interactive mode |
| `--quiet` | Shorthand for `--print --output-format text --final-message-only` |
| `--output-format stream-json` | JSONL output (one JSON per line) |
| `--agent-file <path>` | Load custom agent YAML |
| `--model <name>` | Override model |
| `-p "<text>"` | Pass prompt |

## Exit codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Proceed |
| 1 | Permanent failure | Fail fast |
| 75 | Transient failure | Retry with backoff (max 3) |

## Agent file format

```yaml
version: 1
agent:
  name: my-agent
  extend: default
  system_prompt_path: ./system.md
  tools:
    - "kimi_cli.tools.shell:Shell"
    - "kimi_cli.tools.file:ReadFile"
```

## Subagent types

- `coder` — general software engineering (read/write/shell)
- `explore` — read-only codebase exploration
- `plan` — architecture design (no shell, no write)
