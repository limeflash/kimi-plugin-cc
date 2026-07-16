---
description: Check for plugin updates and install the latest version.
argument-hint: [--check-only]
allowed-tools: [Bash, Read]
---

# /kimi:update

> Check for updates and install the latest version of the Kimi plugin.

## Usage

```
/kimi:update
/kimi:update --check-only
```

## Process

1. **Check current version**
   ```
   Bash("node plugins/kimi/scripts/broker.mjs check-update")
   ```

2. **If behind (`behind: true`)**
   ```
   Bash("cd $(git rev-parse --show-toplevel) && git pull")
   ```
   - Pull latest changes from origin
   - Verify with `git log --oneline -1`

3. **Reload plugin**
   ```
   /reload-plugins
   ```

4. **Verify new version**
   ```
   Bash("node plugins/kimi/scripts/broker.mjs check-update")
   ```

5. **Report**

   ```
   | Check        | Before | After | Status |
   |--------------|--------|-------|--------|
   | Version      | 0.2.1  | 0.3.0 | ✅     |
   | Git pull     | —      | —     | ✅     |
   | Plugin reload| —      | —     | ✅     |
   ```

## `--check-only`

Reports whether an update is available without installing it:

```
/kimi:update --check-only
# → Update available: 0.2.1 → 0.3.0
# → Run /kimi:update to install
```

## Notes

- Requires the plugin was installed from git (not npm)
- If installed via `/plugin marketplace add`, use `/plugin update` instead
- Safe to run at any time — does nothing if already on latest
