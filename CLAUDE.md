# CLAUDE.md — claude-code-status

## What This Project Is

A Claude Code extension that provides real-time context usage monitoring via two components:
1. **Status line** (`statusline.sh`) — bash script that Claude Code pipes JSON to on every update; displays a color-coded bar and logs to JSONL
2. **MCP server** (`metrics-server.js`) — Node.js stdio server exposing 5 tools for detailed usage analytics

## Architecture

```
Claude Code stdin → statusline.sh → display + append ~/.claude/metrics-log.jsonl
Claude Code MCP  → metrics-server.js → reads JSONL → returns analysis
```

- `lib/metrics-store.js` — JSONL read/write/rotate (30-day retention)
- `lib/analyzer.js` — session analysis, 5h window, weekly summary, predictions
- `lib/formatter.js` — terminal tables, progress bars, status indicators
- `config.json` — toggles for what the status line displays

## Commands

```bash
pnpm install              # install dependencies (always use pnpm, not npm)
pnpm test                 # run 25-test suite (node test/test.js)
bash install.sh monthly   # configure for Pro/Max monthly plan
bash install.sh usage     # configure for API/pay-per-token plan
```

## Key Conventions

- ES modules (`"type": "module"` in package.json) — use `import`/`export`, not `require`
- No build step — all files run directly with Node.js
- Status line is bash+jq for zero startup latency; MCP server is Node.js for rich data processing
- Config is read from `config.json` adjacent to `statusline.sh` (not from ~/.claude)
- Metrics log lives at `~/.claude/metrics-log.jsonl` — append-only JSONL, one entry per status line update
- Tests use Node.js `assert` module directly, no test framework — run with `node test/test.js`
- Tests read/write to the real log path (`~/.claude/metrics-log.jsonl`) — they `clear()` before and after

## MCP Tools

| Tool | Purpose |
|------|---------|
| `get_session_metrics` | Current context, model, cost, rate limits |
| `get_usage_window` | Last N hours: tokens, requests, burn rate |
| `get_weekly_summary` | 7-day daily breakdown with trend |
| `export_metrics` | Full dashboard as JSON or table |
| `get_predictions` | Time to context limit, recommendations |

## When Modifying

- If adding a new status line field: update `statusline.sh` (display), `config.json` (toggle), and the README config table
- If adding a new MCP tool: add to `metrics-server.js`, add analyzer logic in `lib/analyzer.js`, add formatter in `lib/formatter.js`
- If changing the JSONL schema: check `lib/metrics-store.js` and all analyzer functions that read entries
- Always run `pnpm test` after changes
