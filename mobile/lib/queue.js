// lib/queue.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(process.cwd(), "data");
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");

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

function createHash(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function loadQueue() {
  return safeReadJson(QUEUE_FILE, []);
}

function saveQueue(queue) {
  safeWriteJson(QUEUE_FILE, queue);
}

function addToQueue(platform, content, delayMinutes = 0, sourceInputHash = "", options = {}) {
  const queue = loadQueue();
  const now = Date.now();
  const scheduledFor = new Date(now + delayMinutes * 60 * 1000).toISOString();
  const contentHash = createHash(content);

  const duplicate = queue.find(
    (item) =>
      item.platform === platform &&
      item.content_hash === contentHash &&
      item.status === "pending"
  );

  if (duplicate && !options.force) {
    return {
      added: false,
      reason: "duplicate_pending",
      item: duplicate
    };
  }

  const item = {
    id: crypto.randomUUID(),
    platform,
    account_label: options.accountLabel || "default",
    content: String(content || "").trim(),
    persona: options.persona || "operator",
    post_mode: options.postMode || "build_log",
    generated_version: options.generatedVersion || "v4",
    humanized: true,
    content_hash: contentHash,
    source_input_hash: sourceInputHash || "",
    status: "pending",
    created_at: new Date().toISOString(),
    scheduled_for: scheduledFor
  };

  queue.push(item);
  saveQueue(queue);

  return {
    added: true,
    item
  };
}

module.exports = {
  QUEUE_FILE,
  createHash,
  loadQueue,
  saveQueue,
  addToQueue
};