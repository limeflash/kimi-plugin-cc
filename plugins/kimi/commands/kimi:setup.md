---
name: kimi:setup
description: Verify Kimi CLI install, auth, agent files, MCPs, review gate, and AFK defaults.
argument-hint: [--enable-review-gate] [--disable-review-gate] [--enable-afk-default] [--disable-afk-default]
allowed-tools: [Bash, Read, Write, Edit]
---

# /kimi:setup

> Verify Kimi CLI installation, auth, agent files, MCP config, MCP parity, and configure AFK defaults.

## Process

1. **Check binary**
   ```
   Bash("which kimi && kimi --version")
   ```
   - If missing: instruct user to install via `curl -LsSf https://code.kimi.com/install.sh | bash`

2. **Check auth**
   ```
   Bash("kimi --print -p 'hello' --final-message-only 2>&1 | head -n 5")
   ```
   - If auth error, instruct user to run `kimi login`.

3. **Check MCP config**
   ```
   Read("~/.kimi/mcp.json")
   ```
   - Report number of configured MCP servers.

4. **MCP parity check**
   ```
   Read("~/.codex/mcp.json")  # or wherever Claude stores MCP config
   ```
   - Compare Claude's MCP list with Kimi's.
   - Report mismatches (servers present in one but not the other).

5. **Check plugin agent files**
   ```
   Read("plugins/kimi/agent-files/coder.yaml")
   Read("plugins/kimi/agent-files/explore.yaml")
   ```

6. **Review gate toggle** (if flags provided)
   - `--enable-review-gate`: update `plugins/kimi/hooks/hooks.json` to enable the Stop hook.
   - `--disable-review-gate`: disable it.

7. **AFK default toggle** (if flags provided)
   - `--enable-afk-default`: writes `default_yolo = true` to `~/.kimi/config.toml`.
   - `--disable-afk-default`: removes or sets `default_yolo = false`.
   - This makes every Kimi session auto-approved by default — no more HITL prompts.

8. **Agent-file auto-scaffold**
   - If `.claude/agents/` exists and `.kimi/agents/` does not, offer to scaffold Kimi agent files.

9. **Report status**

   ```
   | Check         | Status |
   |---------------|--------|
   | Binary        | PASS   |
   | Auth          | PASS   |
   | MCPs          | 3      |
   | MCP parity    | 1 mismatch |
   | Agent files   | PASS   |
   | Review gate   | off    |
   | AFK default   | on     |
   ```

## Notes

- Does not mutate user config without explicit flags.
- `--enable-afk-default` is the recommended setup for plugin users — it eliminates HITL friction.
- Safe to run at any time.
