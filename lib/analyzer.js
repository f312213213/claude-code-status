import { readLastNHours, readLastNDays } from "./metrics-store.js";

export function analyzeSession(latestEntry) {
  if (!latestEntry) return null;

  const ctx = latestEntry.context_window || {};
  const cost = latestEntry.cost || {};
  const model = latestEntry.model || {};
  const rateLimits = latestEntry.rate_limits || {};

  const usedPct = ctx.used_percentage || 0;
  let status = "healthy";
  let indicator = "\u{1F7E2}";
  if (usedPct >= 85) {
    status = "warning";
    indicator = "\u{1F534}";
  } else if (usedPct >= 70) {
    status = "caution";
    indicator = "\u{1F7E1}";
  }

  const totalTokens = (ctx.total_input_tokens || 0) + (ctx.total_output_tokens || 0);
  const windowSize = ctx.context_window_size || 200000;
  const remaining = windowSize - totalTokens;

  return {
    model: model.display_name || model.id || "unknown",
    model_id: model.id || "unknown",
    tokens_used: totalTokens,
    tokens_available: windowSize,
    tokens_remaining: Math.max(0, remaining),
    used_percentage: usedPct,
    remaining_percentage: ctx.remaining_percentage || 100 - usedPct,
    status,
    indicator,
    cost_usd: cost.total_cost_usd || 0,
    duration_ms: cost.total_duration_ms || 0,
    lines_added: cost.total_lines_added || 0,
    lines_removed: cost.total_lines_removed || 0,
    rate_limits: {
      five_hour: rateLimits.five_hour || null,
      seven_day: rateLimits.seven_day || null,
    },
    current_usage: ctx.current_usage || null,
  };
}

export function analyzeWindow(hours = 5) {
  const entries = readLastNHours(hours);
  if (entries.length === 0) {
    return {
      hours,
      total_tokens: 0,
      total_requests: 0,
      avg_per_request: 0,
      burn_rate_per_min: 0,
      peak_timestamp: null,
      peak_tokens: 0,
      entries_count: 0,
    };
  }

  let totalTokens = 0;
  let peakTokens = 0;
  let peakTs = null;

  for (const entry of entries) {
    const ctx = entry.context_window || {};
    const tokens = (ctx.total_input_tokens || 0) + (ctx.total_output_tokens || 0);
    totalTokens += tokens;
    if (tokens > peakTokens) {
      peakTokens = tokens;
      peakTs = entry._ts;
    }
  }

  const timeSpanMs = entries.length > 1
    ? entries[entries.length - 1]._ts - entries[0]._ts
    : hours * 60 * 60 * 1000;
  const timeSpanMin = Math.max(1, timeSpanMs / 60000);

  return {
    hours,
    total_tokens: totalTokens,
    total_requests: entries.length,
    avg_per_request: Math.round(totalTokens / entries.length),
    burn_rate_per_min: Math.round(totalTokens / timeSpanMin),
    peak_timestamp: peakTs ? new Date(peakTs).toISOString() : null,
    peak_tokens: peakTokens,
    entries_count: entries.length,
  };
}

export function analyzeWeekly() {
  const entries = readLastNDays(7);
  const prevEntries = readLastNDays(14).filter(
    (e) => e._ts < Date.now() - 7 * 24 * 60 * 60 * 1000
  );

  // Group by day
  const dailyMap = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailyMap[key] = { date: key, tokens: 0, requests: 0 };
  }

  for (const entry of entries) {
    const key = new Date(entry._ts).toISOString().slice(0, 10);
    if (!dailyMap[key]) dailyMap[key] = { date: key, tokens: 0, requests: 0 };
    const ctx = entry.context_window || {};
    dailyMap[key].tokens += (ctx.total_input_tokens || 0) + (ctx.total_output_tokens || 0);
    dailyMap[key].requests += 1;
  }

  const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
  for (const d of daily) {
    d.avg_per_request = d.requests > 0 ? Math.round(d.tokens / d.requests) : 0;
  }

  const totalTokens = daily.reduce((s, d) => s + d.tokens, 0);
  const totalRequests = daily.reduce((s, d) => s + d.requests, 0);
  const dailyAvg = Math.round(totalTokens / 7);

  // Peak day
  const peakDay = daily.reduce((best, d) => (d.tokens > best.tokens ? d : best), daily[0]);

  // Peak hour across all entries
  const hourBuckets = new Array(24).fill(0);
  for (const entry of entries) {
    const hour = new Date(entry._ts).getHours();
    const ctx = entry.context_window || {};
    hourBuckets[hour] += (ctx.total_input_tokens || 0) + (ctx.total_output_tokens || 0);
  }
  const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));

  // Trend vs previous week
  let prevTotal = 0;
  for (const entry of prevEntries) {
    const ctx = entry.context_window || {};
    prevTotal += (ctx.total_input_tokens || 0) + (ctx.total_output_tokens || 0);
  }

  let trendPct = 0;
  let trendIndicator = "\u2192";
  if (prevTotal > 0) {
    trendPct = Math.round(((totalTokens - prevTotal) / prevTotal) * 100);
    if (trendPct > 5) trendIndicator = "\u2191";
    else if (trendPct < -5) trendIndicator = "\u2193";
  }

  return {
    total_tokens: totalTokens,
    total_requests: totalRequests,
    daily_average: dailyAvg,
    peak_day: peakDay?.date || null,
    peak_hour: peakHour,
    trend_indicator: trendIndicator,
    trend_percentage: trendPct,
    previous_week_tokens: prevTotal,
    daily_breakdown: daily,
  };
}

export function getPredictions(sessionMetrics, windowMetrics) {
  if (!sessionMetrics || !windowMetrics) {
    return { estimated_time_remaining: null, recommendations: [] };
  }

  const burnRate = windowMetrics.burn_rate_per_min;
  const remaining = sessionMetrics.tokens_remaining;
  let estMinutes = null;
  let estFormatted = null;

  if (burnRate > 0) {
    estMinutes = Math.round(remaining / burnRate);
    if (estMinutes >= 60) {
      const h = Math.floor(estMinutes / 60);
      const m = estMinutes % 60;
      estFormatted = `~${h}h ${m}m`;
    } else {
      estFormatted = `~${estMinutes}m`;
    }
  }

  const recommendations = [];
  const pct = sessionMetrics.used_percentage;

  if (pct >= 85) {
    recommendations.push("Context is critically high. Consider starting a new conversation soon.");
    recommendations.push("Use /compact to summarize and free context space.");
  } else if (pct >= 70) {
    recommendations.push("Context is getting high. Plan to wrap up or compact soon.");
  }

  if (burnRate > 500) {
    recommendations.push("High burn rate detected. Consider breaking work into smaller conversations.");
  }

  const fiveH = sessionMetrics.rate_limits?.five_hour;
  if (fiveH && fiveH.used_percentage >= 80) {
    const resetAt = fiveH.resets_at ? new Date(fiveH.resets_at * 1000).toLocaleTimeString() : "soon";
    recommendations.push(`5-hour rate limit at ${Math.round(fiveH.used_percentage)}%. Resets at ${resetAt}.`);
  }

  const sevenD = sessionMetrics.rate_limits?.seven_day;
  if (sevenD && sevenD.used_percentage >= 80) {
    recommendations.push(`Weekly rate limit at ${Math.round(sevenD.used_percentage)}%. Consider pacing usage.`);
  }

  return {
    estimated_minutes_remaining: estMinutes,
    estimated_time_remaining: estFormatted,
    burn_rate_per_min: burnRate,
    tokens_remaining: remaining,
    recommendations,
  };
}
