# Contributing to kimi-plugin-cc

Thank you for your interest in contributing! This document covers how to set up the development environment, run tests, and cut a release.

## Development Setup

### Prerequisites

- Node.js 18.18 or later
- Kimi CLI v1.44.0 or later (`pip install kimi-cli`)
- Git

### Clone and Install

```bash
git clone https://github.com/luanmorenommaciel/kimi-plugin-cc.git
cd kimi-plugin-cc
npm install
```

### Project Structure

```
kimi-plugin-cc/
├── .claude-plugin/          # Marketplace catalog
│   └── marketplace.json
├── .github/                 # CI/CD workflows
│   └── workflows/
│       └── ci.yml
├── docs/                    # Documentation
│   └── getting-started/
├── plugins/kimi/            # Plugin source (distributed)
│   ├── .claude-plugin/
│   │   └── plugin.json      # Plugin manifest
│   ├── agents/              # Agent definitions for Claude
│   ├── agent-files/         # Kimi CLI agent YAML configs
│   ├── commands/            # Slash command definitions
│   ├── hooks/               # Claude Code hooks
│   ├── prompts/             # Reusable prompt templates
│   ├── schemas/             # JSON schemas for structured output
│   ├── scripts/             # Broker + lib modules
│   │   ├── broker.mjs       # Central dispatch entry point
│   │   └── lib/             # 6 library modules
│   └── skills/              # Reusable skills
├── tests/                   # Test suite
│   ├── *.test.mjs           # Unit tests (Node.js built-in test runner)
│   ├── smoke.sh             # End-to-end smoke test
│   └── fixtures/            # Test fixtures
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── NOTICE
├── package.json
└── README.md
```

## Running Tests

### Unit Tests

```bash
npm test
```

This runs all `*.test.mjs` files using Node.js's built-in test runner.

### Smoke Tests

```bash
npm run smoke
```

This runs `tests/smoke.sh`, which validates all 9 capabilities end-to-end using a temporary workspace.

> **Note:** Smoke tests require a working Kimi CLI installation and may incur API usage.

### Manual Testing

You can test the plugin in a local Claude Code session without publishing:

```bash
# In your project directory
claude --plugin-dir /path/to/kimi-plugin-cc/plugins/kimi
```

## Code Style

- Use ES modules (`.mjs` extension or `"type": "module"` in package.json)
- Prefer `async/await` over callbacks
- Use `node:fs/promises` for async file operations
- Keep lib modules focused — one responsibility per file
- All user-facing strings go through the render module for consistent formatting

## Adding a New Command

1. Create a new file in `plugins/kimi/commands/kimi:<name>.md`
2. Add front matter with `name`, `description`, `argument-hint`, and `allowed-tools`
3. Document the command in `README.md`
4. Add handling in `plugins/kimi/scripts/broker.mjs`
5. Add tests in `tests/commands.test.mjs`
6. Update `CHANGELOG.md`

## Adding a New Prompt Template

1. Create a new file in `plugins/kimi/prompts/<name>.md`
2. Reference it from the relevant command or agent file
3. Update `README.md` if it's user-facing

## Release Process

1. Update version in:
   - `package.json`
   - `.claude-plugin/marketplace.json`
   - `plugins/kimi/.claude-plugin/plugin.json`
   - `plugins/kimi/commands/kimi:setup.md` (if version is mentioned there)
2. Add release notes to `CHANGELOG.md`
3. Run the full test suite: `npm test && npm run smoke`
4. Commit: `git commit -am "release: vX.Y.Z"`
5. Tag: `git tag vX.Y.Z`
6. Push: `git push && git push --tags`
7. The marketplace will pick up the new version automatically

## Security

- Never commit API keys or tokens
- The broker never stores Kimi credentials — it delegates to the local `kimi` CLI
- Session data is stored in `~/.kimi-plugin-cc/`, not in the repo

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
