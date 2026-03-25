import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";

const LOG_PATH = join(homedir(), ".claude", "metrics-log.jsonl");
const MAX_AGE_DAYS = 30;

function ensureDir() {
  const dir = dirname(LOG_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function append(entry) {
  ensureDir();
  const record = { ...entry, _ts: Date.now() };
  appendFileSync(LOG_PATH, JSON.stringify(record) + "\n");
}

export function readAll() {
  if (!existsSync(LOG_PATH)) return [];
  const lines = readFileSync(LOG_PATH, "utf-8").trim().split("\n").filter(Boolean);
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return entries;
}

export function readSince(ms) {
  const cutoff = Date.now() - ms;
  return readAll().filter((e) => e._ts >= cutoff);
}

export function readLastNHours(hours) {
  return readSince(hours * 60 * 60 * 1000);
}

export function readLastNDays(days) {
  return readSince(days * 24 * 60 * 60 * 1000);
}

export function rotate() {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const entries = readAll().filter((e) => e._ts >= cutoff);
  ensureDir();
  writeFileSync(LOG_PATH, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""));
  return entries.length;
}

export function clear() {
  ensureDir();
  writeFileSync(LOG_PATH, "");
}

export function getLogPath() {
  return LOG_PATH;
}
