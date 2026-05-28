# Changelog

## 0.3.0

- Node.js broker with 16 subcommands and command registry pattern
- MCP integrations: Tavily (research/docs/validation), Firecrawl (structured extraction/monitoring), Exa (semantic patterns)
- 12-stage dispatch pipeline with preflight sandboxing, origin-state checks, and graceful degradation
- Wave-based batch orchestration with topological sort and path-conflict detection
- Checkpoint/resume with automatic diff stashing
- Structured warning system (JSONL)
- Telemetry parsing with token usage and cost estimation
- Codex adversarial review gates (plan + diff)
- Live progress streaming via output.jsonl polling
- Scoped context injection with picomatch glob rules
- Auto `.env` loading with `.env.example` template

## 0.2.1

- Node.js broker rewrite with 6 library modules
- 9 slash commands: crank, review, challenge, explore, plan, status, result, cancel, setup
- AFK/YOLO support for unattended execution
- Workspace-aware sessions with per-repo resume
- Structured output parsing from Kimi stream-json
- Optional review gate via Stop hook
- Agent security boundaries: coder (write), explore (read-only), plan (no shell)

## 0.1.0

- Initial version with bash-based implementation
- 6 commands: crank, review, status, result, cancel, setup
