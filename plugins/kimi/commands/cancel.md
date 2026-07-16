---
description: Cancel an active background Kimi session.
argument-hint: [<session-id>]
allowed-tools: [Bash]
---

# /kimi:cancel

> Terminate a running Kimi background job.

## Usage

```
/kimi:cancel
/kimi:cancel <session-id>
```

## Process

1. **Determine session ID**
   - If omitted, cancel the most recent running session for this repo.

2. **Send cancel via broker**
   ```
   Bash("node plugins/kimi/scripts/broker.mjs cancel [--session-id <id>]")
   ```

3. **Confirm**
   - Report success or "session not running".

## Notes

- Sends SIGTERM, then SIGKILL after 1s if needed.
- Updates session metadata status to `cancelled`.
