---
name: kimi:crank
description: Delegate a task file to Kimi for execution. Write-capable. Supports resume and model override.
argument-hint: <path-to-task-md> [--background] [--model <model>] [--resume] [--fresh]
allowed-tools: [Bash, Read, Write, Edit, Task]
---

# /kimi:crank

> Delegate a task to Kimi's coder agent. Captures diff and returns a session ID.

## Usage

```
/kimi:crank tasks/T-20260526-build-kimi-plugin-cc.md
/kimi:crank tasks/T-20260526-build-kimi-plugin-cc.md --background
/kimi:crank tasks/T-20260526-build-kimi-plugin-cc.md --model kimi-k2
/kimi:crank --resume                # continue latest session for this repo
/kimi:crank --fresh                 # start new session, ignore latest
```

## Process

1. **Validate input**
   - Check that the argument path exists and matches `tasks/T-*.md` pattern.
   - Handle `--resume`: read `.kimi/.session` for latest session ID, prepend "Continue from previous session..." to prompt.
   - Handle `--fresh`: ignore `.kimi/.session`.

2. **Read task file**
   ```
   Read(<task-path>)
   ```

3. **Capture pre-run diff**
   ```
   Bash("node plugins/kimi/scripts/broker.mjs diff-capture --session-id <id> --phase pre")
   ```

4. **Dispatch to Kimi via broker**
   ```
   Bash("node plugins/kimi/scripts/broker.mjs dispatch \
     --prompt '<task_content>' \
     --agent-file '$(pwd)/plugins/kimi/agent-files/coder.yaml' \
     --session-id <id> \
     --mode crank \
     [--background] \
     [--model <model>]")
   ```

5. **Capture post-run diff** (foreground only)
   ```
   Bash("node plugins/kimi/scripts/broker.mjs diff-capture --session-id <id> --phase post")
   ```

6. **Surface results**
   - Foreground: final message + diff delta + session ID.
   - Background: session ID + `/kimi:status` reminder.

## Notes

- Uses `coder.yaml` → write-capable, scoped to working directory.
- `--resume` continues the latest repo session; `--fresh` starts clean.
