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
SHOW_GIT=$(cfg show_git true)
SHOW_PROJECT=$(cfg show_project true)
SHOW_LINES=$(cfg show_lines_changed false)
LAYOUT=$(cfg layout expanded)

# ── Extract fields ──
MODEL=$(echo "$INPUT" | jq -r '.model.display_name // "?"')
CTX_PCT=$(echo "$INPUT" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
COST=$(echo "$INPUT" | jq -r '.cost.total_cost_usd // 0')
FIVE_H=$(echo "$INPUT" | jq -r '.rate_limits.five_hour.used_percentage // empty')
FIVE_H_RESET=$(echo "$INPUT" | jq -r '.rate_limits.five_hour.resets_at // empty')
SEVEN_D=$(echo "$INPUT" | jq -r '.rate_limits.seven_day.used_percentage // empty')
SEVEN_D_RESET=$(echo "$INPUT" | jq -r '.rate_limits.seven_day.resets_at // empty')
INPUT_TOK=$(echo "$INPUT" | jq -r '.context_window.total_input_tokens // 0')
OUTPUT_TOK=$(echo "$INPUT" | jq -r '.context_window.total_output_tokens // 0')
WIN_SIZE=$(echo "$INPUT" | jq -r '.context_window.context_window_size // 200000')
LINES_ADD=$(echo "$INPUT" | jq -r '.cost.total_lines_added // 0')
LINES_DEL=$(echo "$INPUT" | jq -r '.cost.total_lines_removed // 0')
CWD=$(echo "$INPUT" | jq -r '.workspace.current_dir // empty')

# ── Color codes ──
RED='\033[0;31m'
YELLOW='\033[0;33m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# ── Helper: format token count ──
fmt_tok() {
  local n="$1"
  if [ "$n" -ge 1000000 ]; then
    echo "$(echo "scale=1; $n / 1000000" | bc)M"
  elif [ "$n" -ge 1000 ]; then
    echo "$((n / 1000))K"
  else
    echo "$n"
  fi
}

# ── Helper: progress bar ──
make_bar() {
  local pct="$1" width="${2:-10}"
  local filled=$((pct * width / 100))
  local empty=$((width - filled))
  local bar=""
  for ((i=0; i<filled; i++)); do bar+="█"; done
  for ((i=0; i<empty; i++)); do bar+="░"; done
  echo "$bar"
}

# ── Helper: color for percentage ──
pct_color() {
  local pct="$1"
  if [ "$pct" -ge 85 ]; then echo "$RED"
  elif [ "$pct" -ge 70 ]; then echo "$YELLOW"
  else echo "$GREEN"
  fi
}

# ── Helper: time until reset ──
time_until() {
  local reset_ts="$1"
  if [ -z "$reset_ts" ]; then echo ""; return; fi
  local now
  now=$(date +%s)
  local diff=$((reset_ts - now))
  if [ "$diff" -le 0 ]; then echo "now"; return; fi
  local days=$((diff / 86400))
  local hours=$(( (diff % 86400) / 3600 ))
  local mins=$(( (diff % 3600) / 60 ))
  if [ "$days" -gt 0 ]; then
    echo "~${days}d${hours}h"
  elif [ "$hours" -gt 0 ]; then
    echo "~${hours}h${mins}m"
  else
    echo "~${mins}m"
  fi
}

# ── Helper: git branch ──
get_branch() {
  local dir="${CWD:-.}"
  git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
}

# ── Helper: short project path ──
get_project() {
  local dir="${CWD:-.}"
  local base
  base=$(basename "$dir")
  local parent
  parent=$(basename "$(dirname "$dir")")
  if [ "$parent" = "/" ] || [ "$parent" = "." ]; then
    echo "$base"
  else
    echo ".../$parent/$base"
  fi
}

# ── Compute values ──
TOTAL_TOK=$((INPUT_TOK + OUTPUT_TOK))
TOK_FMT=$(fmt_tok "$TOTAL_TOK")
WIN_FMT=$(fmt_tok "$WIN_SIZE")
CTX_COLOR=$(pct_color "$CTX_PCT")
CTX_BAR=$(make_bar "$CTX_PCT" 10)

BRANCH=""
if [ "$SHOW_GIT" = "true" ]; then
  BRANCH=$(get_branch)
fi

PROJECT=""
if [ "$SHOW_PROJECT" = "true" ] && [ -n "$CWD" ]; then
  PROJECT=$(get_project)
fi

# ══════════════════════════════════════════
# EXPANDED LAYOUT (2 lines, default)
# ══════════════════════════════════════════
if [ "$LAYOUT" = "expanded" ]; then

  # ── Line 1: Model | Project git:(branch) ──
  LINE1=""

  if [ "$SHOW_MODEL" = "true" ]; then
    LINE1+="${BOLD}${MODEL}${RESET}"
  fi

  if [ -n "$PROJECT" ]; then
    LINE1+=" | ${CYAN}${PROJECT}${RESET}"
  fi

  if [ -n "$BRANCH" ]; then
    LINE1+=" git:(${MAGENTA}${BRANCH}${RESET})"

    # Git diff stats: +staged ~unstaged ?untracked
    if [ -n "$CWD" ]; then
      GIT_STATS=""
      STAGED=$(git -C "$CWD" diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
      UNSTAGED=$(git -C "$CWD" diff --numstat 2>/dev/null | wc -l | tr -d ' ')
      UNTRACKED=$(git -C "$CWD" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
      [ "$STAGED" -gt 0 ] && GIT_STATS+=" ${GREEN}+${STAGED}${RESET}"
      [ "$UNSTAGED" -gt 0 ] && GIT_STATS+=" ${YELLOW}~${UNSTAGED}${RESET}"
      [ "$UNTRACKED" -gt 0 ] && GIT_STATS+=" ${DIM}?${UNTRACKED}${RESET}"
      [ -n "$GIT_STATS" ] && LINE1+="$GIT_STATS"
    fi
  fi

  if [ "$SHOW_COST" = "true" ]; then
    if (( $(echo "$COST > 0" | bc -l 2>/dev/null || echo 0) )); then
      COST_FMT=$(printf '$%.2f' "$COST")
    else
      COST_FMT='$0.00'
    fi
    LINE1+=" | ${COST_FMT}"
  fi

  if [ "$SHOW_LINES" = "true" ]; then
    LINE1+=" | ${GREEN}+${LINES_ADD}${RESET}/${RED}-${LINES_DEL}${RESET}"
  fi

  echo -e "$LINE1"

  # ── Line 2: ctx bar | 5h bar ~time | 7d bar ~time ──
  LINE2="${CTX_COLOR}${CTX_BAR}${RESET} ${TOK_FMT}/${WIN_FMT} (${CTX_PCT}%)"

  if [ "$SHOW_5H" = "true" ] && [ -n "$FIVE_H" ]; then
    FIVE_H_INT=$(printf '%.0f' "$FIVE_H")
    FIVE_H_COLOR=$(pct_color "$FIVE_H_INT")
    FIVE_H_BAR=$(make_bar "$FIVE_H_INT" 8)
    FIVE_H_TIME=$(time_until "$FIVE_H_RESET")
    LINE2+="  5h ${FIVE_H_COLOR}${FIVE_H_BAR}${RESET} ${FIVE_H_INT}%"
    [ -n "$FIVE_H_TIME" ] && LINE2+=" ${DIM}${FIVE_H_TIME}${RESET}"
  fi

  if [ "$SHOW_7D" = "true" ] && [ -n "$SEVEN_D" ]; then
    SEVEN_D_INT=$(printf '%.0f' "$SEVEN_D")
    SEVEN_D_COLOR=$(pct_color "$SEVEN_D_INT")
    SEVEN_D_BAR=$(make_bar "$SEVEN_D_INT" 8)
    SEVEN_D_TIME=$(time_until "$SEVEN_D_RESET")
    LINE2+="  7d ${SEVEN_D_COLOR}${SEVEN_D_BAR}${RESET} ${SEVEN_D_INT}%"
    [ -n "$SEVEN_D_TIME" ] && LINE2+=" ${DIM}${SEVEN_D_TIME}${RESET}"
  fi

  echo -e "$LINE2"

# ══════════════════════════════════════════
# COMPACT LAYOUT (1 line)
# ══════════════════════════════════════════
else

  LINE1=""

  if [ "$SHOW_MODEL" = "true" ]; then
    LINE1+="${BOLD}${MODEL}${RESET}"
  fi

  if [ -n "$PROJECT" ]; then
    LINE1+=" | ${CYAN}${PROJECT}${RESET}"
  fi

  LINE1+=" | ${CTX_PCT}%"

  if [ "$SHOW_5H" = "true" ] && [ -n "$FIVE_H" ]; then
    FIVE_H_INT=$(printf '%.0f' "$FIVE_H")
    FIVE_H_COLOR=$(pct_color "$FIVE_H_INT")
    FIVE_H_TIME=$(time_until "$FIVE_H_RESET")
    LINE1+=" | ${FIVE_H_COLOR}5h:${FIVE_H_INT}%${RESET}"
    [ -n "$FIVE_H_TIME" ] && LINE1+=" ⏳${FIVE_H_TIME}"
  fi

  if [ "$SHOW_7D" = "true" ] && [ -n "$SEVEN_D" ]; then
    SEVEN_D_INT=$(printf '%.0f' "$SEVEN_D")
    SEVEN_D_COLOR=$(pct_color "$SEVEN_D_INT")
    SEVEN_D_TIME=$(time_until "$SEVEN_D_RESET")
    LINE1+=" ${SEVEN_D_COLOR}7d:${SEVEN_D_INT}%${RESET}"
    [ -n "$SEVEN_D_TIME" ] && LINE1+=" ⏳${SEVEN_D_TIME}"
  fi

  if [ -n "$BRANCH" ]; then
    LINE1+=" | ${MAGENTA}${BRANCH}${RESET}"
    if [ -n "$CWD" ]; then
      STAGED=$(git -C "$CWD" diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
      UNSTAGED=$(git -C "$CWD" diff --numstat 2>/dev/null | wc -l | tr -d ' ')
      UNTRACKED=$(git -C "$CWD" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
      [ "$STAGED" -gt 0 ] && LINE1+=" ${GREEN}+${STAGED}${RESET}"
      [ "$UNSTAGED" -gt 0 ] && LINE1+=" ${YELLOW}~${UNSTAGED}${RESET}"
      [ "$UNTRACKED" -gt 0 ] && LINE1+=" ${DIM}?${UNTRACKED}${RESET}"
    fi
  fi

  if [ "$SHOW_COST" = "true" ]; then
    if (( $(echo "$COST > 0" | bc -l 2>/dev/null || echo 0) )); then
      LINE1+=" | $(printf '$%.2f' "$COST")"
    fi
  fi

  echo -e "$LINE1"
fi
