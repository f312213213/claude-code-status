#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readAll, readLastNHours, rotate } from "./lib/metrics-store.js";
import { analyzeSession, analyzeWindow, analyzeWeekly, getPredictions } from "./lib/analyzer.js";
import {
  formatSessionMetrics,
  formatUsageWindow,
  formatWeeklySummary,
  formatPredictions,
  formatFullDashboard,
} from "./lib/formatter.js";

// Rotate old entries on startup
try { rotate(); } catch { /* ok if no file yet */ }

const server = new McpServer({
  name: "claude-code-status",
  version: "1.0.0",
});

function getLatestEntry() {
  const all = readAll();
  return all.length > 0 ? all[all.length - 1] : null;
}

// Tool 1: Current session metrics
server.tool(
  "get_session_metrics",
  "Get current session context usage, model info, cost, and rate limit status with visual indicators",
  {},
  async () => {
    const latest = getLatestEntry();
    if (!latest) {
      return { content: [{ type: "text", text: "No metrics data available yet. The status line needs to run first to collect data." }] };
    }
    const session = analyzeSession(latest);
    const formatted = formatSessionMetrics(session);
    return { content: [{ type: "text", text: formatted }] };
  }
);

// Tool 2: Usage window (last N hours)
server.tool(
  "get_usage_window",
  "Get token consumption metrics for a recent time window: total tokens, request count, average per request, burn rate",
  { hours: z.number().min(1).max(24).default(5).describe("Number of hours to look back (default: 5)") },
  async ({ hours }) => {
    const window = analyzeWindow(hours);
    const formatted = formatUsageWindow(window);
    return { content: [{ type: "text", text: formatted }] };
  }
);

// Tool 3: Weekly summary
server.tool(
  "get_weekly_summary",
  "Get a 7-day usage breakdown with daily tokens, requests, averages, peak day/hour, and week-over-week trend",
  {},
  async () => {
    const weekly = analyzeWeekly();
    const formatted = formatWeeklySummary(weekly);
    return { content: [{ type: "text", text: formatted }] };
  }
);

// Tool 4: Export metrics
server.tool(
  "export_metrics",
  "Export usage metrics in JSON or formatted table format",
  {
    format: z.enum(["json", "table"]).default("table").describe("Output format: 'json' for programmatic use, 'table' for readable display"),
  },
  async ({ format }) => {
    const latest = getLatestEntry();
    const session = latest ? analyzeSession(latest) : null;
    const window = analyzeWindow(5);
    const weekly = analyzeWeekly();
    const predictions = session ? getPredictions(session, window) : null;

    if (format === "json") {
      const data = {
        timestamp: new Date().toISOString(),
        session,
        last_5_hours: window,
        weekly,
        predictions,
      };
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }

    const formatted = formatFullDashboard(session, window, weekly, predictions);
    return { content: [{ type: "text", text: formatted }] };
  }
);

// Tool 5: Predictions
server.tool(
  "get_predictions",
  "Estimate time until context limit, get burn rate analysis, and actionable recommendations",
  {},
  async () => {
    const latest = getLatestEntry();
    if (!latest) {
      return { content: [{ type: "text", text: "No metrics data available yet for predictions." }] };
    }
    const session = analyzeSession(latest);
    const window = analyzeWindow(5);
    const predictions = getPredictions(session, window);
    const formatted = formatPredictions(predictions);
    return { content: [{ type: "text", text: formatted }] };
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
