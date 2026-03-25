import { strict as assert } from "assert";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { append, readAll, readLastNHours, readLastNDays, rotate, clear, getLogPath } from "../lib/metrics-store.js";
import { analyzeSession, analyzeWindow, analyzeWeekly, getPredictions } from "../lib/analyzer.js";
import {
  formatSessionMetrics,
  formatUsageWindow,
  formatWeeklySummary,
  formatPredictions,
  formatFullDashboard,
} from "../lib/formatter.js";

// Use a test log file to avoid polluting real data
const REAL_LOG = getLogPath();
const BACKUP_PATH = REAL_LOG + ".backup";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function setup() {
  clear();
}

function teardown() {
  clear();
}

// Generate synthetic entries
function makeEntry(overrides = {}, tsOffset = 0) {
  const base = {
    model: { id: "claude-opus-4-6", display_name: "Opus" },
    context_window: {
      total_input_tokens: 15000,
      total_output_tokens: 5000,
      context_window_size: 200000,
      used_percentage: 10,
      remaining_percentage: 90,
      current_usage: { input_tokens: 8500, output_tokens: 1200, cache_creation_input_tokens: 5000, cache_read_input_tokens: 2000 },
    },
    cost: { total_cost_usd: 0.0523, total_duration_ms: 45000, total_lines_added: 156, total_lines_removed: 23 },
    rate_limits: {
      five_hour: { used_percentage: 23.5, resets_at: Math.floor(Date.now() / 1000) + 3600 },
      seven_day: { used_percentage: 41.2, resets_at: Math.floor(Date.now() / 1000) + 86400 },
    },
    session_id: "test-session",
    version: "1.0.0",
    _ts: Date.now() - tsOffset,
  };

  // Deep merge overrides
  return deepMerge(base, overrides);
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) && target[key]) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// ─── Tests ───────────────────────────────────────────────────────────

console.log("\n━━━ Metrics Store ━━━");

setup();

test("append and readAll", () => {
  clear();
  append({ test: 1, context_window: { total_input_tokens: 100, total_output_tokens: 50 } });
  append({ test: 2, context_window: { total_input_tokens: 200, total_output_tokens: 100 } });
  const all = readAll();
  assert.equal(all.length, 2);
  assert.equal(all[0].test, 1);
  assert.equal(all[1].test, 2);
  assert.ok(all[0]._ts > 0);
});

test("readLastNHours filters correctly", () => {
  clear();
  // Entry from 2 hours ago
  const entry1 = { _ts: Date.now() - 2 * 3600 * 1000, context_window: { total_input_tokens: 100, total_output_tokens: 50 } };
  // Entry from 10 hours ago
  const entry2 = { _ts: Date.now() - 10 * 3600 * 1000, context_window: { total_input_tokens: 200, total_output_tokens: 100 } };
  writeFileSync(REAL_LOG, [JSON.stringify(entry2), JSON.stringify(entry1)].join("\n") + "\n");

  const last5 = readLastNHours(5);
  assert.equal(last5.length, 1);
  assert.equal(last5[0]._ts, entry1._ts);
});

test("readLastNDays filters correctly", () => {
  clear();
  const now = Date.now();
  const entries = [];
  // Create entries from 0.5 days ago to 9.5 days ago (avoiding boundary)
  for (let i = 0; i < 10; i++) {
    entries.push(JSON.stringify({ _ts: now - (i + 0.5) * 24 * 3600 * 1000, context_window: { total_input_tokens: 100, total_output_tokens: 50 } }));
  }
  writeFileSync(REAL_LOG, entries.join("\n") + "\n");

  const last7 = readLastNDays(7);
  // Entries at 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5 days ago = 7 entries within 7 days
  assert.equal(last7.length, 7);
});

test("rotate removes entries older than 30 days", () => {
  clear();
  const now = Date.now();
  const entries = [
    JSON.stringify({ _ts: now - 35 * 24 * 3600 * 1000, old: true }),
    JSON.stringify({ _ts: now - 1 * 24 * 3600 * 1000, recent: true }),
  ];
  writeFileSync(REAL_LOG, entries.join("\n") + "\n");

  const remaining = rotate();
  assert.equal(remaining, 1);
  const all = readAll();
  assert.equal(all[0].recent, true);
});

test("clear empties the log", () => {
  append({ test: true });
  clear();
  assert.equal(readAll().length, 0);
});

console.log("\n━━━ Analyzer - Session ━━━");

test("analyzeSession returns correct fields", () => {
  const entry = makeEntry();
  const session = analyzeSession(entry);
  assert.equal(session.model, "Opus");
  assert.equal(session.tokens_used, 20000);
  assert.equal(session.tokens_available, 200000);
  assert.equal(session.used_percentage, 10);
  assert.equal(session.status, "healthy");
  assert.ok(session.cost_usd > 0);
});

test("analyzeSession status thresholds", () => {
  const healthy = analyzeSession(makeEntry({ context_window: { used_percentage: 50 } }));
  assert.equal(healthy.status, "healthy");

  const caution = analyzeSession(makeEntry({ context_window: { used_percentage: 75 } }));
  assert.equal(caution.status, "caution");

  const warning = analyzeSession(makeEntry({ context_window: { used_percentage: 90 } }));
  assert.equal(warning.status, "warning");
});

test("analyzeSession handles null entry", () => {
  assert.equal(analyzeSession(null), null);
});

console.log("\n━━━ Analyzer - Window ━━━");

test("analyzeWindow with data", () => {
  clear();
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const entry = makeEntry(
      { context_window: { total_input_tokens: 1000 * (i + 1), total_output_tokens: 500 * (i + 1) } },
    );
    entry._ts = now - i * 30 * 60 * 1000; // every 30 min
    writeFileSync(REAL_LOG, (i === 0 ? "" : readAll().map(e => JSON.stringify(e)).join("\n") + "\n") + JSON.stringify(entry) + "\n");
  }

  // Rewrite cleanly
  clear();
  for (let i = 4; i >= 0; i--) {
    const entry = {
      _ts: now - i * 30 * 60 * 1000,
      context_window: { total_input_tokens: 1000 * (5 - i), total_output_tokens: 500 * (5 - i) },
    };
    writeFileSync(REAL_LOG, readAll().map(e => JSON.stringify(e)).join("\n") + (readAll().length ? "\n" : "") + JSON.stringify(entry) + "\n");
  }

  const window = analyzeWindow(5);
  assert.equal(window.total_requests, 5);
  assert.ok(window.total_tokens > 0);
  assert.ok(window.avg_per_request > 0);
  assert.ok(window.burn_rate_per_min > 0);
});

test("analyzeWindow with no data", () => {
  clear();
  const window = analyzeWindow(5);
  assert.equal(window.total_requests, 0);
  assert.equal(window.total_tokens, 0);
});

console.log("\n━━━ Analyzer - Weekly ━━━");

test("analyzeWeekly with synthetic data", () => {
  clear();
  const now = Date.now();
  const entries = [];
  // Generate 3 entries per day for 7 days
  for (let day = 0; day < 7; day++) {
    for (let req = 0; req < 3; req++) {
      entries.push(JSON.stringify({
        _ts: now - day * 24 * 3600 * 1000 - req * 3600 * 1000,
        context_window: { total_input_tokens: 10000, total_output_tokens: 5000 },
      }));
    }
  }
  writeFileSync(REAL_LOG, entries.join("\n") + "\n");

  const weekly = analyzeWeekly();
  assert.equal(weekly.total_requests, 21);
  assert.equal(weekly.daily_breakdown.length, 7);
  assert.ok(weekly.total_tokens > 0);
  assert.ok(weekly.daily_average > 0);
  assert.ok(weekly.peak_day);
  assert.ok(["↑", "↓", "→"].includes(weekly.trend_indicator));
});

test("analyzeWeekly with zero usage days", () => {
  clear();
  // Only 1 entry on 1 day
  writeFileSync(REAL_LOG, JSON.stringify({
    _ts: Date.now(),
    context_window: { total_input_tokens: 5000, total_output_tokens: 2000 },
  }) + "\n");

  const weekly = analyzeWeekly();
  assert.equal(weekly.total_requests, 1);
  assert.equal(weekly.daily_breakdown.length, 7);
  // Most days should have 0
  const zeroDays = weekly.daily_breakdown.filter(d => d.tokens === 0);
  assert.ok(zeroDays.length >= 6);
});

console.log("\n━━━ Analyzer - Predictions ━━━");

test("getPredictions with active session", () => {
  const session = analyzeSession(makeEntry({ context_window: { used_percentage: 60, total_input_tokens: 90000, total_output_tokens: 30000, context_window_size: 200000 } }));
  const window = { burn_rate_per_min: 100, total_requests: 10, total_tokens: 12000, avg_per_request: 1200 };
  const pred = getPredictions(session, window);
  assert.ok(pred.estimated_minutes_remaining > 0);
  assert.ok(pred.estimated_time_remaining);
  assert.equal(pred.recommendations.length, 0); // 60% = no warnings
});

test("getPredictions warns at high usage", () => {
  const session = analyzeSession(makeEntry({ context_window: { used_percentage: 90, total_input_tokens: 170000, total_output_tokens: 10000, context_window_size: 200000 } }));
  const window = { burn_rate_per_min: 200, total_requests: 20, total_tokens: 24000, avg_per_request: 1200 };
  const pred = getPredictions(session, window);
  assert.ok(pred.recommendations.length > 0);
  assert.ok(pred.recommendations.some(r => r.includes("critically high")));
});

test("getPredictions warns on high rate limits", () => {
  const session = analyzeSession(makeEntry({
    context_window: { used_percentage: 30 },
    rate_limits: { five_hour: { used_percentage: 85, resets_at: Math.floor(Date.now() / 1000) + 1800 } },
  }));
  const window = { burn_rate_per_min: 50, total_requests: 5, total_tokens: 6000, avg_per_request: 1200 };
  const pred = getPredictions(session, window);
  assert.ok(pred.recommendations.some(r => r.includes("5-hour rate limit")));
});

console.log("\n━━━ Formatter ━━━");

test("formatSessionMetrics produces readable output", () => {
  const session = analyzeSession(makeEntry());
  const output = formatSessionMetrics(session);
  assert.ok(output.includes("Context"));
  assert.ok(output.includes("Opus"));
  assert.ok(output.includes("200K"));
  assert.ok(output.includes("$0.0523"));
});

test("formatSessionMetrics handles null", () => {
  const output = formatSessionMetrics(null);
  assert.ok(output.includes("No session data"));
});

test("formatUsageWindow produces readable output", () => {
  const window = { hours: 5, total_tokens: 18432, total_requests: 12, avg_per_request: 1536, burn_rate_per_min: 61, peak_timestamp: new Date().toISOString(), peak_tokens: 3200, entries_count: 12 };
  const output = formatUsageWindow(window);
  assert.ok(output.includes("Last 5 Hours"));
  assert.ok(output.includes("18K"));
  assert.ok(output.includes("12"));
  assert.ok(output.includes("61 tokens/min"));
});

test("formatUsageWindow handles empty", () => {
  const output = formatUsageWindow({ hours: 5, total_requests: 0 });
  assert.ok(output.includes("No usage data"));
});

test("formatWeeklySummary produces table", () => {
  clear();
  const now = Date.now();
  const entries = [];
  for (let day = 0; day < 7; day++) {
    for (let req = 0; req < 5; req++) {
      entries.push(JSON.stringify({
        _ts: now - day * 24 * 3600 * 1000 - req * 3600 * 1000,
        context_window: { total_input_tokens: 8000 + day * 1000, total_output_tokens: 3000 + day * 500 },
      }));
    }
  }
  writeFileSync(REAL_LOG, entries.join("\n") + "\n");

  const weekly = analyzeWeekly();
  const output = formatWeeklySummary(weekly);
  assert.ok(output.includes("Weekly Summary"));
  assert.ok(output.includes("Date"));
  assert.ok(output.includes("Tokens"));
  assert.ok(output.includes("Requests"));
  assert.ok(output.includes("Daily Avg"));
  assert.ok(output.includes("Trend"));
});

test("formatPredictions produces readable output", () => {
  const pred = { estimated_time_remaining: "~2h 30m", burn_rate_per_min: 100, tokens_remaining: 80000, estimated_minutes_remaining: 150, recommendations: ["Context is getting high."] };
  const output = formatPredictions(pred);
  assert.ok(output.includes("~2h 30m"));
  assert.ok(output.includes("100 tokens/min"));
  assert.ok(output.includes("Context is getting high"));
});

test("formatFullDashboard combines all sections", () => {
  const session = analyzeSession(makeEntry());
  const window = { hours: 5, total_tokens: 18432, total_requests: 12, avg_per_request: 1536, burn_rate_per_min: 61, peak_timestamp: new Date().toISOString(), peak_tokens: 3200, entries_count: 12 };
  const weekly = analyzeWeekly();
  const pred = { estimated_time_remaining: "~3h", burn_rate_per_min: 61, tokens_remaining: 180000, estimated_minutes_remaining: 180, recommendations: [] };

  const output = formatFullDashboard(session, window, weekly, pred);
  assert.ok(output.includes("Context"));
  assert.ok(output.includes("Last 5 Hours"));
  assert.ok(output.includes("Weekly Summary"));
  assert.ok(output.includes("Predictions"));
});

console.log("\n━━━ Edge Cases ━━━");

test("handles malformed JSONL lines gracefully", () => {
  writeFileSync(REAL_LOG, '{"valid":true,"_ts":' + Date.now() + '}\nnot json\n{"also_valid":true,"_ts":' + Date.now() + '}\n');
  const all = readAll();
  assert.equal(all.length, 2);
});

test("handles high burst usage (many entries)", () => {
  clear();
  const now = Date.now();
  const entries = [];
  for (let i = 0; i < 100; i++) {
    entries.push(JSON.stringify({
      _ts: now - i * 60 * 1000, // every minute
      context_window: { total_input_tokens: 5000, total_output_tokens: 2000 },
    }));
  }
  writeFileSync(REAL_LOG, entries.join("\n") + "\n");

  const window = analyzeWindow(2);
  assert.ok(window.total_requests > 0);
  assert.ok(window.burn_rate_per_min > 0);
});

test("handles missing rate_limits gracefully", () => {
  const entry = makeEntry();
  delete entry.rate_limits;
  const session = analyzeSession(entry);
  assert.equal(session.rate_limits.five_hour, null);
  assert.equal(session.rate_limits.seven_day, null);
});

// Cleanup
teardown();

console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
process.exit(failed > 0 ? 1 : 0);
