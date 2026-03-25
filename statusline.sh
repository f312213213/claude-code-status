#!/bin/bash
# Claude Code Status Line — displays context/rate metrics and logs to JSONL
# Receives JSON via stdin from Claude Code
# Configure display via config.json in the same directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.json"
LOG_FILE="$HOME/.claude/metrics-log.jsonl"
INPUT=$(cat)

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")"

# Append to metrics log (background to avoid blocking display)
echo "$INPUT" | jq -c '. + {"_ts": (now * 1000 | floor)}' >> "$LOG_FILE" 2>/dev/null &

# ── Load config (defaults if missing) ──
cfg() {
  local key="$1" default="$2"
  if [ -f "$CONFIG_FILE" ]; then
    local val
    val=$(jq -r ".statusline.${key} // \"${default}\"" "$CONFIG_FILE" 2>/dev/null)
    echo "${val:-$default}"
  else
    echo "$default"
  fi
}

SHOW_MODEL=$(cfg show_model true)
SHOW_CONTEXT=$(cfg show_context true)
SHOW_COST=$(cfg show_cost false)
SHOW_5H=$(cfg show_5h_rate_limit true)
SHOW_7D=$(cfg show_7d_rate_limit true)
SHOW_TOKEN_DETAILS=$(cfg show_token_details true)
TOKEN_THRESHOLD=$(cfg token_details_threshold 50)
SHOW_LINES=$(cfg show_lines_changed false)

# ── Extract fields ──
MODEL=$(echo "$INPUT" | jq -r '.model.display_name // "?"')
CTX_PCT=$(echo "$INPUT" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
COST=$(echo "$INPUT" | jq -r '.cost.total_cost_usd // 0')
FIVE_H=$(echo "$INPUT" | jq -r '.rate_limits.five_hour.used_percentage // empty')
SEVEN_D=$(echo "$INPUT" | jq -r '.rate_limits.seven_day.used_percentage // empty')
INPUT_TOK=$(echo "$INPUT" | jq -r '.context_window.total_input_tokens // 0')
OUTPUT_TOK=$(echo "$INPUT" | jq -r '.context_window.total_output_tokens // 0')
WIN_SIZE=$(echo "$INPUT" | jq -r '.context_window.context_window_size // 200000')
LINES_ADD=$(echo "$INPUT" | jq -r '.cost.total_lines_added // 0')
LINES_DEL=$(echo "$INPUT" | jq -r '.cost.total_lines_removed // 0')

# ── Color codes ──
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
DIM='\033[2m'
RESET='\033[0m'

# Status color based on context percentage
if [ "$CTX_PCT" -ge 85 ]; then
  COLOR=$RED; ICON="●"
elif [ "$CTX_PCT" -ge 70 ]; then
  COLOR=$YELLOW; ICON="●"
else
  COLOR=$GREEN; ICON="●"
fi

# ── Build line 1 ──
LINE1=""

# Model
if [ "$SHOW_MODEL" = "true" ]; then
  LINE1+="[${MODEL}] "
fi

# Context bar with token counts
if [ "$SHOW_CONTEXT" = "true" ]; then
  FILLED=$((CTX_PCT / 10))
  EMPTY=$((10 - FILLED))
  BAR=""
  for ((i=0; i<FILLED; i++)); do BAR+="█"; done
  for ((i=0; i<EMPTY; i++)); do BAR+="░"; done

  TOTAL_TOK=$((INPUT_TOK + OUTPUT_TOK))
  if [ "$TOTAL_TOK" -ge 1000000 ]; then
    TOK_FMT="$(echo "scale=1; $TOTAL_TOK / 1000000" | bc)M"
  elif [ "$TOTAL_TOK" -ge 1000 ]; then
    TOK_FMT="$((TOTAL_TOK / 1000))K"
  else
    TOK_FMT="$TOTAL_TOK"
  fi
  if [ "$WIN_SIZE" -ge 1000000 ]; then
    WIN_FMT="$(echo "scale=1; $WIN_SIZE / 1000000" | bc)M"
  elif [ "$WIN_SIZE" -ge 1000 ]; then
    WIN_FMT="$((WIN_SIZE / 1000))K"
  else
    WIN_FMT="$WIN_SIZE"
  fi

  LINE1+="${COLOR}${ICON}${RESET} ${TOK_FMT}/${WIN_FMT} (${CTX_PCT}%) ${COLOR}${BAR}${RESET}"
fi

# 5-hour rate limit
if [ "$SHOW_5H" = "true" ] && [ -n "$FIVE_H" ]; then
  FIVE_H_INT=$(printf '%.0f' "$FIVE_H")
  if [ "$FIVE_H_INT" -ge 85 ]; then
    LINE1+=" | ${RED}5h: ${FIVE_H_INT}%${RESET}"
  elif [ "$FIVE_H_INT" -ge 70 ]; then
    LINE1+=" | ${YELLOW}5h: ${FIVE_H_INT}%${RESET}"
  else
    LINE1+=" | 5h: ${FIVE_H_INT}%"
  fi
fi

# 7-day rate limit
if [ "$SHOW_7D" = "true" ] && [ -n "$SEVEN_D" ]; then
  SEVEN_D_INT=$(printf '%.0f' "$SEVEN_D")
  if [ "$SEVEN_D_INT" -ge 85 ]; then
    LINE1+=" | ${RED}7d: ${SEVEN_D_INT}%${RESET}"
  elif [ "$SEVEN_D_INT" -ge 70 ]; then
    LINE1+=" | ${YELLOW}7d: ${SEVEN_D_INT}%${RESET}"
  else
    LINE1+=" | 7d: ${SEVEN_D_INT}%"
  fi
fi

# Cost (off by default for monthly plans)
if [ "$SHOW_COST" = "true" ]; then
  if (( $(echo "$COST > 0" | bc -l 2>/dev/null || echo 0) )); then
    COST_FMT=$(printf '$%.2f' "$COST")
  else
    COST_FMT='$0.00'
  fi
  LINE1+=" | ${COST_FMT}"
fi

# Lines changed
if [ "$SHOW_LINES" = "true" ]; then
  LINE1+=" | ${GREEN}+${LINES_ADD}${RESET}/${RED}-${LINES_DEL}${RESET}"
fi

echo -e "$LINE1"

# ── Line 2: token details when context exceeds threshold ──
if [ "$SHOW_TOKEN_DETAILS" = "true" ] && [ "$CTX_PCT" -ge "$TOKEN_THRESHOLD" ]; then
  TOTAL_TOK=$((INPUT_TOK + OUTPUT_TOK))
  if [ "$TOTAL_TOK" -ge 1000000 ]; then
    TOK_FMT="$(echo "scale=1; $TOTAL_TOK / 1000000" | bc)M"
  elif [ "$TOTAL_TOK" -ge 1000 ]; then
    TOK_FMT="$((TOTAL_TOK / 1000))K"
  else
    TOK_FMT="$TOTAL_TOK"
  fi

  if [ "$WIN_SIZE" -ge 1000000 ]; then
    WIN_FMT="$(echo "scale=1; $WIN_SIZE / 1000000" | bc)M"
  elif [ "$WIN_SIZE" -ge 1000 ]; then
    WIN_FMT="$((WIN_SIZE / 1000))K"
  else
    WIN_FMT="$WIN_SIZE"
  fi

  echo -e "${DIM}  ${TOK_FMT}/${WIN_FMT} tokens (in:${INPUT_TOK} out:${OUTPUT_TOK})${RESET}"
fi
