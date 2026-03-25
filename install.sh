#!/bin/bash
# Install Claude Code Status Monitor
# Usage:
#   bash install.sh              # interactive plan selection
#   bash install.sh monthly      # Pro/Max monthly plan (no cost, focus on rate limits)
#   bash install.sh usage        # API/pay-per-token plan (show cost, all metrics)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
CONFIG_FILE="$SCRIPT_DIR/config.json"

PLAN="${1:-}"

echo "╔══════════════════════════════════════════╗"
echo "║  Claude Code Status Monitor - Installer  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Plan selection ──

if [ -z "$PLAN" ]; then
  echo "Select your plan type:"
  echo ""
  echo "  1) monthly  — Pro/Max monthly subscription"
  echo "                Hides cost. Shows context, 5h & 7d rate limits."
  echo ""
  echo "  2) usage    — API / pay-per-token"
  echo "                Shows cost, burn rate, all metrics."
  echo ""
  read -rp "Enter choice [1/2] or plan name: " CHOICE
  case "$CHOICE" in
    1|monthly) PLAN="monthly" ;;
    2|usage)   PLAN="usage" ;;
    *)
      echo "✗ Unknown choice: $CHOICE"
      echo "  Use: bash install.sh monthly  OR  bash install.sh usage"
      exit 1
      ;;
  esac
fi

# Normalize
PLAN=$(echo "$PLAN" | tr '[:upper:]' '[:lower:]')

case "$PLAN" in
  monthly)
    echo "→ Plan: monthly (cost hidden, rate limits + reset timers visible)"
    cat > "$CONFIG_FILE" << 'EOF'
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
EOF
    ;;
  usage)
    echo "→ Plan: usage (cost visible, no rate limits)"
    cat > "$CONFIG_FILE" << 'EOF'
{
  "statusline": {
    "layout": "expanded",
    "show_model": true,
    "show_context": true,
    "show_5h_rate_limit": false,
    "show_7d_rate_limit": false,
    "show_git": true,
    "show_project": true,
    "show_cost": true,
    "show_lines_changed": true
  }
}
EOF
    ;;
  *)
    echo "✗ Unknown plan: $PLAN"
    echo "  Use: bash install.sh monthly  OR  bash install.sh usage"
    exit 1
    ;;
esac

echo ""

# ── Check prerequisites ──

if ! command -v jq &>/dev/null; then
  echo "⚠  jq is required for the status line."
  echo "   Install with: brew install jq (macOS) or apt install jq (Linux)"
  echo ""
fi

if ! command -v node &>/dev/null; then
  echo "✗ Node.js is required for the MCP server."
  echo "  Install from https://nodejs.org"
  exit 1
fi

# ── Install dependencies ──

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "→ Installing dependencies..."
  cd "$SCRIPT_DIR"
  if command -v pnpm &>/dev/null; then
    pnpm install
  elif command -v npm &>/dev/null; then
    npm install
  else
    echo "✗ No package manager found. Install pnpm or npm first."
    exit 1
  fi
fi

# ── Ensure .claude directory exists ──

mkdir -p "$CLAUDE_DIR"

echo ""
echo "→ Configuring: $SETTINGS_FILE"

# ── Merge into settings.json ──

if [ -f "$SETTINGS_FILE" ]; then
  EXISTING=$(cat "$SETTINGS_FILE")
else
  EXISTING="{}"
fi

UPDATED=$(node -e "
const existing = JSON.parse(process.argv[1]);
const scriptDir = process.argv[2];

existing.statusLine = {
  type: 'command',
  command: scriptDir + '/statusline.sh',
  padding: 2
};

if (!existing.mcpServers) existing.mcpServers = {};
existing.mcpServers['claude-code-status'] = {
  type: 'stdio',
  command: 'node',
  args: [scriptDir + '/metrics-server.js']
};

console.log(JSON.stringify(existing, null, 2));
" "$EXISTING" "$SCRIPT_DIR")

echo "$UPDATED" > "$SETTINGS_FILE"

echo ""
echo "✓ Config:      $CONFIG_FILE ($PLAN)"
echo "✓ Status line: $SCRIPT_DIR/statusline.sh"
echo "✓ MCP server:  claude-code-status"
echo ""
echo "Restart Claude Code to activate. Done!"
