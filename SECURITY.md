# Security notes — the read-only guarantee (honest version)

This fork adopts the hardening approach from
[limeflash/antigravity-plugin-cc](https://github.com/limeflash/antigravity-plugin-cc)
(the `agy` plugin). This document states the **real** guarantee level, including
its current gaps, rather than an optimistic one.

Since v0.4.0 the plugin targets **kimi-code** (the actively maintained
TypeScript CLI, >= 0.26.0), not the deprecated Python `kimi-cli`. The read-only
model changed with the port — for the better.

## How "read-only" works today

`/kimi:review`, `/kimi:challenge`, `/kimi:explore` run:

```
KIMI_CODE_HOME=<ephemeral home> kimi -p "…" --output-format stream-json --skills-dir <empty>
```

with the repository as the process working directory. Three facts define the
guarantee (all verified against the kimi-code 0.26.0 source and live-probed):

1. **In `-p` (print) mode everything is auto-approved.** The permission mode is
   forced to `auto` and the headless approval handler approves anything that
   would normally "ask" (`run-prompt.ts: installHeadlessHandlers`). So "no
   approval prompt" is NOT what makes these read-only.
2. **A user-configured `deny` permission rule is the only hard gate that
   survives `-p`.** `UserConfiguredDenyPermissionPolicy` is evaluated *before*
   auto/yolo approval, and deny rules beat allow rules regardless of order
   (`agent-core/src/agent/permission/policies/index.ts`). Hooks are explicitly
   fail-open by design and are not used as a barrier.
3. **The deny rule is fail-CLOSED.** The ephemeral `KIMI_CODE_HOME` carries the
   user's config plus one rule:

   ```toml
   [[permission.rules]]
   decision = "deny"
   pattern = "!{Read,Grep,Glob,ReadMediaFile}"
   ```

   Brace negation matches **every tool that is not one of the four read
   tools** — including `Write`, `Edit`, `Bash`, `Agent`, MCP tools
   (`mcp__server__tool`), plugin/skill tools, and any tool a future kimi-code
   version adds. (The extglob form `!(a|b)` must never be used here: the
   permission DSL splits on the first `(`, silently turning it into a rule that
   matches nothing — fail-open. Guarded by tests.)

Additional containment from the ephemeral home:

- The user's global `mcp.json`, `[[hooks]]`, and skills never load into
  read-only runs (the home is separate; `--skills-dir` points at an empty dir).
- OAuth credentials are **symlinked**, not copied, so token refresh keeps
  working and no credential is forked into plugin state.
- Telemetry and auto-update are disabled for read-only runs.

Live verification (macOS, kimi-code 0.26.0): a read-only session asked to
create `PROVE.txt` was denied — `Tool "Write" was denied by permission rule` —
and the file was not created; a read of `README.md` in the same configuration
succeeded.

## What is still thin

1. **No filesystem backstop.** The guarantee rests on kimi-code's permission
   engine. There is no OS-level isolation, so a bug in that engine would let
   writes land in your working tree. The robust move remains running the CLI
   *outside* the repo (worktree / staged-diff temp dir, the agy design) — still
   on the roadmap.
2. Read-only commands still write `.kimi/.session` into your repo
   (`workspace.mjs writeRepoSession`) — plugin bookkeeping, not your code, but
   not literally "touches nothing."
3. The full-access crank (`coder.yaml`) intentionally has **no** deny rules and
   runs under your real `KIMI_CODE_HOME` — your MCP servers and hooks apply
   there.

## Hardening status

- [x] **Secret scan.** `plugins/kimi/scripts/lib/secrets.mjs` — scans assembled
  prompts for leaked credentials (AWS, GitHub, Slack, Anthropic, OpenAI/Moonshot
  `sk-`, PEM, inline assignments) before material is shipped to Kimi → Moonshot.
  Wired as a hard preflight in `invokeKimi`; override with `KIMI_ALLOW_SECRETS=1`.
- [x] **Fail-closed read-only (kimi-code).** Ephemeral `KIMI_CODE_HOME` with the
  brace-negation deny rule, selected by agent-file with a fail-closed default
  (only `coder*.yaml` gets full access; unknown files run read-only).
- [ ] **Filesystem isolation (the backstop).** Run kimi *outside* your working
  tree, per command: `explore` via a detached git worktree; `review`/`challenge`
  (which need your **uncommitted** diff) via a staged temp dir. Strip
  repo-locating env (`GIT_DIR`, `GIT_WORK_TREE`, …) as defense in depth.

## Honest guarantee levels

- **Today:** read-only *by kimi-code's permission engine* — fail-closed against
  new/MCP/plugin tools, live-verified, but with no filesystem backstop.
- **After the roadmap:** read-only *by construction* (kimi can't reach the repo
  to write) on top of the fail-closed deny — the agy tier.

## Reporting

Please report security issues privately via GitHub security advisories on this
repository rather than public issues.
