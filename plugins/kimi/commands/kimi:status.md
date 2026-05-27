---
name: kimi:status
description: List active and recent Kimi sessions for the current repository.
argument-hint: [<session-id>]
allowed-tools: [Bash]
---

# /kimi:status

> Check progress on background Kimi work.

## Usage

```
/kimi:status
/kimi:status <session-id>
```

## Process

1. **Query broker**
   ```
   Bash("node plugins/kimi/scripts/broker.mjs status [--session-id <id>]")
   ```

2. **Render results**

   If no session ID:
   ```
   | Session ID | Mode   | Status   | Started | Running |
   |------------|--------|----------|---------|---------|
   | abc123     | crank  | running  | 16:00   | yes     |
   | def456     | review | completed| 15:30   | no      |
   ```

   If session ID provided, show full metadata + tail of output.

## Notes

- Sessions are stored in `~/.kimi-plugin-cc/sessions/`.
- Per-repo latest session tracked in `.kimi/.session`.
