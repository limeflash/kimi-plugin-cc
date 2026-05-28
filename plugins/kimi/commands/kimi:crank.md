---
name: kimi:crank
description: Delegate a task file to Kimi for execution. Write-capable. Supports resume, model override, auto-commit policy, and Codex review hooks.
argument-hint: <path-to-task-md> [--background] [--model <model>] [--resume] [--fresh] [--auto-commit on|off|on-clean] [--plan-review] [--diff-review] [--force-dispatch] [--skip-preflight] [--no-context]
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
/kimi:crank task.md --auto-commit on-clean
/kimi:crank task.md --plan-review --diff-review
```

## Process

1. **Validate input**
   - Check that the argument path exists and matches `tasks/T-*.md` pattern.
   - Handle `--resume`: read `.kimi/.session` for latest session ID, prepend "Continue from previous session..." to prompt.
   - Handle `--fresh`: ignore `.kimi/.session`.

2. **Pre-flight gates**
   - Origin-state check: fetch origin, abort if touched paths diverged (override with `--force-dispatch`).
   - Preflight eval check: run task-spec validator, abort if evals are buggy (override with `--skip-preflight`).
   - Context injection: prepend CLAUDE.md / AGENTS.md / scoped rules (disable with `--no-context`).

3. **Optional Codex review**
   - `--plan-review`: adversarial plan critique before dispatch.
   - `--diff-review`: adversarial diff review before commit.

4. **Read task file**
   ```
   Read(<task-path>)
   ```

5. **Capture pre-run diff**
   ```
   Bash("node plugins/kimi/scripts/broker.mjs diff-capture --session-id <id> --phase pre")
   ```

6. **Dispatch to Kimi via broker**
   ```
   Bash("node plugins/kimi/scripts/broker.mjs dispatch \
     --prompt '<task_content>' \
     --agent-file '$(pwd)/plugins/kimi/agent-files/coder.yaml' \
     --session-id <id> \
     --mode crank \
     [--background] \
     [--model <model>] \
     [--auto-commit on|off|on-clean]")
   ```

7. **Capture post-run diff** (foreground only)
   ```
   Bash("node plugins/kimi/scripts/broker.mjs diff-capture --session-id <id> --phase post")
   ```

8. **Checkpoint recovery**
   - If a session is cancelled, in-progress work is checkpointed to `.kimi/state/checkpoints/`.
   - Restore with `broker.mjs checkpoint --session-id <id> --restore`.

9. **Surface results**
   - Foreground: final message + diff delta + session ID.
   - Background: session ID + `/kimi:status` reminder.

## Notes

- Uses `coder.yaml` → write-capable, scoped to working directory.
- `--resume` continues the latest repo session; `--fresh` starts clean.
- `--auto-commit` policies: `on` (always commit), `off` (never commit), `on-clean` (default: commit only if evals pass on first try).
