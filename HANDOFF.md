# kimi-plugin-cc hardening — handoff (RESOLVED 2026-07-17)

Fork: **`limeflash/kimi-plugin-cc`** (fork of `luanmorenommaciel/kimi-plugin-cc`).
This handoff is **closed**: every open item was resolved on macOS, and the
plugin was **ported from the deprecated Python `kimi-cli` to kimi-code 0.26.0**
(§4 option 2 — the recommended path) instead of being validated against the
dying CLI.

## Resolution summary

### §2 (was: does `tools:` replace or merge?) — answered from source, both CLIs

- **Legacy kimi-cli**: `tools:` REPLACES the base list on `extend`
  (`agentspec.py` — `base_agent_spec.tools = agent_spec.tools`; only
  `system_prompt_args` merges). The allow-list commit `5a251ea` was therefore
  correct, NOT a regression. The §3 fallback was never needed.
  - Bonus finding: legacy kimi-cli loads **plugin tools and MCP tools on top of
    any agent-file allow-list** (`soul/agent.py load_agent`), and raw
    `--mcp-config` does NOT suppress the default global `mcp.json` (only
    `--mcp-config-file` does). Moot for this plugin after the port, but a real
    hole for anyone still using agent-files as a security boundary on legacy.

### §4 (which CLI) — ported to kimi-code (v0.4.0)

- Invocation: `cwd=<repo>` + `kimi -p <prompt> --output-format stream-json`
  (`-p` rejects `--yolo/--auto/--plan`; workspace = process cwd; binary
  resolved via `KIMI_BIN` → PATH → `~/.kimi-code/bin/kimi`).
- Exit-75 retry contract removed — kimi-code retries transient provider errors
  internally (`meta turn.step.retrying`). Watchdogs kept: kimi-code `-p` has NO
  built-in timeout.
- kimi-code's own session id is captured from the `session.resume_hint` meta
  line into `meta.json` (`kimi_session_id`) for future `-S` resume.

### Read-only enforcement (the §2 hardening, re-implemented for kimi-code)

- In `-p` mode permission is forced `auto` and asks are auto-approved
  (`run-prompt.ts installHeadlessHandlers`) → the ONLY hard gate is a
  user-configured **deny** permission rule (`UserConfiguredDeny` precedes
  `AutoModeApprove`; deny beats allow regardless of config order).
- Fail-closed rule, injected via an **ephemeral `KIMI_CODE_HOME`**
  (`~/.kimi-plugin-cc/kimi-home-readonly/`: user config copy + deny block,
  credentials symlinked, empty `--skills-dir`, telemetry/auto-update off):

  ```toml
  [[permission.rules]]
  decision = "deny"
  pattern = "!{Read,Grep,Glob,ReadMediaFile}"
  ```

  ⚠️ Brace negation is load-bearing: the permission DSL splits patterns on the
  first `(`, so extglob `!(a|b)` parses as tool `"!"` + arg pattern and matches
  NOTHING (silently fail-open). Verified empirically against picomatch 2.3.2
  through a re-implementation of kimi-code's exact parse+match pipeline
  (21/21 tool names correct). Guarded by tests.

- Policy selector: the agent-file path the slash commands already pass. Only
  `coder*.yaml` gets full access under the real home; **anything else —
  including unknown/typoed files — runs read-only** (fail-closed).

### Live verification (macOS, kimi-code 0.26.0, real model)

- `kimi doctor config` on the generated ephemeral config: **OK**.
- PROVE.txt probe through the full plugin path (`invokeKimi` + explore.yaml):
  model attempted `Write` → `Tool "Write" was denied by permission rule.
  Reason: kimi-plugin-cc read-only session…`; **no file created**; exit 0.
- Counter-probe: `Read` of README.md in the same configuration **succeeded**
  (the deny rule does not over-restrict).

### Tests

`npm test`: **89/89 green** (was 78) — new `tests/kimi-home.test.mjs` covers the
allow-set lint (successor of the explore.yaml lint), the no-parens pattern
guard, fail-closed selector behavior, ephemeral-home generation (no deny-rule
accumulation, credentials symlink, missing-user-config path), argv/env
builders, and `KIMI_BIN` resolution.

## Still open (tracked in SECURITY.md, not blockers)

- ~~Filesystem isolation backstop~~ — **done in v0.5.0** (`lib/snapshot.mjs`:
  snapshot workspace = `git archive HEAD` + uncommitted diff + untracked
  files, outside the repo, `GIT_*` env stripped, live-verified).
- Optional: PR the legacy findings upstream to `luanmorenommaciel` (fail-open
  deny-list + secret scan; the kimi-code port itself is a bigger conversation).
