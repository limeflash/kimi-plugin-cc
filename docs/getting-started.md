# Getting Started with kimi-plugin-cc

This guide will get you from zero to your first Kimi delegation inside Claude Code in under 5 minutes.

## Prerequisites

1. **Claude Code** — installed and running
2. **Node.js 18.18+** — the broker is a Node.js app
3. **kimi-code CLI** (>= 0.26.0) — install with `curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash` or `npm install -g @moonshot-ai/kimi-code`
4. **Kimi account** — run `kimi login` (device-code OAuth flow)

## Install the Plugin

```bash
# Add the marketplace
/plugin marketplace add limeflash/kimi-plugin-cc

# Install the plugin
/plugin install kimi@limeflash-kimi

# Reload
/reload-plugins
```

## Verify Setup

```bash
/kimi:setup
```

You should see a message confirming Kimi CLI is installed and authenticated.

## Your First Review

```bash
/kimi:review
```

This reviews your current uncommitted changes. For a branch comparison:

```bash
/kimi:review --base main
```

## Your First Delegation

Create a task file in your project's `tasks/` directory:

```markdown
# tasks/T-my-first-task.md

## Goal

Refactor the authentication module to use JWT tokens.

## Success Criteria

1. All existing tests pass
2. No hardcoded secrets
3. Token expiration is configurable

## Anti-patterns

- Do not store tokens in localStorage
- Do not use synchronous bcrypt in request handlers
```

Then delegate it:

```bash
/kimi:crank tasks/T-my-first-task.md
```

## Explore Before You Change

Before modifying unfamiliar code:

```bash
/kimi:explore how does the auth module work?
```

This is read-only and safe to run anywhere.

## Background Tasks

For long-running work, use `--background`:

```bash
/kimi:crank --background tasks/T-my-first-task.md
```

Check progress:

```bash
/kimi:status
```

Get results:

```bash
/kimi:result
```

## Next Steps

- Read the [full command reference](../README.md#usage)
- Learn about [AFK/YOLO mode](../README.md#enabling-afkyolo-default) for unattended execution
- Explore the [review gate](../README.md#enabling-review-gate) for extra safety
