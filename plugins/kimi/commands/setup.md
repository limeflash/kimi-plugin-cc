---
description: Verify kimi-code install, auth, config, MCPs, review gate, and permission defaults.
argument-hint: [--enable-review-gate] [--disable-review-gate] [--enable-afk-default] [--disable-afk-default]
allowed-tools: [Bash, Read, Write, Edit]
---

# /kimi:setup

> Verify kimi-code installation, auth, config, MCP config, MCP parity, and configure defaults.

## Process

1. **Check binary**
   ```
   Bash("which kimi || ls ~/.kimi-code/bin/kimi; kimi --version 2>/dev/null || ~/.kimi-code/bin/kimi --version")
   ```
   - Requires kimi-code >= 0.26.0 (the TypeScript CLI). If missing: instruct
     user to install via `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash`.
   - If the legacy Python kimi-cli is found instead (`kimi --version` reports
     1.x): instruct user to install kimi-code and run `kimi migrate`.

2. **Check config validity + auth**
   ```
   Bash("kimi doctor")
   Bash("grep -c 'oauth\\|api_key' ~/.kimi-code/config.toml")
   ```
   - If no provider/credentials configured, instruct user to run `kimi login`.
   - Do NOT run a model prompt just to test auth — `kimi doctor` plus config
     inspection is enough and costs nothing.

3. **Check MCP config**
   ```
   Read("~/.kimi-code/mcp.json")
   ```
   - Report number of configured MCP servers (file may not exist — that's fine).
   - Note: MCP servers never load into the plugin's read-only runs (ephemeral
     `KIMI_CODE_HOME`), and their tools are denied there by the fail-closed rule.

4. **MCP parity check**
   ```
   Read("~/.codex/mcp.json")  # or wherever Claude stores MCP config
   ```
   - Compare Claude's MCP list with Kimi's.
   - Report mismatches (servers present in one but not the other).

5. **Check plugin agent files** (policy selectors for the broker)
   ```
   Read("plugins/kimi/agent-files/coder.yaml")
   Read("plugins/kimi/agent-files/explore.yaml")
   ```

6. **Review gate toggle** (if flags provided)
   - `--enable-review-gate`: update `plugins/kimi/hooks/hooks.json` to enable the Stop hook.
   - `--disable-review-gate`: disable it.

7. **Permission default toggle** (if flags provided)
   - `--enable-afk-default`: writes `default_permission_mode = "yolo"` to `~/.kimi-code/config.toml`.
   - `--disable-afk-default`: sets `default_permission_mode = "manual"`.
   - This affects the user's own interactive `kimi` sessions only. Plugin
     dispatches use `-p`, which always runs under `auto` permission regardless
     of this setting.

8. **Report status**

   ```
   | Check         | Status |
   |---------------|--------|
   | Binary        | PASS (kimi-code 0.26.0) |
   | Config        | PASS (kimi doctor) |
   | Auth          | PASS   |
   | MCPs          | 3      |
   | MCP parity    | 1 mismatch |
   | Agent files   | PASS   |
   | Review gate   | off    |
   | AFK default   | manual |
   ```

## Notes

- Does not mutate user config without explicit flags.
- Safe to run at any time.
