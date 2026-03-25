#!/bin/bash
# Claude Code Status Monitor — one-line installer (no git required)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/f312213213/claude-code-status/main/remote-install.sh | bash -s -- monthly
#   curl -fsSL https://raw.githubusercontent.com/f312213213/claude-code-status/main/remote-install.sh | bash -s -- usage

set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/f312213213/claude-code-status/main"
INSTALL_DIR="$HOME/.claude/plugins/claude-code-status"
CLAUDE_DIR="$HOME/.claude"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
PLAN="${1:-}"

echo "╔══════════════════════════════════════════╗"
echo "║  Claude Code Status Monitor - Installer  ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Check prerequisites ──

if ! command -v node &>/dev/null; then
  echo "✗ Node.js is required. Install from https://nodejs.org"
  exit 1
fi

if ! command -v jq &>/dev/null; then
  echo "⚠  jq is required for the status line."
  echo "   Install with: brew install jq (macOS) or apt install jq (Linux)"
  echo ""
fi

# ── Plan selection ──

if [ -z "$PLAN" ]; then
  echo "Select your plan type:"
  echo ""
  echo "  1) monthly  — Pro/Max monthly subscription"
  echo "  2) usage    — API / pay-per-token"
  echo ""
  read -rp "Enter choice [1/2]: " CHOICE
  case "$CHOICE" in
    1|monthly) PLAN="monthly" ;;
    2|usage)   PLAN="usage" ;;
    *)
      echo "✗ Unknown choice. Use: curl ... | bash -s -- monthly"
      exit 1
      ;;
  esac
fi

PLAN=$(echo "$PLAN" | tr '[:upper:]' '[:lower:]')

# ── Download files ──

echo "→ Downloading to $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR/lib"

FILES=(
  "statusline.sh"
  "metrics-server.js"
  "package.json"
  "lib/metrics-store.js"
  "lib/analyzer.js"
  "lib/formatter.js"
)

for f in "${FILES[@]}"; do
  curl -fsSL "$REPO_RAW/$f" -o "$INSTALL_DIR/$f"
done

chmod +x "$INSTALL_DIR/statusline.sh"

# ── Write config ──

CONFIG_FILE="$INSTALL_DIR/config.json"

case "$PLAN" in
  monthly)
    echo "→ Plan: monthly (cost hidden, rate limits + reset timers visible)"
    cat > "$CONFIG_FILE" << 'CONF'
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
CONF
    ;;
  usage)
    echo "→ Plan: usage (cost visible, no rate limits)"
    cat > "$CONFIG_FILE" << 'CONF'
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
CONF
    ;;
  *)
    echo "✗ Unknown plan: $PLAN (use 'monthly' or 'usage')"
    exit 1
    ;;
esac

# ── Install Node.js dependencies ──

echo "→ Installing dependencies..."
cd "$INSTALL_DIR"
if command -v pnpm &>/dev/null; then
  pnpm install --silent 2>/dev/null
elif command -v npm &>/dev/null; then
  npm install --silent 2>/dev/null
else
  echo "✗ No package manager found. Install pnpm or npm."
  exit 1
fi

# ── Configure Claude Code settings ──

mkdir -p "$CLAUDE_DIR"

if [ -f "$SETTINGS_FILE" ]; then
  EXISTING=$(cat "$SETTINGS_FILE")
else
  EXISTING="{}"
fi

UPDATED=$(node -e "
const existing = JSON.parse(process.argv[1]);
const dir = process.argv[2];

existing.statusLine = {
  type: 'command',
  command: dir + '/statusline.sh',
  padding: 2
};

if (!existing.mcpServers) existing.mcpServers = {};
existing.mcpServers['claude-code-status'] = {
  type: 'stdio',
  command: 'node',
  args: [dir + '/metrics-server.js']
};

console.log(JSON.stringify(existing, null, 2));
" "$EXISTING" "$INSTALL_DIR")

echo "$UPDATED" > "$SETTINGS_FILE"

echo ""
echo "✓ Installed to: $INSTALL_DIR"
echo "✓ Config:       $CONFIG_FILE ($PLAN)"
echo "✓ Status line:  configured"
echo "✓ MCP server:   configured"
echo ""
echo "Restart Claude Code to activate. Done!"
