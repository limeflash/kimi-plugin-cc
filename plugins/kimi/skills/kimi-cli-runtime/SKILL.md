# Kimi CLI Runtime

Reference skill for the `kimi-plugin-cc` plugin. Documents how **kimi-code**
(the TypeScript CLI, >= 0.26.0) is invoked in headless mode. The deprecated
Python `kimi-cli` (with `--print` / `--work-dir` / `--agent-file`) is no longer
supported.

## Headless invocation

```bash
# workspace = process cwd; policy travels via KIMI_CODE_HOME (see below)
kimi -p "<prompt>" --output-format stream-json [-m <model-alias>] [--skills-dir <dir>]
```

## Flags

| Flag | Description |
|------|-------------|
| `-p "<text>"` | Run one prompt non-interactively (print mode) |
| `--output-format stream-json` | JSONL output (one JSON object per line); only valid with `-p` |
| `-m <alias>` | Model alias from `config.toml` `models` table |
| `-S <session-id>` | Resume a kimi-code session (must match cwd + home) |
| `--skills-dir <dir>` | REPLACES skill auto-discovery (empty dir = no skills) |

Never pass `--yolo`, `--auto`, or `--plan` with `-p` — kimi-code rejects the
combination at startup. Print mode always runs under `auto` permission with
asks auto-approved; only `deny` permission rules block tools.

## Policy via KIMI_CODE_HOME

Read-only runs (review/explore/challenge/plan) set `KIMI_CODE_HOME` to an
ephemeral home whose `config.toml` appends the fail-closed deny rule:

```toml
[[permission.rules]]
decision = "deny"
pattern = "!{Read,Grep,Glob,ReadMediaFile}"
```

Brace negation only — extglob `!(...)` silently never matches (the permission
DSL splits on the first paren). Full-access cranks keep the user's real home.

## Exit codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success | Proceed |
| 1 | Any error (startup, API, turn failure) | Fail fast |
| 129 / 130 / 143 | SIGHUP / SIGINT / SIGTERM | Treated as failure |

There is no transient exit code: kimi-code retries provider errors internally
and reports them as `{"role":"meta","type":"turn.step.retrying",...}` lines.

## stream-json schema

```jsonl
{"role":"assistant","content":"...","tool_calls":[{"type":"function","id":"...","function":{"name":"Read","arguments":"{...json string...}"}}]}
{"role":"tool","tool_call_id":"...","content":"..."}
{"role":"meta","type":"turn.step.retrying","failed_attempt":1,...}
{"role":"meta","type":"session.resume_hint","session_id":"session_...","command":"kimi -r session_..."}
```

The final assistant message is the last `role:"assistant"` line with `content`;
the kimi-code session id comes from the trailing `session.resume_hint` meta line.

## Built-in tool names (0.26.0)

Read: `Read`, `Grep`, `Glob`, `ReadMediaFile` · Write: `Write`, `Edit` ·
Exec: `Bash` · Web: `WebSearch`, `FetchURL` · Collab: `Agent`, `AgentSwarm`,
`Skill`, `AskUserQuestion` · State: `TodoList` · Background: `TaskList`,
`TaskOutput`, `TaskStop` · Cron: `CronCreate`, `CronList`, `CronDelete` ·
Plan: `EnterPlanMode`, `ExitPlanMode` · MCP tools: `mcp__<server>__<tool>`
