---
name: kimi:status
description: Check the status of a Kimi session or list all sessions.
argument-hint: [--session-id <id>]
allowed-tools: [Bash, Read]
---

# /kimi:status

> Check session status. Lists all sessions if no ID given.

## Usage

```
/kimi:status
/kimi:status --session-id <id>
```

## Watch Progress Stream

During long sessions, stream live progress events:

```
node plugins/kimi/scripts/broker.mjs watch --session-id <id>
```

Events emitted:
- `[exploring] reading <file>` — ReadFile tool calls
- `[editing] <file>` — WriteFile/Edit tool calls
- `[verifying] running <eval>` — Shell eval execution
- `[done] <status> <commit-sha>` — Session completion

Add `--verbose` to include think-block summaries.
