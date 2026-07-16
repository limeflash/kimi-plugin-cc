---
description: Fetch the final output of a completed Kimi session. Supports verbose activity log.
argument-hint: [<session-id>] [--raw] [--verbose]
allowed-tools: [Bash]
---

# /kimi:result

> Retrieve the output from a finished Kimi job.

## Usage

```
/kimi:result
/kimi:result <session-id>
/kimi:result <session-id> --raw
/kimi:result <session-id> --verbose
```

## Process

1. **Determine session ID**
   - If omitted, use the most recent session for this repo (from `.kimi/.session`).

2. **Fetch output**
   ```
   Bash("node plugins/kimi/scripts/broker.mjs result --session-id <id> [--raw]")
   ```

3. **Verbose mode**
   - If `--verbose`, parse the JSONL stream to build an activity log:
     - Files read
     - Files written
     - Shell commands executed
     - Web searches performed
   - Display as a structured table.

## Notes

- If session is still running, note that and suggest `/kimi:status`.
- `--raw` outputs the full JSONL stream for debugging.
