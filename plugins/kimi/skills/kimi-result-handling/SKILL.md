# Kimi Result Handling

Reference skill for parsing `--output-format stream-json` results from Kimi headless mode.

## JSONL format

Each line is a separate JSON object:

```jsonl
{"role":"assistant","content":"Hello!"}
{"role":"assistant","content":"Let me check.","tool_calls":[{"type":"function","id":"tc_1","function":{"name":"Shell","arguments":"{\"command\":\"ls\"}"}}]}
{"role":"tool","tool_call_id":"tc_1","content":"file1.py\nfile2.py"}
```

## Parsing rules

1. **Final message**: last line with `"role":"assistant"` and `"content"` (may also have `tool_calls`).
2. **Tool calls**: extract from `assistant` lines; map to `tool` responses by `tool_call_id`.
3. **Activity log**: collect all `Shell`, `ReadFile`, `WriteFile`, `SearchWeb` tool calls for `--verbose` output.

## Activity log structure

```json
{
  "files_read": ["/path/to/file"],
  "files_written": ["/path/to/file"],
  "commands_executed": ["ls -la"],
  "web_searches": ["query string"]
}
```

## Error handling

- Empty output → check `kimi.log` for stderr.
- Malformed JSONL → skip bad lines, report count.
- Exit code 75 → retry with exponential backoff.
