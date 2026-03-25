const BOX = {
  tl: "\u2554", tr: "\u2557", bl: "\u255A", br: "\u255D",
  h: "\u2550", v: "\u2551",
  itl: "\u250C", itr: "\u2510", ibl: "\u2514", ibr: "\u2518",
  ih: "\u2500", iv: "\u2502", cross: "\u253C",
  lt: "\u251C", rt: "\u2524", tt: "\u252C", bt: "\u2534",
};

function progressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

function statusColor(pct) {
  if (pct >= 85) return "red";
  if (pct >= 70) return "yellow";
  return "green";
}

function statusIndicator(pct) {
  if (pct >= 85) return "\u{1F534}";
  if (pct >= 70) return "\u{1F7E1}";
  return "\u{1F7E2}";
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function padRight(str, len) {
  return str + " ".repeat(Math.max(0, len - str.length));
}

function padLeft(str, len) {
  return " ".repeat(Math.max(0, len - str.length)) + str;
}

function formatDuration(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${sec % 60}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function dayName(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function formatSessionMetrics(session) {
  if (!session) return "No session data available.";

  const lines = [];
  const W = 52;
  lines.push(`${BOX.tl}${BOX.h.repeat(W)}${BOX.tr}`);
  lines.push(`${BOX.v}    Claude Code Context Usage Monitor     ${BOX.v}`);
  lines.push(`${BOX.v}${BOX.h.repeat(W)}${BOX.v}`);

  const bar = progressBar(session.used_percentage);
  const ind = statusIndicator(session.used_percentage);
  lines.push(`${BOX.v} ${ind} Context: ${formatTokens(session.tokens_used)} / ${formatTokens(session.tokens_available)} (${session.used_percentage}%) ${bar} ${BOX.v}`);
  lines.push(`${BOX.v}   Remaining: ${formatTokens(session.tokens_remaining)} tokens ${BOX.v}`);
  lines.push(`${BOX.v}   Model: ${session.model} (${session.model_id}) ${BOX.v}`);
  lines.push(`${BOX.v}   Cost: $${session.cost_usd.toFixed(4)} | Duration: ${formatDuration(session.duration_ms)} ${BOX.v}`);
  lines.push(`${BOX.v}   Lines: +${session.lines_added} / -${session.lines_removed} ${BOX.v}`);

  if (session.rate_limits.five_hour) {
    const rl5 = session.rate_limits.five_hour;
    const pct5 = Math.round(rl5.used_percentage || 0);
    const reset5 = rl5.resets_at ? new Date(rl5.resets_at * 1000).toLocaleTimeString() : "N/A";
    lines.push(`${BOX.v}   5h Rate Limit: ${pct5}% ${progressBar(pct5, 10)} (resets ${reset5}) ${BOX.v}`);
  }
  if (session.rate_limits.seven_day) {
    const rl7 = session.rate_limits.seven_day;
    const pct7 = Math.round(rl7.used_percentage || 0);
    const reset7 = rl7.resets_at ? new Date(rl7.resets_at * 1000).toLocaleTimeString() : "N/A";
    lines.push(`${BOX.v}   7d Rate Limit: ${pct7}% ${progressBar(pct7, 10)} (resets ${reset7}) ${BOX.v}`);
  }

  lines.push(`${BOX.bl}${BOX.h.repeat(W)}${BOX.br}`);
  return lines.join("\n");
}

export function formatUsageWindow(window) {
  if (!window || window.total_requests === 0) {
    return `No usage data in the last ${window?.hours || 5} hours.`;
  }

  const lines = [];
  lines.push(`Last ${window.hours} Hours`);
  lines.push(`${BOX.ih.repeat(30)}`);
  lines.push(`Total tokens:    ${formatTokens(window.total_tokens)}`);
  lines.push(`Requests:        ${window.total_requests}`);
  lines.push(`Avg per request: ${formatTokens(window.avg_per_request)}`);
  lines.push(`Burn rate:       ~${window.burn_rate_per_min} tokens/min`);
  if (window.peak_timestamp) {
    lines.push(`Peak usage at:   ${new Date(window.peak_timestamp).toLocaleTimeString()}`);
    lines.push(`Peak tokens:     ${formatTokens(window.peak_tokens)}`);
  }
  return lines.join("\n");
}

export function formatWeeklySummary(weekly) {
  if (!weekly || weekly.total_requests === 0) {
    return "No usage data in the last 7 days.";
  }

  const lines = [];
  lines.push("Weekly Summary (Last 7 days)");
  lines.push("");

  // Table header
  const cols = [
    { header: "Date", width: 12 },
    { header: "Day", width: 5 },
    { header: "Tokens", width: 10 },
    { header: "Requests", width: 10 },
    { header: "Avg/Req", width: 10 },
  ];

  const headerLine = cols.map((c) => padRight(c.header, c.width)).join(BOX.iv);
  const sepLine = cols.map((c) => BOX.ih.repeat(c.width)).join(BOX.cross);

  lines.push(`${BOX.itl}${sepLine}${BOX.itr}`);
  lines.push(`${BOX.iv}${headerLine}${BOX.iv}`);
  lines.push(`${BOX.lt}${sepLine}${BOX.rt}`);

  for (const day of weekly.daily_breakdown) {
    const row = [
      padRight(day.date, cols[0].width),
      padRight(dayName(day.date), cols[1].width),
      padLeft(formatTokens(day.tokens), cols[2].width),
      padLeft(String(day.requests), cols[3].width),
      padLeft(formatTokens(day.avg_per_request), cols[4].width),
    ].join(BOX.iv);
    lines.push(`${BOX.iv}${row}${BOX.iv}`);
  }

  lines.push(`${BOX.ibl}${sepLine}${BOX.ibr}`);
  lines.push("");
  lines.push(`Total:     ${formatTokens(weekly.total_tokens)} tokens (${weekly.total_requests} requests)`);
  lines.push(`Daily Avg: ${formatTokens(weekly.daily_average)} tokens`);
  lines.push(`Peak Day:  ${weekly.peak_day || "N/A"}`);
  lines.push(`Peak Hour: ${weekly.peak_hour}:00`);

  const trendSign = weekly.trend_percentage >= 0 ? "+" : "";
  lines.push(`Trend:     ${weekly.trend_indicator} ${trendSign}${weekly.trend_percentage}% vs previous week`);

  return lines.join("\n");
}

export function formatPredictions(predictions) {
  if (!predictions) return "No prediction data available.";

  const lines = [];
  lines.push("Predictions");
  lines.push(`${BOX.ih.repeat(30)}`);

  if (predictions.estimated_time_remaining) {
    lines.push(`Time to context limit: ${predictions.estimated_time_remaining}`);
  } else {
    lines.push("Time to context limit: N/A (insufficient data)");
  }

  if (predictions.burn_rate_per_min > 0) {
    lines.push(`Current burn rate: ~${predictions.burn_rate_per_min} tokens/min`);
  }
  lines.push(`Tokens remaining: ${formatTokens(predictions.tokens_remaining || 0)}`);

  if (predictions.recommendations.length > 0) {
    lines.push("");
    lines.push("Recommendations:");
    for (const rec of predictions.recommendations) {
      lines.push(`  \u2022 ${rec}`);
    }
  }

  return lines.join("\n");
}

export function formatFullDashboard(session, window, weekly, predictions) {
  const parts = [];
  parts.push(formatSessionMetrics(session));
  parts.push("");
  parts.push(formatUsageWindow(window));
  parts.push("");
  parts.push(formatWeeklySummary(weekly));
  parts.push("");
  parts.push(formatPredictions(predictions));
  return parts.join("\n");
}
