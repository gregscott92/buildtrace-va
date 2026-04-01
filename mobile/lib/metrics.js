// lib/metrics.js

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(process.cwd(), "data");
const METRICS_FILE = path.join(DATA_DIR, "x-metrics.json");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function safeWriteJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function loadMetrics() {
  return safeReadJson(METRICS_FILE, []);
}

function saveMetrics(metrics) {
  safeWriteJson(METRICS_FILE, metrics);
}

function upsertXMetric(metric = {}) {
  const metrics = loadMetrics();

  const record = {
    tweet_id: metric.tweet_id || "",
    account_label: metric.account_label || "default",
    handle: metric.handle || "",
    persona: metric.persona || "operator",
    post_mode: metric.post_mode || "build_log",
    sync_timestamp: new Date().toISOString(),
    impression_count: metric.impression_count || 0,
    like_count: metric.like_count || 0,
    repost_count: metric.repost_count || 0,
    reply_count: metric.reply_count || 0,
    bookmark_count: metric.bookmark_count || 0,
    quote_count: metric.quote_count || 0,
    raw: metric.raw || {}
  };

  const index = metrics.findIndex((m) => m.tweet_id === record.tweet_id);

  if (index >= 0) {
    metrics[index] = { ...metrics[index], ...record };
  } else {
    metrics.push(record);
  }

  saveMetrics(metrics);
  return record;
}

module.exports = {
  METRICS_FILE,
  loadMetrics,
  saveMetrics,
  upsertXMetric
};