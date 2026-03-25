# Claude Code Status Monitor

Real-time context usage, rate limit tracking, and git status for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

**Expanded layout** (2 lines):
```
Opus 4.6 (1M context) | .../myproject git:(main) +1 ~3 ?1
██░░░░░░░░ 20K/200K (8%)  5h █░░░░░░░ 16% ~3h49m  7d ██░░░░░░ 22% ~3d0h
```

**Compact layout** (1 line):
```
Opus 4.6 (1M context) | .../myproject | 8% | 5h:16% ⏳~3h49m 7d:22% ⏳~3d0h | main +1 ~3 ?1
```

## Install

One-liner (no git required):

```bash
# Monthly plan (Pro/Max — shows rate limits, hides cost)
curl -fsSL https://raw.githubusercontent.com/f312213213/claude-code-status/main/remote-install.sh | bash -s -- monthly

# API / pay-per-token (shows cost, hides rate limits)
curl -fsSL https://raw.githubusercontent.com/f312213213/claude-code-status/main/remote-install.sh | bash -s -- usage
```

Or clone manually:

```bash
git clone https://github.com/f312213213/claude-code-status.git ~/.claude/plugins/claude-code-status
cd ~/.claude/plugins/claude-code-status
bash install.sh monthly   # or: bash install.sh usage
```

Then restart Claude Code.

| Plan | Cost | Context | 5h/7d Limits | Git Stats | Lines Changed |
|------|------|---------|--------------|-----------|---------------|
| `monthly` | hidden | shown | shown | shown | hidden |
| `usage` | shown | shown | hidden | shown | shown |

Re-run `bash install.sh <plan>` anytime to switch, or edit `config.json` directly.

### Prerequisites

- **Node.js** >= 18
- **jq** — `brew install jq` (macOS) or `apt install jq` (Linux)

## What You Get

### Status Line (always visible)

A color-coded bar at the bottom of every Claude Code session:

| Segment | Example | Description |
|---------|---------|-------------|
| Model | `Opus 4.6 (1M context)` | Current model name (bold) |
| Project | `.../parent/project` | Shortened working directory |
| Git | `git:(main) +1 ~3 ?1` | Branch, staged/unstaged/untracked counts |
| Context | `██░░░░░░░░ 20K/200K (8%)` | Token usage with progress bar |
| 5h limit | `5h █░░░░░░░ 16% ~3h49m` | 5-hour rate limit + time until reset |
| 7d limit | `7d ██░░░░░░ 22% ~3d0h` | 7-day rate limit + time until reset |
| Cost | `$1.23` | Session cost (usage plan only) |
| Lines | `+450/-120` | Lines added/removed (usage plan only) |

Colors: green (0-70%), yellow (70-85%), red (85%+).

### MCP Tools (in-conversation)

Ask Claude to use these during a conversation:

| Tool | What it does |
|------|-------------|
| `get_session_metrics` | Current context, model, cost, rate limits with visual gauges |
| `get_usage_window` | Last N hours: tokens, requests, burn rate, peak usage |
| `get_weekly_summary` | 7-day table with daily breakdown and week-over-week trend |
| `export_metrics` | Full dashboard as JSON or formatted table |
| `get_predictions` | Estimated time to context limit, actionable recommendations |

Example prompts:
- "Show my current session metrics"
- "How's my usage looking this week?"
- "Export my metrics as JSON"
- "How much context do I have left?"

## Configuration

Edit `config.json` in the install directory to toggle what the status line shows:

```json
{
  "statusline": {
    "layout": "expanded",
    "show_model": true,
    "show_context": true,
    "show_5h_rate_limit": true,
    "show_7d_rate_limit": true,
    "show_git": true,
    "show_project": true,
    "show_cost": false,
    "show_lines_changed": false
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `layout` | `expanded` | `expanded` (2 lines) or `compact` (1 line) |
| `show_model` | `true` | Model name |
| `show_context` | `true` | Context % with progress bar and token counts |
| `show_5h_rate_limit` | `true` | 5-hour rate limit with reset timer |
| `show_7d_rate_limit` | `true` | 7-day rate limit with reset timer |
| `show_git` | `true` | Git branch and diff stats (+staged ~unstaged ?untracked) |
| `show_project` | `true` | Shortened project path |
| `show_cost` | `false` | Session cost in USD |
| `show_lines_changed` | `false` | Lines added/removed |

Changes take effect on the next status line update (no restart needed).

## How It Works

1. **Status line** (`statusline.sh`) — Claude Code pipes session JSON to this script on every update. It displays the formatted bar and appends a log entry to `~/.claude/metrics-log.jsonl`.

2. **MCP server** (`metrics-server.js`) — Reads the JSONL log to compute historical analytics: 5-hour windows, weekly breakdowns, burn rates, and predictions.

3. **Data retention** — Log entries older than 30 days are automatically pruned on MCP server startup.

## Project Structure

```
claude-code-status/
├── statusline.sh          # Status line script (bash + jq)
├── metrics-server.js      # MCP server with 5 tools
├── config.json            # Display configuration
├── install.sh             # Local installer
├── remote-install.sh      # Curl one-liner installer (no git required)
├── package.json
├── lib/
│   ├── metrics-store.js   # JSONL read/write/rotate
│   ├── analyzer.js        # Session, window, weekly, predictions
│   └── formatter.js       # Tables, progress bars, indicators
└── test/
    └── test.js            # 25 tests
```

## Testing

```bash
pnpm test

# Or test the status line manually:
echo '{"model":{"display_name":"Opus 4.6 (1M context)"},"workspace":{"current_dir":"/tmp/myproject"},"context_window":{"used_percentage":60,"total_input_tokens":90000,"total_output_tokens":30000,"context_window_size":200000},"rate_limits":{"five_hour":{"used_percentage":35,"resets_at":1742968800},"seven_day":{"used_percentage":52,"resets_at":1743400800}},"cost":{"total_cost_usd":0}}' | bash statusline.sh
```

## Uninstall

Remove the `statusLine` and `mcpServers.claude-code-status` keys from `~/.claude/settings.json`, then delete the install directory.

## License

MIT
