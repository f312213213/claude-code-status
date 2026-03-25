# Claude Code Status Monitor

Real-time context usage and rate limit tracking for [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

Shows a live status bar at the bottom of your Claude Code session and provides MCP tools for detailed usage analytics.

```
[Opus] ● Ctx: 60% ██████░░░░ | 5h: 35% | 7d: 52%
  120K/200K tokens (in:90000 out:30000)
```

## Install

```bash
git clone https://github.com/user/claude-code-status.git
cd claude-code-status

# Pick your plan type:
bash install.sh monthly   # Pro/Max subscription — hides cost, shows rate limits
bash install.sh usage     # API/pay-per-token — shows cost, all metrics

# Or run without arguments for interactive selection:
bash install.sh
```

Then restart Claude Code.

| Plan | Cost | Context | 5h/7d Limits | Token Details | Lines Changed |
|------|------|---------|--------------|---------------|---------------|
| `monthly` | hidden | shown | shown | shown (>50%) | hidden |
| `usage` | shown | shown | shown | shown (>30%) | shown |

You can re-run `bash install.sh <plan>` anytime to switch presets, or edit `config.json` directly.

The installer:
- Sets the display config for your plan type
- Installs Node.js dependencies (works with pnpm or npm)
- Adds the status line to `~/.claude/settings.json`
- Registers the MCP server for in-conversation tools

### Prerequisites

- **Node.js** >= 18
- **jq** — `brew install jq` (macOS) or `apt install jq` (Linux)

## What You Get

### Status Line (always visible)

A color-coded bar at the bottom of every Claude Code session:

| Segment | Example | Description |
|---------|---------|-------------|
| Model | `[Opus]` | Current model name |
| Context | `● Ctx: 60% ██████░░░░` | Context window usage with progress bar |
| 5h limit | `5h: 35%` | 5-hour rate limit (Pro/Max plans) |
| 7d limit | `7d: 52%` | 7-day rate limit (Pro/Max plans) |
| Tokens | `120K/200K tokens` | Appears when context > 50% |

Colors: green (0–70%), yellow (70–85%), red (85%+).

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

Edit `config.json` in the project directory to toggle what the status line shows:

```json
{
  "statusline": {
    "show_cost": false,
    "show_context": true,
    "show_5h_rate_limit": true,
    "show_7d_rate_limit": true,
    "show_model": true,
    "show_token_details": true,
    "token_details_threshold": 50,
    "show_lines_changed": false
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `show_cost` | `false` | Session cost in USD (useful for API/pay-per-token plans) |
| `show_context` | `true` | Context % and progress bar |
| `show_5h_rate_limit` | `true` | 5-hour rate limit percentage |
| `show_7d_rate_limit` | `true` | 7-day rate limit percentage |
| `show_model` | `true` | Model name tag |
| `show_token_details` | `true` | Token count breakdown on second line |
| `token_details_threshold` | `50` | Show token details when context exceeds this % |
| `show_lines_changed` | `false` | Lines added/removed in session |

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
├── install.sh             # One-command installer
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
# Run the test suite
node test/test.js

# Test the status line manually
echo '{"model":{"display_name":"Opus"},"context_window":{"used_percentage":60,"total_input_tokens":90000,"total_output_tokens":30000,"context_window_size":200000},"rate_limits":{"five_hour":{"used_percentage":35},"seven_day":{"used_percentage":52}},"cost":{"total_cost_usd":0}}' | bash statusline.sh
```

## Uninstall

Remove the `statusLine` and `mcpServers.claude-code-status` keys from `~/.claude/settings.json`, then delete this directory.

## License

MIT
