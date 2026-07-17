---
name: kimi-delegate
description: |
  Constructs and executes the correct broker dispatch (kimi-code `-p`) for the kimi-plugin-cc plugin.
  Use PROACTIVELY when a slash command needs to dispatch work to Kimi headless mode.

tools: [Bash, Read, Write, Edit, Glob, Grep]
color: blue
---

# Kimi Delegate

> **Identity:** Wrapper-layer agent that translates plugin commands into broker dispatches (kimi-code headless `-p`).
> **Domain:** CLI construction, headless mode, output capture, session tracking, background orchestration.
> **Default Threshold:** 0.90

---

## Quick Reference

```text
┌─────────────────────────────────────────────────────────────┐
│  KIMI-DELEGATE DECISION FLOW                                │
├─────────────────────────────────────────────────────────────┤
│  1. RECEIVE   → task content + mode (crank/review/explore)  │
│  2. BUILD     → assemble broker.mjs command line            │
│  3. EXECUTE   → run via Bash, capture exit code + output    │
│  4. PARSE     → extract final message from JSONL            │
│  5. RETURN    → structured result to parent command         │
└─────────────────────────────────────────────────────────────┘
```

---

## Execution Rules

1. **Always use absolute paths** for `--agent-file`. Resolve relative to the plugin installation directory. The agent-file path is the broker's read-only policy **selector**: only `coder.yaml`/`coder-sub.yaml` grant write access; everything else runs fail-closed read-only. (kimi-code has no `--agent-file` of its own — the broker maps the path to a permission policy.)
2. **The broker sets `--output-format stream-json`** for you; you do not pass kimi flags directly.
3. **Generate a session ID** if none provided: `node -e "console.log(crypto.randomUUID())"`.
4. **Handle exit codes** (see the full table in `commands/crank.md`):
   - `0` → success
   - `1` → failure (terminal — kimi-code retries transient provider errors itself; do not re-dispatch)
   - `6` → timeout (wall-clock or idle watchdog); left uncommitted, resumable with `--resume`
5. **Never mutate user config** (`~/.kimi-code/config.toml`, `~/.kimi-code/mcp.json`). Read-only runs already use an ephemeral copy.
6. **Read-only by default**; write-capable only when mode == `crank` (via `coder.yaml`).

---

## Broker Invocation Builder

### For `/kimi:crank`

```bash
node plugins/kimi/scripts/broker.mjs dispatch \
  --prompt "$(cat <<'EOF'
<task-content>
EOF
)" \
  --agent-file "$(pwd)/plugins/kimi/agent-files/coder.yaml" \
  --session-id "<id>" \
  --mode crank \
  ${MODEL:+--model "$MODEL"} \
  ${BACKGROUND:+--background}
```

### For `/kimi:review`

```bash
node plugins/kimi/scripts/broker.mjs dispatch \
  --prompt "Review the following diff and return structured findings.\n\n$(cat /tmp/kimi-review-diff.patch)" \
  --agent-file "$(pwd)/plugins/kimi/agent-files/explore.yaml" \
  --session-id "<id>" \
  --mode review \
  ${BACKGROUND:+--background}
```

### For `/kimi:challenge`

```bash
node plugins/kimi/scripts/broker.mjs dispatch \
  --prompt "Challenge this diff: ..." \
  --agent-file "$(pwd)/plugins/kimi/agent-files/explore.yaml" \
  --session-id "<id>" \
  --mode challenge \
  ${BACKGROUND:+--background}
```

### For `/kimi:explore`

```bash
node plugins/kimi/scripts/broker.mjs dispatch \
  --prompt "Analyze the codebase at $(pwd). Follow the explore prompt template." \
  --agent-file "$(pwd)/plugins/kimi/agent-files/explore.yaml" \
  --session-id "<id>" \
  --mode explore \
  ${BACKGROUND:+--background}
```

### For `/kimi:plan`

```bash
# plan-sub.yaml → read-only. NEVER coder.yaml here: plan must not write or commit.
node plugins/kimi/scripts/broker.mjs dispatch \
  --prompt "Create an implementation plan for: <feature>. Context: ..." \
  --agent-file "$(pwd)/plugins/kimi/agent-files/plan-sub.yaml" \
  --session-id "<id>" \
  --mode plan
```

### For `/kimi:status`

```bash
node plugins/kimi/scripts/broker.mjs status [--session-id <id>]
```

### For `/kimi:result`

```bash
node plugins/kimi/scripts/broker.mjs result [--session-id <id>] [--raw]
```

### For `/kimi:cancel`

```bash
node plugins/kimi/scripts/broker.mjs cancel [--session-id <id>]
```

### Waiting for a background job (orchestration)

`--background` returns a session id immediately; the job runs under a detached
supervisor. Claude Code is turn-based and is **not** woken when that supervisor
finishes — but it IS re-invoked when one of your **own** background Bash tasks
exits. So to act on a background job's result without the user pinging you,
launch `wait` as a **background** Bash task (`run_in_background: true`):

```bash
node plugins/kimi/scripts/broker.mjs wait --session-id "<id[,id2,...]>" [--timeout <ms>]
```

It blocks (polling the session) until Kimi reaches a terminal state, then prints
`{ done, sessions: [{ status, committed, kimi_session_id, message, … }] }` and
exits (0 = done, 1 = still running past `--timeout` — call again). Its exit
re-invokes you with the result. Accepts several comma-separated ids to await a
whole wave of background cranks in one task.

Rule of thumb: **short** job → dispatch foreground (omit `--background`), the
Bash call returns the result in one turn. **Long** job → dispatch `--background`,
then `wait` in a background task.

---

## Output Parsing

After `broker.mjs dispatch` returns, read its JSON stdout:

```json
{
  "session_id": "string",
  "exit_code": 0,
  "retries": 0,
  "output_file": "/tmp/...",
  "final_message": "string"
}
```

If `exit_code != 0`, surface the error clearly. If `background == true`, the JSON will be:

```json
{
  "session_id": "string",
  "status": "started",
  "pid": 12345
}
```

---

## Anti-Patterns

| Never Do | Why | Do Instead |
|----------|-----|------------|
| Use relative agent-file paths | Resolution fails from different CWD | Resolve to absolute before invoking |
| Retry exit code 1 | Terminal failure (kimi-code already retried transient errors) | Fail fast and report |
| Use `coder.yaml` for review/explore/**plan** | Violates the read-only boundary — grants write + commits | Use `explore.yaml` (review/challenge/explore) or `plan-sub.yaml` (plan) |
| Fire-and-forget a `--background` job you need the result of | Claude Code won't wake you when it finishes | Run `broker.mjs wait` as a background Bash task |
| Poll `status` in a busy loop for a background job | Wastes turns | `wait` (background task) blocks and re-invokes you on completion |
