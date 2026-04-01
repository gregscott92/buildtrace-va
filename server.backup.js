require("dotenv").config();
console.log("BUILDTRACE SERVER VERSION: LOGIN-ROUTE-FIXED");
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const { TwitterApi } = require("twitter-api-v2");
const cron = require("node-cron");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const { runFivePassPipeline } = require("./lib/ai-pipeline");
const { finalizePost, choosePersona } = require("./lib/persona");
const { upsertXMetric } = require("./lib/metrics");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const ENABLE_LOCAL_CRON =
  String(process.env.ENABLE_LOCAL_CRON).toLowerCase() === "true";

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const NEWS_API_COUNTRY = process.env.NEWS_API_COUNTRY || "us";
const NEWS_API_CATEGORY = process.env.NEWS_API_CATEGORY || "general";
const NEWS_API_QUERY = process.env.NEWS_API_QUERY || "trump";

const queueDir = "queue";
const accountsDir = "accounts";
const queueFile = path.join(queueDir, "posts.json");
const queueArchiveFile = path.join(queueDir, "archive.json");
const driftFile = path.join(queueDir, "drift.json");
const xMetricsFile = path.join(queueDir, "x-metrics.json");
const runAccountsFile = path.join(queueDir, "run-accounts.json");
const accountsFile = path.join(accountsDir, "accounts.json");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// =======================
// SIMPLE PASSWORD LOCK
// =======================

const APP_PASSWORD = process.env.APP_PASSWORD || "changeme";
const AUTH_COOKIE_NAME = "buildtrace_auth";

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((acc, part) => {
    const [rawKey, ...rest] = part.split("=");
    const key = String(rawKey || "").trim();
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join("=") || "");
    return acc;
  }, {});
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);
  return cookies[AUTH_COOKIE_NAME] === APP_PASSWORD;
}

function setAuthCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(
      APP_PASSWORD
    )}; HttpOnly; Path=/; SameSite=Lax${isProd ? "; Secure" : ""}`
  );
}

function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    `${AUTH_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${
      isProd ? "; Secure" : ""
    }`
  );
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderLoginPage(message = "") {
  return `
    <html>
      <head>
        <title>BuildTrace Login</title>
        <style>
          body {
            background: #0b0f19;
            color: #fff;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            font-family: Arial, sans-serif;
            margin: 0;
          }
          .box {
            background: #111827;
            padding: 30px;
            border-radius: 12px;
            text-align: center;
            width: 320px;
            box-shadow: 0 10px 30px rgba(0,0,0,.35);
          }
          input {
            padding: 10px;
            margin-top: 10px;
            width: 100%;
            box-sizing: border-box;
            border-radius: 8px;
            border: 1px solid #374151;
            background: #0b1220;
            color: white;
          }
          button {
            margin-top: 12px;
            padding: 10px;
            width: 100%;
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: bold;
          }
          .msg {
            color: #fca5a5;
            min-height: 18px;
            margin-top: 10px;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h2>BuildTrace</h2>
          <p>Enter password</p>
          <form method="POST" action="/login">
            <input type="password" name="password" placeholder="Password" required />
            <button type="submit">Enter</button>
          </form>
          <div class="msg">${escapeHtml(message)}</div>
        </div>
      </body>
    </html>
  `;
}

function checkAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.status(401).send(renderLoginPage());
}

// =======================
// PUBLIC ROUTES
// =======================

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "build-logger-api" });
});

app.get("/login", (req, res) => {
  if (isAuthenticated(req)) {
    return res.redirect("/");
  }

  return res.send(renderLoginPage());
});

app.post("/login", (req, res) => {
  const password = String(req.body.password || "").trim();

  console.log("LOGIN DEBUG");
  console.log("APP_PASSWORD RAW:", process.env.APP_PASSWORD);
  console.log("APP_PASSWORD JSON:", JSON.stringify(process.env.APP_PASSWORD));
  console.log("APP_PASSWORD LEN:", String(process.env.APP_PASSWORD || "").length);
  console.log("INPUT PASSWORD JSON:", JSON.stringify(password));
  console.log("INPUT PASSWORD LEN:", password.length);
  console.log("MATCHES:", password === APP_PASSWORD);

  if (password !== APP_PASSWORD) {
    return res.status(401).send(renderLoginPage("Wrong password"));
  }

  setAuthCookie(res);
  return res.redirect("/");
});
app.post("/logout", (req, res) => {
  clearAuthCookie(res);
  return res.redirect("/login");
});

// everything except login/health is protected
async function checkApiBearerAuth(req, res, next) {
  try {
    // allow public routes
    if (req.path === "/health" || req.path === "/login") {
      return next();
    }

    // allow the mobile app to call /run without browser login
    if (req.path === "/run") {
      return next();
    }

    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = data.user;
    next();
  } catch (err) {
    console.error("checkApiBearerAuth error:", err);
    return res.status(401).json({ error: "Unauthorized" });
  }
}

// =======================
// BASIC HELPERS
// =======================

function ensureFolder(folder) {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

function ensureFile(filePath, fallbackObject) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallbackObject, null, 2), "utf-8");
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) return fallback;

    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureQueueFiles() {
  ensureFolder(queueDir);

  ensureFile(queueFile, { queue: [] });
  ensureFile(queueArchiveFile, { archive: [] });
  ensureFile(driftFile, {
    duplicate_attempts_total: 0,
    duplicate_attempts_by_platform: {},
    duplicate_attempts_by_reason: {},
    events: [],
  });
  ensureFile(xMetricsFile, { metrics: {} });
  ensureFile(runAccountsFile, { run_accounts: {} });
}

function ensureAccountsFile() {
  ensureFolder(accountsDir);

  if (!fs.existsSync(accountsFile)) {
    writeJsonFile(accountsFile, {
      default_x_account_label: "main",
      x_accounts: [
        {
          label: "main",
          display_name: "Main X",
          handle: process.env.X_HANDLE || "@yourhandle",
          active: true,
          credentials: {
            api_key_env: "X_API_KEY",
            api_key_secret_env: "X_API_KEY_SECRET",
            access_token_env: "X_ACCESS_TOKEN",
            access_token_secret_env: "X_ACCESS_TOKEN_SECRET",
          },
        },
      ],
    });
  }
}

function readQueueFile() {
  ensureQueueFiles();
  const parsed = readJsonSafe(queueFile, { queue: [] });
  return Array.isArray(parsed.queue) ? parsed : { queue: [] };
}

function saveQueueFile(data) {
  writeJsonFile(queueFile, data);
}

function readArchiveFile() {
  ensureQueueFiles();
  const parsed = readJsonSafe(queueArchiveFile, { archive: [] });
  return Array.isArray(parsed.archive) ? parsed : { archive: [] };
}

function saveArchiveFile(data) {
  writeJsonFile(queueArchiveFile, data);
}

function readDriftFile() {
  ensureQueueFiles();
  return readJsonSafe(driftFile, {
    duplicate_attempts_total: 0,
    duplicate_attempts_by_platform: {},
    duplicate_attempts_by_reason: {},
    events: [],
  });
}

function readXMetricsFile() {
  ensureQueueFiles();
  const parsed = readJsonSafe(xMetricsFile, { metrics: {} });
  return parsed && typeof parsed === "object" && parsed.metrics
    ? parsed
    : { metrics: {} };
}

function saveXMetricsFile(data) {
  writeJsonFile(xMetricsFile, data);
}

function readRunAccountsFile() {
  ensureQueueFiles();
  const parsed = readJsonSafe(runAccountsFile, { run_accounts: {} });
  return parsed && typeof parsed === "object" && parsed.run_accounts
    ? parsed
    : { run_accounts: {} };
}

function saveRunAccountsFile(data) {
  writeJsonFile(runAccountsFile, data);
}

function getRunMetrics(runId) {
  const store = readXMetricsFile();
  return store.metrics?.[runId] || null;
}

function archiveQueueItem(item, reason = "archived") {
  const archive = readArchiveFile();
  archive.archive.push({
    ...item,
    archive_reason: reason,
    archived_at: new Date().toISOString(),
  });
  saveArchiveFile(archive);
}

function normalizeForDrift(value) {
  return String(value || "").trim();
}

function hasAnyDrift(run) {
  return Boolean(
    run?.drift_summary ||
      run?.drift_slack ||
      run?.drift_linkedin ||
      run?.drift_twitter ||
      run?.drift_tiktok_script ||
      run?.drift_tiktok_caption
  );
}

function driftLabel(value) {
  return value ? "YES" : "NO";
}

function statusClass(status) {
  if (status === "approved") return "status-approved";
  if (status === "posted") return "status-posted";
  if (status === "failed") return "status-failed";
  if (status === "investigating") return "status-investigating";
  if (status === "archived") return "status-archived";
  return "status-draft";
}

function formatLocal(dateString) {
  if (!dateString) return "n/a";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function truncate(value, length = 120) {
  const text = String(value || "").replace(/\r?\n/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function getMinutesUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - Date.now()) / 60000);
}

function getQueuePlatformLabel(item) {
  return String(item?.platform || "unknown").toUpperCase();
}

function getQueueAccountLabel(item) {
  return (
    item?.account_label ||
    item?.page_name ||
    item?.profile_name ||
    item?.account_id ||
    process.env.X_HANDLE ||
    "Default X Account"
  );
}

function getQueueChannelLabel(item) {
  return `${getQueuePlatformLabel(item)} • ${getQueueAccountLabel(item)}`;
}

function summarizeAffectedChannels(items) {
  const labels = [...new Set(items.map(getQueueChannelLabel))];
  if (labels.length === 0) return "No channel detected";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2} more`;
}

// =======================
// ACCOUNT SYSTEM
// =======================

function readAccountsFile() {
  ensureAccountsFile();

  const parsed = readJsonSafe(accountsFile, {
    default_x_account_label: "main",
    x_accounts: [],
  });

  return {
    default_x_account_label: parsed.default_x_account_label || "main",
    x_accounts: Array.isArray(parsed.x_accounts) ? parsed.x_accounts : [],
  };
}

function listActiveXAccounts() {
  const accounts = readAccountsFile();
  return accounts.x_accounts.filter((item) => item.active !== false);
}

function getXAccountByLabel(label) {
  return listActiveXAccounts().find((item) => item.label === label) || null;
}

function getDefaultXAccount() {
  const accounts = readAccountsFile();
  const preferred = accounts.default_x_account_label;

  return (
    listActiveXAccounts().find((item) => item.label === preferred) ||
    listActiveXAccounts()[0] ||
    null
  );
}

function getDefaultXAccountLabel() {
  return getDefaultXAccount()?.label || "main";
}

function getXAccountCredentialsByLabel(label) {
  const account = getXAccountByLabel(label);

  if (!account) {
    return null;
  }

  const credentials = account.credentials || {};

  return {
    label: account.label,
    display_name: account.display_name || account.label,
    handle: account.handle || "",
    apiKeyEnv: credentials.api_key_env || "",
    apiKeySecretEnv: credentials.api_key_secret_env || "",
    accessTokenEnv: credentials.access_token_env || "",
    accessTokenSecretEnv: credentials.access_token_secret_env || "",
    apiKey: process.env[credentials.api_key_env] || "",
    apiKeySecret: process.env[credentials.api_key_secret_env] || "",
    accessToken: process.env[credentials.access_token_env] || "",
    accessTokenSecret: process.env[credentials.access_token_secret_env] || "",
  };
}

function validateXAccountCredentials(accountCredentials) {
  if (!accountCredentials) {
    return {
      isReady: false,
      missingEnvVars: ["account_not_found"],
    };
  }

  const missing = [];

  if (!accountCredentials.apiKeyEnv || !accountCredentials.apiKey) {
    missing.push(accountCredentials.apiKeyEnv || "api_key_env");
  }

  if (!accountCredentials.apiKeySecretEnv || !accountCredentials.apiKeySecret) {
    missing.push(accountCredentials.apiKeySecretEnv || "api_key_secret_env");
  }

  if (!accountCredentials.accessTokenEnv || !accountCredentials.accessToken) {
    missing.push(accountCredentials.accessTokenEnv || "access_token_env");
  }

  if (
    !accountCredentials.accessTokenSecretEnv ||
    !accountCredentials.accessTokenSecret
  ) {
    missing.push(
      accountCredentials.accessTokenSecretEnv || "access_token_secret_env"
    );
  }

  return {
    isReady: missing.length === 0,
    missingEnvVars: missing,
  };
}

function getXAccountStatusList() {
  return listActiveXAccounts().map((account) => {
    const credentials = getXAccountCredentialsByLabel(account.label);
    const status = validateXAccountCredentials(credentials);

    return {
      label: account.label,
      display_name: account.display_name || account.label,
      handle: account.handle || "",
      is_ready: status.isReady,
      missing_env_vars: status.missingEnvVars,
    };
  });
}

const xClientCache = new Map();

function getXClientForAccountLabel(label) {
  const credentials = getXAccountCredentialsByLabel(label);
  const status = validateXAccountCredentials(credentials);

  if (!status.isReady) {
    throw new Error(
      `X credentials not ready for account "${label}": ${status.missingEnvVars.join(", ")}`
    );
  }

  if (xClientCache.has(label)) {
    return {
      client: xClientCache.get(label),
      credentials,
    };
  }

  const client = new TwitterApi({
    appKey: credentials.apiKey,
    appSecret: credentials.apiKeySecret,
    accessToken: credentials.accessToken,
    accessSecret: credentials.accessTokenSecret,
  });

  xClientCache.set(label, client);

  return {
    client,
    credentials,
  };
}

// =======================
// RUN ACCOUNT MAPPING
// =======================

function getMappedRunAccount(runId) {
  const store = readRunAccountsFile();
  return store.run_accounts?.[runId] || null;
}

function setMappedRunAccount(runId, accountLabel) {
  const account = getXAccountByLabel(accountLabel);

  if (!account) {
    throw new Error(`X account "${accountLabel}" not found or inactive.`);
  }

  const store = readRunAccountsFile();

  store.run_accounts[runId] = {
    account_label: account.label,
    handle: account.handle || "",
    display_name: account.display_name || account.label,
    updated_at: new Date().toISOString(),
  };

  saveRunAccountsFile(store);

  return store.run_accounts[runId];
}

function resolveRunAccountLabel(run, explicitAccountLabel = "") {
  const requested = safeTrim(explicitAccountLabel);

  if (requested) {
    const account = getXAccountByLabel(requested);

    if (!account) {
      throw new Error(`Requested X account "${requested}" was not found or is inactive.`);
    }

    return account.label;
  }

  const mapped = run?.id ? getMappedRunAccount(run.id) : null;
  if (mapped?.account_label && getXAccountByLabel(mapped.account_label)) {
    return mapped.account_label;
  }

  return getDefaultXAccountLabel();
}

function attachRunAccountMetadata(run) {
  const mapped = run?.id ? getMappedRunAccount(run.id) : null;
  const fallbackLabel = getDefaultXAccountLabel();
  const label = mapped?.account_label || fallbackLabel;
  const account = getXAccountByLabel(label);

  return {
    ...run,
    x_account_label: label,
    x_account_handle: mapped?.handle || account?.handle || "",
    x_account_display_name:
      mapped?.display_name || account?.display_name || label,
  };
}

function attachRunAccountMetadataList(runs) {
  return (runs || []).map(attachRunAccountMetadata);
}

// =======================
// QUEUE INSIGHTS
// =======================

function buildChannelDirectory(queue) {
  const directory = {};

  queue.forEach((item) => {
    const key = getQueueChannelLabel(item);

    if (!directory[key]) {
      directory[key] = {
        platform: getQueuePlatformLabel(item),
        account: getQueueAccountLabel(item),
        total: 0,
        pending: 0,
        posted: 0,
        failed: 0,
      };
    }

    directory[key].total += 1;
    if (item.status === "pending") directory[key].pending += 1;
    if (item.status === "posted") directory[key].posted += 1;
    if (item.status === "failed") directory[key].failed += 1;
  });

  return Object.values(directory).sort((a, b) => b.total - a.total).slice(0, 6);
}

function buildQueueInsights(queue, drift) {
  const now = new Date();

  const posted = queue.filter((p) => p.status === "posted");
  const pending = queue.filter((p) => p.status === "pending");
  const failed = queue.filter((p) => p.status === "failed");
  const investigating = queue.filter((p) => p.review_status === "investigating");

  const readyNow = pending.filter((p) => {
    if (!p.scheduled_for) return true;
    const scheduled = new Date(p.scheduled_for);
    return !Number.isNaN(scheduled.getTime()) && scheduled <= now;
  });

  const futurePending = pending.filter((p) => {
    if (!p.scheduled_for) return false;
    const scheduled = new Date(p.scheduled_for);
    return !Number.isNaN(scheduled.getTime()) && scheduled > now;
  });

  const dueSoon = futurePending.filter((p) => {
    const mins = getMinutesUntil(p.scheduled_for);
    return mins !== null && mins >= 0 && mins <= 60;
  });

  const suspiciousPosts = posted.filter((p) => {
    if (!p.scheduled_for || !p.posted_at) return false;
    const scheduled = new Date(p.scheduled_for);
    const postedAt = new Date(p.posted_at);
    if (Number.isNaN(scheduled.getTime()) || Number.isNaN(postedAt.getTime()))
      return false;
    return postedAt < scheduled;
  });

  const actions = [];

  if (readyNow.length > 0) {
    actions.push({
      priority: "high",
      title: "Queue ready now",
      channel: summarizeAffectedChannels(readyNow),
      impact: `${readyNow.length} post(s) can publish immediately.`,
      nextMove: "Run scheduler now.",
      command: "node scheduler.js",
    });
  }

  if (failed.length > 0) {
    actions.push({
      priority: "high",
      title: "Failures need review",
      channel: summarizeAffectedChannels(failed),
      impact: `${failed.length} failed post(s) need intervention.`,
      nextMove: "Inspect queue errors and decide retry/remove.",
      command: "type queue\\posts.json",
    });
  }

  if (investigating.length > 0) {
    actions.push({
      priority: "medium",
      title: "Items under investigation",
      channel: summarizeAffectedChannels(investigating),
      impact: `${investigating.length} item(s) were moved into review.`,
      nextMove: "Read AI reasoning and decide archive or post anyway.",
      command: "http://localhost:3000",
    });
  }

  if ((drift?.duplicate_attempts_total || 0) > 0) {
    actions.push({
      priority: "medium",
      title: "Duplicate drift detected",
      channel: "Cross-channel behavior",
      impact: `${drift.duplicate_attempts_total} duplicate attempts were caught.`,
      nextMove: "Review repeated trigger behavior.",
      command: "type queue\\drift.json",
    });
  }

  if (suspiciousPosts.length > 0) {
    actions.push({
      priority: "high",
      title: "Timing drift detected",
      channel: summarizeAffectedChannels(suspiciousPosts),
      impact: `${suspiciousPosts.length} post(s) were published before schedule.`,
      nextMove: "Validate scheduler timing logic.",
      command: "type queue\\posts.json",
    });
  }

  if (dueSoon.length > 0) {
    actions.push({
      priority: "low",
      title: "Posts due soon",
      channel: summarizeAffectedChannels(dueSoon),
      impact: `${dueSoon.length} post(s) are due within 60 minutes.`,
      nextMove: "Keep scheduler active and watch the next publish window.",
      command: "node scheduler.js",
    });
  }

  if (actions.length === 0) {
    actions.push({
      priority: "low",
      title: "Stable state",
      channel: "All channels",
      impact: "System is operating normally.",
      nextMove: "Keep scheduler alive and generate the next batch when ready.",
      command: "node scheduler.js",
    });
  }

  return {
    readyNow,
    dueSoon,
    suspiciousPosts,
    actions,
  };
}

function getMissionStatus(queueSummary, insights) {
  if (queueSummary.failed > 0 || insights.suspiciousPosts.length > 0) {
    return { label: "Intervene", tone: "red" };
  }

  if (
    queueSummary.pending > 0 ||
    queueSummary.duplicateDrift > 0 ||
    insights.dueSoon.length > 0
  ) {
    return { label: "Watch", tone: "amber" };
  }

  return { label: "Stable", tone: "green" };
}

// =======================
// TIKTOK / NEWS LANE
// =======================

function buildTikTokPrompt(newsItem) {
  return `
You are writing a political/news TikTok script from a real news input.

Rules:
- use only the REAL NEWS INPUT
- do not mention build notes
- do not invent facts
- plain English
- urgent and sharp
- no corporate language
- no emojis
- no hashtags in the script
- no stage directions
- no mention of AI

Return EXACTLY in this format:

=== TIKTOK SCRIPT ===
20 to 30 second voiceover script.

=== TIKTOK CAPTION ===
1 to 2 short lines with hashtags.

REAL NEWS INPUT:
Source Name: ${newsItem.sourceName}
Title: ${newsItem.title}
Published At: ${newsItem.publishedAt}
URL: ${newsItem.url}
Description: ${newsItem.description}
`;
}

function extract(text, section) {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `=== ${escaped} ===\\s*([\\s\\S]*?)(?=\\n=== [A-Z ]+ ===|$)`,
    "m"
  );
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

async function getRealNewsItem() {
 // if (!NEWS_API_KEY) {
//   throw new Error("Missing NEWS_API_KEY in .env");
// }

  const fallbackQueries = [
    NEWS_API_QUERY,
    "trump",
    "election",
    "war",
    "iran",
    "nato",
    "",
  ].filter(
    (value, index, arr) =>
      value !== undefined && value !== null && arr.indexOf(value) === index
  );

  for (const query of fallbackQueries) {
    const params = {
      country: NEWS_API_COUNTRY,
      category: NEWS_API_CATEGORY,
      pageSize: 10,
      apiKey: NEWS_API_KEY,
    };

    if (query && query.trim()) {
      params.q = query.trim();
    }

    try {
      const response = await axios.get("https://newsapi.org/v2/top-headlines", {
        params,
        timeout: 20000,
      });

      const articles = response.data?.articles || [];

      const usable = articles.find((article) => {
        return (
          article &&
          article.title &&
          article.url &&
          article.source &&
          article.source.name
        );
      });

     if (usable) {
      return {
        sourceName: usable.source?.name || "",
        title: usable.title || "",
        url: usable.url || "",
        description: usable.description || "",
        publishedAt: usable.publishedAt || "",
      };
    }
  } catch (err) {
    console.log(
      `News query failed for ${query || "(no query)"}`
    );
  }
}

return null;
}

async function generateTikTokLane(newsItem) {
  const prompt = buildTikTokPrompt(newsItem);

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
  });

  const output = response.choices[0]?.message?.content ?? "";

  return {
    tiktokScript: extract(output, "TIKTOK SCRIPT"),
    tiktokCaption: extract(output, "TIKTOK CAPTION"),
    rawTikTokResponse: output,
  };
}

// =======================
// AI Q&A
// =======================

async function askAIAboutRuns(question, runs, metricsStore) {
  const prompt = `
You are an analyst for a builder's social posting dashboard.

Answer the user's question using:
1. the run history
2. X post metrics if available
3. patterns across recent content

Rules:
- be direct
- be concrete
- give practical recommendations
- do not make up metrics
- if metrics are missing, say that clearly

User question:
${question}

Run data:
${JSON.stringify(runs || [], null, 2)}

X metrics:
${JSON.stringify(metricsStore || {}, null, 2)}
`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content?.trim() || "No answer returned.";
}

// =======================
// RUN CREATION
// =======================

async function createRunFromInput(input, topicOverride = "", xAccountLabel = "") {
 let newsItem = null;

if (topicOverride && topicOverride.trim()) {
  newsItem = {
    sourceName: "Manual Override",
    title: topicOverride.trim(),
    url: "",
    description: topicOverride.trim(),
    publishedAt: new Date().toISOString(),
  };
} else {
  try {
    newsItem = await getRealNewsItem();
  } catch (err) {
    console.log("News skipped:", err.message);
  }
}

const tiktokLane = newsItem
  ? await generateTikTokLane(newsItem)
  : {
      tiktokScript: "",
      tiktokCaption: "",
      rawTikTokResponse: "",
    };

  const pipeline = await runFivePassPipeline(input, {
    linkedinGoal: "thought_leadership",
    twitterGoal: "engagement",
    slackGoal: "build_log",
  });

  const summary =
    String(pipeline.outputs.summary || "").trim() ||
    "Build content generated. Review edits before posting.";

  const linkedinFinal = pipeline.outputs.linkedin || {
    finalText: "",
    persona: choosePersona({ platform: "linkedin", goal: "thought_leadership" }),
    postMode: "thought_leadership",
  };

  const twitterFinal = pipeline.outputs.twitter || {
    finalText: "",
    persona: choosePersona({ platform: "twitter", goal: "engagement" }),
    postMode: "engagement",
  };

  const slackFinal = pipeline.outputs.slack || {
    finalText: "",
    persona: choosePersona({ platform: "slack", goal: "build_log" }),
    postMode: "build_log",
  };

  const summaryPersona = choosePersona({
    platform: "internal",
    goal: "build_log",
  });

  const summaryFinal = finalizePost(summary, {
    persona: summaryPersona,
    postMode: "build_log",
  });

  const result = {
    input_text: input,

    summary: summaryFinal.finalText,
    outcome_text: pipeline.raw?.context || "",
    impact_text: pipeline.raw?.draft || "",
    progress_state_text: pipeline.raw?.tightened || "",
    next_action_text: "",

    slack_text: slackFinal.finalText,
    linkedin_text: linkedinFinal.finalText,
    twitter_text: twitterFinal.finalText,

   tiktok_topic: newsItem?.title || "",
tiktok_script: tiktokLane.tiktokScript || "",
tiktok_caption: tiktokLane.tiktokCaption || "",

news_source_name: newsItem?.sourceName || "",
news_source_title: newsItem?.title || "",
news_source_url: newsItem?.url || "",
news_published_at: newsItem?.publishedAt || null,

    raw_response: JSON.stringify(
      {
        build_pipeline: pipeline.raw,
        tiktok_raw_response: tiktokLane.rawTikTokResponse || "",
      },
      null,
      2
    ),

    generated_summary: summaryFinal.finalText,
    generated_slack_text: slackFinal.finalText,
    generated_linkedin_text: linkedinFinal.finalText,
    generated_twitter_text: twitterFinal.finalText,
    generated_tiktok_script: tiktokLane.tiktokScript || "",
    generated_tiktok_caption: tiktokLane.tiktokCaption || "",

    generated_linkedin_persona: linkedinFinal.persona || null,
    generated_twitter_persona: twitterFinal.persona || null,
    persona: summaryPersona || null,
    post_mode: "build_log",
    learning_notes: null,
    recommended_persona: null,

    drift_summary: false,
    drift_slack: false,
    drift_linkedin: false,
    drift_twitter: false,
    drift_tiktok_script: false,
    drift_tiktok_caption: false,

    status: "draft",
    x_post_status: "not_sent",
    linkedin_post_status: "not_sent",
    x_tweet_id: null,
    error_message: null,
    run_reason: "dashboard",
  };

  const { data, error } = await supabase
    .from("build_logger_runs")
    .insert([result])
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to save run: ${error.message}`);
  }

  const chosenLabel = safeTrim(xAccountLabel) || getDefaultXAccountLabel();
  setMappedRunAccount(data.id, chosenLabel);

  return attachRunAccountMetadata(data);
}

// =======================
// X POSTING + METRICS
// =======================

async function postRunToX(run, options = {}) {
  if (!run) {
    throw new Error("Run not found");
  }

  if (run.status !== "approved") {
    throw new Error(
      `Run must be approved before posting. Current status: ${run.status}`
    );
  }

  if (!run.twitter_text || !run.twitter_text.trim()) {
    throw new Error("No twitter_text available to post");
  }

  if (run.x_post_status === "sent") {
    throw new Error("X post already sent");
  }

  const accountLabel = resolveRunAccountLabel(run, options.accountLabel);
  const accountMapping = setMappedRunAccount(run.id, accountLabel);
  const { client, credentials } = getXClientForAccountLabel(accountLabel);

  const tweet = await client.v2.tweet(run.twitter_text);

  const { data: updatedRun, error: updateError } = await supabase
    .from("build_logger_runs")
    .update({
      x_post_status: "sent",
      x_posted_at: new Date().toISOString(),
      posted_at: new Date().toISOString(),
      status: "posted",
      x_tweet_id: tweet.data.id,
      error_message: null,
    })
    .eq("id", run.id)
    .select()
    .maybeSingle();

  if (updateError) {
    throw new Error(
      `Tweet sent but database update failed: ${updateError.message}`
    );
  }

  const store = readXMetricsFile();
  store.metrics[run.id] = {
    ...(store.metrics[run.id] || {}),
    run_id: run.id,
    tweet_id: tweet.data.id,
    account_label: accountLabel,
    x_handle: credentials.handle || accountMapping.handle || "",
    persona:
      run.generated_twitter_persona ||
      run.recommended_persona ||
      run.persona ||
      "operator",
    post_mode: run.post_mode || "build_log",
    synced_at: new Date().toISOString(),
  };
  saveXMetricsFile(store);

  upsertXMetric({
    tweet_id: tweet.data.id,
    account_label: accountLabel,
    handle: credentials.handle || accountMapping.handle || "",
    persona:
      run.generated_twitter_persona ||
      run.recommended_persona ||
      run.persona ||
      "operator",
    post_mode: run.post_mode || "build_log",
    raw: {
      run_id: run.id,
    },
  });

  return {
    tweet,
    run: attachRunAccountMetadata(updatedRun),
    account: {
      label: accountLabel,
      handle: credentials.handle || accountMapping.handle || "",
      display_name: credentials.display_name || accountMapping.display_name || "",
    },
  };
}

async function syncXMetricsForRun(run, options = {}) {
  if (!run) {
    throw new Error("Run not found");
  }

  if (!run.x_tweet_id) {
    throw new Error("Run has no x_tweet_id yet");
  }

  const accountLabel = resolveRunAccountLabel(run, options.accountLabel);
  const accountMapping = setMappedRunAccount(run.id, accountLabel);
  const { client, credentials } = getXClientForAccountLabel(accountLabel);

  let tweetResponse = null;

  try {
    tweetResponse = await client.v2.singleTweet(run.x_tweet_id, {
      "tweet.fields": ["public_metrics", "organic_metrics", "non_public_metrics"],
    });
  } catch (error) {
    throw new Error(
      `Failed to fetch X metrics for "${accountLabel}": ${error.message}`
    );
  }

  const tweetData = tweetResponse?.data || {};
  const publicMetrics = tweetData.public_metrics || {};
  const organicMetrics = tweetData.organic_metrics || {};
  const nonPublicMetrics = tweetData.non_public_metrics || {};

  const metrics = {
    run_id: run.id,
    tweet_id: run.x_tweet_id,
    account_label: accountLabel,
    x_handle: credentials.handle || accountMapping.handle || "",
    persona:
      run.generated_twitter_persona ||
      run.recommended_persona ||
      run.persona ||
      "operator",
    post_mode: run.post_mode || "build_log",
    like_count: publicMetrics.like_count || 0,
    reply_count: publicMetrics.reply_count || 0,
    repost_count: publicMetrics.retweet_count || 0,
    quote_count: publicMetrics.quote_count || 0,
    impression_count:
      nonPublicMetrics.impression_count ||
      organicMetrics.impression_count ||
      0,
    synced_at: new Date().toISOString(),
  };

  const store = readXMetricsFile();
  store.metrics[run.id] = metrics;
  saveXMetricsFile(store);

  upsertXMetric({
    tweet_id: run.x_tweet_id,
    account_label: accountLabel,
    handle: credentials.handle || accountMapping.handle || "",
    persona:
      run.generated_twitter_persona ||
      run.recommended_persona ||
      run.persona ||
      "operator",
    post_mode: run.post_mode || "build_log",
    impression_count: metrics.impression_count,
    like_count: metrics.like_count,
    repost_count: metrics.repost_count,
    reply_count: metrics.reply_count,
    quote_count: metrics.quote_count,
    raw: tweetData,
  });

  return metrics;
}

// =======================
// QUEUE ACTION ROUTES
// =======================

app.get("/api/queue", (req, res) => {
  const data = readQueueFile();
  return res.json(data);
});

app.post("/api/queue/clear", (req, res) => {
  try {
    const data = readQueueFile();

    data.queue.forEach((item) => {
      archiveQueueItem(item, "clear_queue");
    });

    saveQueueFile({ queue: [] });

    return res.json({
      message: "Queue cleared",
      cleared_count: data.queue.length,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to clear queue",
      details: err.message,
    });
  }
});

app.post("/api/queue/:id/archive", (req, res) => {
  try {
    const data = readQueueFile();
    const item = data.queue.find((q) => q.id === req.params.id);

    if (!item) {
      return res.status(404).json({ error: "Queue item not found" });
    }

    const remaining = data.queue.filter((q) => q.id !== req.params.id);

    archiveQueueItem(
      {
        ...item,
        status: "archived",
        review_status: "archived",
        archived_at: new Date().toISOString(),
      },
      "manual_archive"
    );

    saveQueueFile({ queue: remaining });

    return res.json({
      message: "Queue item archived",
      item_id: req.params.id,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to archive queue item",
      details: err.message,
    });
  }
});

app.post("/api/queue/:id/investigate", async (req, res) => {
  try {
    const data = readQueueFile();
    const item = data.queue.find((q) => q.id === req.params.id);

    if (!item) {
      return res.status(404).json({ error: "Queue item not found" });
    }

    const prompt = `
You are reviewing a queued social media post.

Give a short plain-English answer with:
1. why this item may be concerning
2. what the user should check next
3. whether the best action is archive, investigate, or post anyway

Platform: ${item.platform || ""}
Account: ${item.account_label || ""}
Status: ${item.status || ""}
Review Status: ${item.review_status || ""}
Content: ${item.content || ""}
`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    });

    const explanation =
      response.choices[0]?.message?.content?.trim() || "AI review unavailable.";

    const updatedQueue = data.queue.map((q) => {
      if (q.id !== req.params.id) return q;

      return {
        ...q,
        review_status: "investigating",
        investigated_at: new Date().toISOString(),
        risk_summary: explanation,
        recommended_action: "investigate",
      };
    });

    saveQueueFile({ queue: updatedQueue });

    return res.json({
      message: "Queue item marked for investigation",
      item_id: req.params.id,
      ai_summary: explanation,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to investigate queue item",
      details: err.message,
    });
  }
});

app.post("/api/queue/:id/post-anyway", (req, res) => {
  try {
    const data = readQueueFile();
    const updatedQueue = data.queue.map((q) => {
      if (q.id !== req.params.id) return q;

      return {
        ...q,
        review_status: "override_posted",
        override_posted_at: new Date().toISOString(),
        recommended_action: "post_anyway",
        status: "pending",
        scheduled_for: new Date().toISOString(),
      };
    });

    const item = updatedQueue.find((q) => q.id === req.params.id);

    if (!item) {
      return res.status(404).json({ error: "Queue item not found" });
    }

    saveQueueFile({ queue: updatedQueue });

    return res.json({
      message: "Queue item set to post anyway",
      item_id: req.params.id,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to set post anyway",
      details: err.message,
    });
  }
});

// =======================
// X ACCOUNT ROUTES
// =======================

app.get("/api/x/accounts", (req, res) => {
  try {
    const accounts = getXAccountStatusList();
    return res.json({
      default_account_label: getDefaultXAccountLabel(),
      accounts,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to load X accounts",
      details: err.message,
    });
  }
});

app.patch("/api/runs/:id/x-account", async (req, res) => {
  try {
    const accountLabel = safeTrim(req.body.account_label);

    if (!accountLabel) {
      return res.status(400).json({ error: "Missing account_label" });
    }

    const { data: run, error } = await supabase
      .from("build_logger_runs")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch run",
        details: error.message,
      });
    }

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const mapping = setMappedRunAccount(run.id, accountLabel);

    return res.json({
      message: "Run X account updated",
      run_id: run.id,
      account: mapping,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to update run X account",
      details: err.message,
    });
  }
});

// =======================
// X METRICS ROUTES
// =======================

app.post("/api/runs/:id/sync-x-metrics", async (req, res) => {
  try {
    const { data: run, error } = await supabase
      .from("build_logger_runs")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch run",
        details: error.message,
      });
    }

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    const accountLabel = safeTrim(req.body.account_label);
    const metrics = await syncXMetricsForRun(run, { accountLabel });

    return res.json({
      message: "X metrics synced",
      metrics,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Failed to sync X metrics",
      details: err.message,
    });
  }
});

// =======================
// AI ROUTES
// =======================

app.post("/api/ai/weekly-rundown", async (req, res) => {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: runs, error } = await supabase
      .from("build_logger_runs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch weekly runs",
        details: error.message,
      });
    }

    const runsWithAccounts = attachRunAccountMetadataList(runs || []);
    const metricsStore = readXMetricsFile().metrics || {};

    const answer = await askAIAboutRuns(
      "Give me a weekly rundown of my last 7 days of posts. Tell me the main themes, what performed best, what underperformed, and 5 direct recommendations for the next posts.",
      runsWithAccounts,
      metricsStore
    );

    return res.json({
      message: "Weekly rundown ready",
      answer,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Weekly rundown failed",
      details: err.message,
    });
  }
});

app.post("/api/ai/ask", async (req, res) => {
  try {
    const question = String(req.body.question || "").trim();

    if (!question) {
      return res.status(400).json({ error: "Missing question" });
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: runs, error } = await supabase
      .from("build_logger_runs")
      .select("*")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch runs for AI",
        details: error.message,
      });
    }

    const runsWithAccounts = attachRunAccountMetadataList(runs || []);
    const metricsStore = readXMetricsFile().metrics || {};
    const answer = await askAIAboutRuns(question, runsWithAccounts, metricsStore);

    return res.json({
      message: "AI answer ready",
      answer,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Ask AI failed",
      details: err.message,
    });
  }
});

// =======================
// HTML HELPERS
// =======================

function renderXAccountSelect(selectId, selectedLabel, extraAttrs = "") {
  const accounts = getXAccountStatusList();
  const options = accounts
    .map((account) => {
      const selected = account.label === selectedLabel ? "selected" : "";
      const ready = account.is_ready ? "ready" : "missing";
      return `<option value="${escapeHtml(account.label)}" ${selected}>${escapeHtml(
        account.label
      )} ${escapeHtml(account.handle || "")} [${ready}]</option>`;
    })
    .join("");

  return `<select id="${escapeHtml(selectId)}" ${extraAttrs}
    style="width:100%; background:#0b1220; color:#e2e8f0; border:1px solid #334155; border-radius:10px; padding:10px; box-sizing:border-box; margin-bottom:10px;">
      ${options}
    </select>`;
}

// =======================
// RUN ROUTES
// =======================

app.get("/runs/:id", async (req, res) => {
  try {
    const { data: rawRun, error } = await supabase
      .from("build_logger_runs")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw new Error(error.message);

    if (!rawRun) {
      return res.status(404).send(`
        <h1>Run not found</h1>
        <p><a href="/" style="color:#93c5fd;">Back to dashboard</a></p>
      `);
    }

    const run = attachRunAccountMetadata(rawRun);
    const metrics = getRunMetrics(run.id);
    const accountStatuses = getXAccountStatusList();
    const selectedAccountStatus =
      accountStatuses.find((a) => a.label === run.x_account_label) || null;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Run Details</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      margin: 0;
      padding: 24px;
    }
    h1, h2 { margin-top: 0; }
    .panel {
      background: #111827;
      border: 1px solid #334155;
      border-radius: 14px;
      padding: 18px;
      margin-bottom: 20px;
    }
    .label {
      font-size: 12px;
      color: #94a3b8;
      text-transform: uppercase;
      margin-bottom: 4px;
      letter-spacing: 0.04em;
    }
    .value {
      white-space: pre-wrap;
      margin-bottom: 14px;
      line-height: 1.45;
    }
    .meta {
      color: #94a3b8;
      font-size: 13px;
      margin-bottom: 10px;
    }
    .status {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: bold;
      margin-right: 8px;
    }
    .status-draft { background: #334155; color: #e2e8f0; }
    .status-approved { background: #14532d; color: #bbf7d0; }
    .status-posted { background: #1d4ed8; color: #dbeafe; }
    .status-failed { background: #7f1d1d; color: #fecaca; }
    .status-drift { background: #78350f; color: #fde68a; }
    .btns {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      margin-bottom: 18px;
    }
    .btns button, .btns a {
      padding: 8px 12px;
      border: 0;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      text-decoration: none;
      display: inline-block;
    }
    .approve { background: #22c55e; color: #052e16; }
    .draft { background: #94a3b8; color: #0f172a; }
    .postx { background: #60a5fa; color: #082f49; }
    .btn-orange { background: #f59e0b; color: #451a03; }
    .compare-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .compare-box {
      background: #111827;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 16px;
    }
    .field-block { margin-bottom: 18px; }
    .drift-yes { color: #fde68a; font-weight: bold; }
    .drift-no { color: #86efac; font-weight: bold; }
    textarea {
      width: 100%;
      background: #0b1220;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px;
      box-sizing: border-box;
      margin-bottom: 12px;
      font-family: Arial, sans-serif;
      min-height: 120px;
      resize: vertical;
    }
    .metrics-line {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 14px;
    }
    .metric-chip {
      background: #0b1220;
      border: 1px solid #334155;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
    }
    .account-box {
      background: #0b1220;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 14px;
    }
  </style>
</head>
<body>
  <p><a href="/" style="color:#93c5fd;">← Back to dashboard</a></p>

  <div class="panel">
    <h1>Run Details</h1>

    <div class="meta">
      <div><strong>ID:</strong> ${escapeHtml(run.id || "")}</div>
      <div><strong>Created:</strong> ${escapeHtml(run.created_at || "")}</div>
      <div><strong>Approved:</strong> ${escapeHtml(run.approved_at || "")}</div>
      <div><strong>Posted:</strong> ${escapeHtml(run.posted_at || "")}</div>
      <div><strong>X Tweet ID:</strong> ${escapeHtml(run.x_tweet_id || "n/a")}</div>
      <div><strong>X Account:</strong> ${escapeHtml(run.x_account_label || "n/a")} ${escapeHtml(run.x_account_handle || "")}</div>
      <div><strong>X Credentials Ready:</strong> ${escapeHtml(selectedAccountStatus?.is_ready ? "yes" : "no")}</div>
      <div><strong>Persona:</strong> ${escapeHtml(run.generated_twitter_persona || run.persona || "n/a")}</div>
      <div><strong>Post Mode:</strong> ${escapeHtml(run.post_mode || "n/a")}</div>
    </div>

    <div>
      <span class="status ${statusClass(run.status)}">${escapeHtml(run.status || "draft")}</span>
      <span class="status ${statusClass(run.x_post_status === "sent" ? "posted" : "draft")}">
        X: ${escapeHtml(run.x_post_status || "not_sent")}
      </span>
      ${hasAnyDrift(run) ? `<span class="status status-drift">drift detected</span>` : ""}
    </div>

    <div class="account-box">
      <div class="label">X Account for this Run</div>
      ${renderXAccountSelect(`x-account-${run.id}`, run.x_account_label)}
      <div class="btns" style="margin-top:0;">
        <button class="btn-orange" onclick="saveXAccount('${run.id}')">Save X Account</button>
      </div>
    </div>

    <div class="metrics-line">
      <div class="metric-chip">Likes: ${escapeHtml(metrics?.like_count || 0)}</div>
      <div class="metric-chip">Replies: ${escapeHtml(metrics?.reply_count || 0)}</div>
      <div class="metric-chip">Reposts: ${escapeHtml(metrics?.repost_count || 0)}</div>
      <div class="metric-chip">Quotes: ${escapeHtml(metrics?.quote_count || 0)}</div>
      <div class="metric-chip">Impressions: ${escapeHtml(metrics?.impression_count || 0)}</div>
      <div class="metric-chip">Synced: ${escapeHtml(formatLocal(metrics?.synced_at || ""))}</div>
      <div class="metric-chip">Account: ${escapeHtml(metrics?.account_label || run.x_account_label || "n/a")}</div>
      <div class="metric-chip">Persona: ${escapeHtml(metrics?.persona || run.generated_twitter_persona || "n/a")}</div>
    </div>

    <div class="label">Summary</div>
    <div class="value">${escapeHtml(run.summary || "")}</div>

    <div class="btns">
      <button class="approve" onclick="updateStatus('${run.id}', 'approved')">Approve</button>
      <button class="draft" onclick="updateStatus('${run.id}', 'draft')">Move to Draft</button>
      <button class="postx" onclick="postX('${run.id}')">Post to X</button>
      <button class="btn-orange" onclick="syncXMetrics('${run.id}')">Sync X Metrics</button>
      <form method="POST" action="/logout" style="display:inline;">
        <button class="draft" type="submit">Logout</button>
      </form>
    </div>
  </div>

  <div class="compare-grid">
    <div class="compare-box">
      <h2>Generated Baseline</h2>

      <div class="field-block">
        <div class="label">Summary</div>
        <div class="value">${escapeHtml(run.generated_summary || "")}</div>
        <div class="${run.drift_summary ? "drift-yes" : "drift-no"}">Drift: ${driftLabel(run.drift_summary)}</div>
      </div>

      <div class="field-block">
        <div class="label">Slack</div>
        <div class="value">${escapeHtml(run.generated_slack_text || "")}</div>
        <div class="${run.drift_slack ? "drift-yes" : "drift-no"}">Drift: ${driftLabel(run.drift_slack)}</div>
      </div>

      <div class="field-block">
        <div class="label">LinkedIn</div>
        <div class="value">${escapeHtml(run.generated_linkedin_text || "")}</div>
        <div class="${run.drift_linkedin ? "drift-yes" : "drift-no"}">Drift: ${driftLabel(run.drift_linkedin)}</div>
      </div>

      <div class="field-block">
        <div class="label">Twitter</div>
        <div class="value">${escapeHtml(run.generated_twitter_text || "")}</div>
        <div class="${run.drift_twitter ? "drift-yes" : "drift-no"}">Drift: ${driftLabel(run.drift_twitter)}</div>
      </div>
    </div>

    <div class="compare-box">
      <h2>Current Editable Content</h2>

      <div class="field-block">
        <div class="label">Summary</div>
        <textarea id="summary-${run.id}">${escapeHtml(run.summary || "")}</textarea>
      </div>

      <div class="field-block">
        <div class="label">Slack</div>
        <textarea id="slack-${run.id}">${escapeHtml(run.slack_text || "")}</textarea>
      </div>

      <div class="field-block">
        <div class="label">LinkedIn</div>
        <textarea id="linkedin-${run.id}">${escapeHtml(run.linkedin_text || "")}</textarea>
      </div>

      <div class="field-block">
        <div class="label">Twitter</div>
        <textarea id="twitter-${run.id}">${escapeHtml(run.twitter_text || "")}</textarea>
      </div>

      <div class="btns">
        <button class="btn-orange" type="button" onclick="saveEdits('${run.id}')">Save Edits</button>
      </div>
    </div>
  </div>

  <script>
    function getSelectedAccount(id) {
      return document.getElementById('x-account-' + id)?.value || '';
    }

    async function saveXAccount(id) {
      const account_label = getSelectedAccount(id);

      const res = await fetch('/api/runs/' + id + '/x-account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_label })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to save X account');
        return;
      }

      window.location.reload();
    }

    async function updateStatus(id, status) {
      const res = await fetch('/api/runs/' + id + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to update status');
        return;
      }
      window.location.reload();
    }

    async function postX(id) {
      const account_label = getSelectedAccount(id);

      const res = await fetch('/api/runs/' + id + '/post-x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_label })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to post to X');
        return;
      }
      window.location.reload();
    }

    async function syncXMetrics(id) {
      const account_label = getSelectedAccount(id);

      const res = await fetch('/api/runs/' + id + '/sync-x-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_label })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to sync X metrics');
        return;
      }
      alert('X metrics synced');
      window.location.reload();
    }

    async function saveEdits(id) {
      const payload = {
        summary: document.getElementById('summary-' + id)?.value || '',
        slack_text: document.getElementById('slack-' + id)?.value || '',
        linkedin_text: document.getElementById('linkedin-' + id)?.value || '',
        twitter_text: document.getElementById('twitter-' + id)?.value || '',
      };

      const res = await fetch('/api/runs/' + id + '/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to save edits');
        return;
      }
      window.location.reload();
    }
  </script>
</body>
</html>
    `;

    return res.send(html);
  } catch (err) {
    return res.status(500).send(`
      <h1>Run Details Error</h1>
      <pre>${escapeHtml(err.message)}</pre>
      <p><a href="/" style="color:#93c5fd;">Back to dashboard</a></p>
    `);
  }
});

app.get("/", async (req, res) => {
  try {
    const filterStatus = String(req.query.status || "").trim();

    let query = supabase
      .from("build_logger_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(24);

    if (filterStatus) {
      query = query.eq("status", filterStatus);
    }

    const { data: rawRuns, error } = await query;
    if (error) throw new Error(error.message);

    const rows = attachRunAccountMetadataList(rawRuns || []);
    const latest = rows[0] || null;

    const queueData = readQueueFile();
    const driftData = readDriftFile();
    const metricsStore = readXMetricsFile().metrics || {};
    const queue = queueData.queue || [];
    const channelDirectory = buildChannelDirectory(queue);
    const queueInsights = buildQueueInsights(queue, driftData);
    const accountStatuses = getXAccountStatusList();

    const queueSummary = {
      total: queue.length,
      pending: queue.filter((q) => q.status === "pending").length,
      posted: queue.filter((q) => q.status === "posted").length,
      failed: queue.filter((q) => q.status === "failed").length,
      duplicateDrift: driftData.duplicate_attempts_total || 0,
      activeChannels: channelDirectory.length,
      heartbeat: new Date().toISOString(),
    };

    const missionStatus = getMissionStatus(queueSummary, queueInsights);
    const primaryAction = queueInsights.actions[0] || {
      impact: "No critical issue detected.",
      nextMove: "Keep scheduler alive.",
      channel: "All channels",
      command: "node scheduler.js",
    };

    const nextScheduledPending =
      queue
        .filter((q) => q.status === "pending" && q.scheduled_for)
        .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))[0] ||
      null;

    const recentPosted = queue.filter((q) => q.status === "posted").slice(-4).reverse();
    const latestMetrics = latest ? metricsStore[latest.id] || null : null;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Build Logger Command Center</title>
  <style>
    :root{
      --bg:#06101b;
      --panel:rgba(12,22,38,.92);
      --border:rgba(102,182,255,.16);
      --text:#eef6ff;
      --muted:#8ea7c6;
      --cyan:#66d4ff;
      --blue:#6eb7ff;
      --green:#1be39f;
      --amber:#ffbf58;
      --red:#ff5d7c;
      --radius:16px;
      --shadow:0 14px 34px rgba(0,0,0,.28);
    }

    * { box-sizing:border-box; }
    body{
      margin:0;
      font-family:Inter, Arial, sans-serif;
      color:var(--text);
      background:
        radial-gradient(circle at top left, rgba(102,212,255,.14), transparent 26%),
        radial-gradient(circle at top right, rgba(110,183,255,.08), transparent 18%),
        linear-gradient(180deg, #040b14 0%, #07111c 100%);
      min-height:100vh;
      padding:10px;
    }

    .shell{ display:grid; gap:10px; }
    .top-grid{ display:grid; grid-template-columns:1.08fr 1fr; gap:10px; }
    .bottom-grid{ display:grid; grid-template-columns:0.9fr 0.92fr 1.22fr; gap:10px; }
    .work-grid{ display:grid; grid-template-columns:1.15fr 1fr; gap:10px; }
    .ai-grid{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .history-grid{ display:grid; grid-template-columns:repeat(auto-fit, minmax(360px, 1fr)); gap:10px; }

    .box{
      min-width:0;
      background:var(--panel);
      border:1px solid var(--border);
      border-radius:var(--radius);
      box-shadow:var(--shadow);
      backdrop-filter:blur(14px);
      padding:12px;
      overflow:hidden;
    }

    .box-title{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      margin-bottom:8px;
    }

    .box-title h2{ margin:0; font-size:14px; letter-spacing:-.02em; }
    .eyebrow{
      color:var(--cyan);
      font-size:10px;
      text-transform:uppercase;
      letter-spacing:.16em;
      white-space:nowrap;
    }

    .status-bar{
      height:8px;
      border-radius:999px;
      overflow:hidden;
      background:rgba(255,255,255,.05);
      border:1px solid rgba(255,255,255,.06);
      margin-bottom:10px;
    }

    .status-bar-fill{ height:100%; width:100%; }
    .status-bar-fill.green{ background:linear-gradient(90deg, rgba(27,227,159,.95), rgba(102,212,255,.55)); }
    .status-bar-fill.amber{ background:linear-gradient(90deg, rgba(255,191,88,.95), rgba(102,212,255,.35)); }
    .status-bar-fill.red{ background:linear-gradient(90deg, rgba(255,93,124,.95), rgba(255,191,88,.35)); }

    .headline{
      font-size:24px;
      line-height:1.03;
      font-weight:800;
      letter-spacing:-.04em;
      max-width:88%;
      margin-bottom:6px;
    }

    .subcopy{
      color:var(--muted);
      font-size:11px;
      line-height:1.4;
      max-width:90%;
      margin-bottom:8px;
    }

    .status-chip{
      display:inline-flex;
      align-items:center;
      width:max-content;
      padding:6px 10px;
      border-radius:999px;
      font-size:10px;
      text-transform:uppercase;
      letter-spacing:.14em;
      font-weight:800;
      border:1px solid rgba(255,255,255,.08);
      background:rgba(255,255,255,.03);
      margin-bottom:10px;
    }
    .status-chip.green{ color:var(--green); }
    .status-chip.amber{ color:var(--amber); }
    .status-chip.red{ color:var(--red); }

    .signal-card{
      border:1px solid rgba(102,212,255,.18);
      background:rgba(102,212,255,.07);
      border-radius:14px;
      padding:12px;
      display:grid;
      gap:6px;
      margin-bottom:10px;
    }

    .micro{
      color:var(--cyan);
      font-size:9px;
      text-transform:uppercase;
      letter-spacing:.15em;
    }

    .signal-impact{ font-size:18px; font-weight:700; line-height:1.25; }
    .signal-next{ color:var(--text); font-size:12px; line-height:1.35; }
    .signal-channel{ color:var(--muted); font-size:11px; line-height:1.3; }

    .command-line{
      border-radius:12px;
      padding:9px 10px;
      background:rgba(2,8,18,.8);
      border:1px solid rgba(102,212,255,.14);
      color:#c4efff;
      font-family:Consolas, monospace;
      font-size:11px;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }

    .kpi-grid{ display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; }

    .metric{
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.05);
      border-radius:14px;
      padding:10px;
      min-width:0;
    }

    .metric-label{
      color:var(--muted);
      font-size:9px;
      text-transform:uppercase;
      letter-spacing:.14em;
      margin-bottom:7px;
    }

    .metric-value{
      font-size:18px;
      font-weight:800;
      line-height:1.05;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }

    .metric.good .metric-value{ color:var(--green); }
    .metric.warn .metric-value{ color:var(--amber); }
    .metric.bad .metric-value{ color:var(--red); }
    .metric.info .metric-value{ color:var(--cyan); }

    .action-list{ display:grid; grid-template-rows:repeat(3, 1fr); gap:8px; min-height:320px; }

    .action-row{
      border-radius:14px;
      padding:10px;
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.05);
      display:grid;
      gap:5px;
      overflow:hidden;
    }

    .action-row.high{ border-color:rgba(255,93,124,.2); }
    .action-row.medium{ border-color:rgba(255,191,88,.18); }
    .action-row.low{ border-color:rgba(27,227,159,.14); }

    .action-top{ display:flex; align-items:center; gap:7px; min-width:0; }
    .action-title{
      font-size:13px;
      font-weight:800;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .action-channel{
      color:var(--cyan);
      font-size:10px;
      line-height:1.2;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }
    .action-impact{ color:var(--text); font-size:11px; line-height:1.3; max-height:30px; overflow:hidden; }
    .action-next{ color:var(--muted); font-size:10px; line-height:1.25; max-height:26px; overflow:hidden; }
    .action-command{
      margin-top:auto;
      border-radius:10px;
      padding:6px 8px;
      background:rgba(2,8,18,.8);
      border:1px solid rgba(102,212,255,.12);
      color:#c4efff;
      font-family:Consolas, monospace;
      font-size:10px;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }

    .pill, .tag, .status{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      border-radius:999px;
      padding:4px 7px;
      font-size:9px;
      font-weight:800;
      text-transform:uppercase;
      letter-spacing:.12em;
      flex-shrink:0;
    }

    .pill.high{ background:rgba(255,93,124,.12); color:var(--red); }
    .pill.medium{ background:rgba(255,191,88,.12); color:var(--amber); }
    .pill.low{ background:rgba(27,227,159,.12); color:var(--green); }

    .status-draft { background: #334155; color: #e2e8f0; }
    .status-approved { background: #14532d; color: #bbf7d0; }
    .status-posted { background: #1d4ed8; color: #dbeafe; }
    .status-failed { background: #7f1d1d; color: #fecaca; }
    .status-investigating { background: #312e81; color: #c7d2fe; }
    .status-archived { background: #1f2937; color: #d1d5db; }

    .health-stack{ display:grid; grid-template-rows:1fr 1fr 1fr; gap:8px; min-height:320px; }

    .mini-card{
      border-radius:14px;
      padding:10px;
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.05);
      overflow:hidden;
      font-size:11px;
      line-height:1.35;
      color:var(--muted);
    }

    .mini-card strong{
      display:block;
      margin-bottom:5px;
      color:var(--text);
      font-size:11px;
    }

    .directory-list{ display:grid; gap:6px; margin-top:4px; }

    .directory-row{
      border-radius:12px;
      padding:8px 9px;
      background:rgba(255,255,255,.025);
      border:1px solid rgba(255,255,255,.05);
      overflow:hidden;
    }

    .directory-name{
      color:var(--text);
      font-size:10px;
      font-weight:700;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      margin-bottom:3px;
    }

    .directory-stats{
      color:var(--muted);
      font-size:10px;
      line-height:1.25;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
    }

    .feed-list{ display:grid; grid-template-rows:repeat(4, 1fr); gap:8px; min-height:320px; }

    .feed-row{
      border-radius:14px;
      padding:10px;
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.05);
      display:grid;
      gap:6px;
      overflow:hidden;
    }

    .feed-top{ display:flex; gap:6px; flex-wrap:wrap; }
    .feed-copy{ color:var(--text); font-size:11px; line-height:1.3; overflow:hidden; max-height:30px; }
    .feed-time{ color:var(--muted); font-size:10px; }
    .tag.platform{ background:rgba(102,212,255,.12); color:var(--cyan); }
    .tag.account{ background:rgba(110,183,255,.12); color:var(--blue); }
    .tag.posted{ background:rgba(27,227,159,.12); color:var(--green); }

    .queue-list{ display:grid; gap:10px; }

    .queue-item{
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.06);
      border-radius:14px;
      padding:12px;
    }

    .meta{ color:var(--muted); font-size:11px; line-height:1.45; margin-bottom:8px; }

    .label{
      font-size:10px;
      color:var(--cyan);
      text-transform:uppercase;
      letter-spacing:.14em;
      margin-bottom:4px;
    }

    .value{
      white-space:pre-wrap;
      margin-bottom:10px;
      line-height:1.4;
      font-size:12px;
      color:var(--text);
    }

    .btns, .topbar, .form-actions, .filters{
      display:flex;
      flex-wrap:wrap;
      gap:8px;
    }

    button, .btn-link{
      padding:8px 12px;
      border:0;
      border-radius:10px;
      cursor:pointer;
      font-weight:800;
      text-decoration:none;
      display:inline-block;
    }

    .btn-green { background: #22c55e; color: #052e16; }
    .btn-blue { background: #60a5fa; color: #082f49; }
    .btn-gray { background: #94a3b8; color: #0f172a; }
    .btn-orange { background: #f59e0b; color: #451a03; }
    .btn-red { background: #ef4444; color: #fff; }
    .approve { background: #22c55e; color: #052e16; }
    .draft { background: #94a3b8; color: #0f172a; }
    .postx { background: #60a5fa; color: #082f49; }

    textarea, input[type="text"] {
      width: 100%;
      background: #0b1220;
      color: #e2e8f0;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px;
      box-sizing: border-box;
      margin-bottom: 12px;
      font-family: Arial, sans-serif;
    }

    textarea { min-height: 160px; resize: vertical; }

    .run-card{
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.06);
      border-radius:14px;
      padding:12px;
    }

    .muted{ color:var(--muted); font-size:12px; }
    .footer{ margin-top:6px; color:var(--muted); font-size:10px; }

    .metrics-line{
      display:flex;
      flex-wrap:wrap;
      gap:6px;
      margin-bottom:10px;
    }

    .metric-chip{
      background:#0b1220;
      border:1px solid #334155;
      border-radius:999px;
      padding:5px 8px;
      font-size:11px;
      color:#dbeafe;
    }

    .ai-answer{
      background:#0b1220;
      border:1px solid #334155;
      border-radius:12px;
      padding:12px;
      color:#e2e8f0;
      min-height:180px;
      white-space:pre-wrap;
      line-height:1.45;
    }

    @media (max-width: 1280px){
      .top-grid, .bottom-grid, .work-grid, .ai-grid{
        grid-template-columns:1fr;
      }
      .kpi-grid{
        grid-template-columns:repeat(2, 1fr);
      }
    }
  </style>
</head>
<body>
  <div class="shell">

    <div class="topbar">
      <a class="btn-link btn-green" href="/">Refresh</a>
      <a class="btn-link btn-gray" href="/?status=">All</a>
      <a class="btn-link btn-gray" href="/?status=draft">Draft</a>
      <a class="btn-link btn-gray" href="/?status=approved">Approved</a>
      <a class="btn-link btn-gray" href="/?status=posted">Posted</a>
      <a class="btn-link btn-gray" href="/?status=failed">Failed</a>
      <button class="btn-red" onclick="clearQueue()">Clear Queue</button>
      <form method="POST" action="/logout" style="display:inline;">
        <button class="btn-red" type="submit">Logout</button>
      </form>
    </div>

    <div class="top-grid">
      <section class="box">
        <div class="status-bar">
          <div class="status-bar-fill ${escapeHtml(missionStatus.tone)}"></div>
        </div>

        <div class="box-title">
          <h2>Mission Control</h2>
          <div class="eyebrow">Current Priority</div>
        </div>

        <div class="headline">Proof of work should drive the next move.</div>
        <div class="subcopy">
          Daily command view for queue pressure, execution health, and published output across accounts.
        </div>

        <div class="status-chip ${escapeHtml(missionStatus.tone)}">${escapeHtml(missionStatus.label)}</div>

        <div class="signal-card">
          <div class="micro">Primary Signal</div>
          <div class="signal-impact">${escapeHtml(primaryAction.impact || "No critical issue detected.")}</div>
          <div class="micro">Affected Channel</div>
          <div class="signal-channel">${escapeHtml(primaryAction.channel || "All channels")}</div>
          <div class="micro">Recommended Move</div>
          <div class="signal-next">${escapeHtml(primaryAction.nextMove || "Keep scheduler alive.")}</div>
        </div>

        <div class="command-line">${escapeHtml(primaryAction.command || "node scheduler.js")}</div>
      </section>

      <section class="box">
        <div class="box-title">
          <h2>System Snapshot</h2>
          <div class="eyebrow">Live State</div>
        </div>

        <div class="kpi-grid">
          <div class="metric info">
            <div class="metric-label">Total Posts</div>
            <div class="metric-value">${escapeHtml(queueSummary.total)}</div>
          </div>
          <div class="metric ${queueSummary.pending > 0 ? "warn" : "good"}">
            <div class="metric-label">Pending</div>
            <div class="metric-value">${escapeHtml(queueSummary.pending)}</div>
          </div>
          <div class="metric good">
            <div class="metric-label">Posted</div>
            <div class="metric-value">${escapeHtml(queueSummary.posted)}</div>
          </div>
          <div class="metric ${queueSummary.failed > 0 ? "bad" : "good"}">
            <div class="metric-label">Failed</div>
            <div class="metric-value">${escapeHtml(queueSummary.failed)}</div>
          </div>
          <div class="metric ${queueSummary.duplicateDrift > 0 ? "warn" : "good"}">
            <div class="metric-label">Duplicate Drift</div>
            <div class="metric-value">${escapeHtml(queueSummary.duplicateDrift)}</div>
          </div>
          <div class="metric info">
            <div class="metric-label">Active Channels</div>
            <div class="metric-value">${escapeHtml(queueSummary.activeChannels)}</div>
          </div>
          <div class="metric ${queueInsights.dueSoon.length > 0 ? "warn" : "good"}">
            <div class="metric-label">Due Soon</div>
            <div class="metric-value">${escapeHtml(queueInsights.dueSoon.length)}</div>
          </div>
          <div class="metric info">
            <div class="metric-label">Next Window</div>
            <div class="metric-value">${escapeHtml(nextScheduledPending ? formatLocal(nextScheduledPending.scheduled_for) : "None queued")}</div>
          </div>
        </div>
      </section>
    </div>

    <div class="bottom-grid">
      <section class="box">
        <div class="box-title">
          <h2>Priority Actions</h2>
          <div class="eyebrow">Top 3 Moves</div>
        </div>

        <div class="action-list">
          ${(queueInsights.actions.slice(0, 3).map((action) => `
            <div class="action-row ${escapeHtml(action.priority)}">
              <div class="action-top">
                <span class="pill ${escapeHtml(action.priority)}">${escapeHtml(action.priority.toUpperCase())}</span>
                <div class="action-title">${escapeHtml(action.title)}</div>
              </div>
              <div class="action-channel">${escapeHtml(action.channel || "Unknown channel")}</div>
              <div class="action-impact">${escapeHtml(action.impact)}</div>
              <div class="action-next">${escapeHtml(action.nextMove)}</div>
              <div class="action-command">${escapeHtml(action.command || "n/a")}</div>
            </div>
          `)).join("")}
        </div>
      </section>

      <section class="box">
        <div class="box-title">
          <h2>System Health</h2>
          <div class="eyebrow">Risk / Drift / Channels</div>
        </div>

        <div class="health-stack">
          <div class="mini-card">
            <strong>Channel Directory</strong>
            <div class="directory-list">
              ${
                channelDirectory.length === 0
                  ? `<div class="directory-row"><div class="directory-name">No channels detected</div></div>`
                  : channelDirectory.map((channel) => `
                      <div class="directory-row">
                        <div class="directory-name">${escapeHtml(channel.platform)} • ${escapeHtml(channel.account)}</div>
                        <div class="directory-stats">
                          Total ${escapeHtml(channel.total)} · Pending ${escapeHtml(channel.pending)} · Posted ${escapeHtml(channel.posted)} · Failed ${escapeHtml(channel.failed)}
                        </div>
                      </div>
                    `).join("")
              }
            </div>
          </div>

          <div class="mini-card">
            <strong>X Accounts</strong>
            ${accountStatuses.map((account) => `
              <div style="margin-bottom:8px;">
                ${escapeHtml(account.label)} ${escapeHtml(account.handle || "")} — ${escapeHtml(account.is_ready ? "ready" : "missing")}
                ${account.is_ready ? "" : `<br><span style="color:#fca5a5;">${escapeHtml(account.missing_env_vars.join(", "))}</span>`}
              </div>
            `).join("")}
          </div>

          <div class="mini-card">
            <strong>Duplicate Drift</strong>
            ${
              Object.keys(driftData.duplicate_attempts_by_platform || {}).length === 0
                ? "No duplicate drift recorded."
                : Object.entries(driftData.duplicate_attempts_by_platform || {})
                    .map(([platform, count]) => `${escapeHtml(platform)}: ${escapeHtml(count)}`)
                    .join("<br>")
            }
          </div>
        </div>
      </section>

      <section class="box">
        <div class="box-title">
          <h2>Published Feed</h2>
          <div class="eyebrow">Recent Output</div>
        </div>

        <div class="feed-list">
          ${
            recentPosted.length === 0
              ? `<div class="mini-card"><strong>Published Feed</strong>No posted items yet.</div>`
              : recentPosted.map((post) => `
                  <div class="feed-row">
                    <div class="feed-top">
                      <span class="tag platform">${escapeHtml(getQueuePlatformLabel(post))}</span>
                      <span class="tag account">${escapeHtml(getQueueAccountLabel(post))}</span>
                      <span class="tag posted">POSTED</span>
                    </div>
                    <div class="feed-copy">${escapeHtml(truncate(post.content, 105))}</div>
                    <div class="feed-time">${escapeHtml(formatLocal(post.posted_at || post.created_at))}</div>
                  </div>
                `).join("")
          }
        </div>

        <div class="footer">Generated ${escapeHtml(formatLocal(new Date().toISOString()))}</div>
      </section>
    </div>

    <div class="work-grid">
      <section class="box">
        <div class="box-title">
          <h2>Create New Run</h2>
          <div class="eyebrow">Build Input</div>
        </div>

        <form method="POST" action="/dashboard/run">
          <div class="label">Build Input</div>
          <textarea name="input" placeholder="Paste your Build Logger notes here..." required></textarea>

          <div class="label">Optional News Topic Override</div>
          <input type="text" name="topicOverride" placeholder="Leave blank to pull a real article automatically" />

          <div class="label">Default X Account for this Run</div>
          ${renderXAccountSelect("create-run-account", latest?.x_account_label || getDefaultXAccountLabel(), 'name="xAccountLabel"')}

          <div class="form-actions">
            <button class="btn-green" type="submit">Run Build Logger</button>
          </div>
        </form>
      </section>

      <section class="box">
        <div class="box-title">
          <h2>Latest Run</h2>
          <div class="eyebrow">Edit / Approve / Post</div>
        </div>

        ${
          latest
            ? `
          <div class="meta">
            <div><strong>ID:</strong> ${escapeHtml(latest.id || "")}</div>
            <div><strong>Created:</strong> ${escapeHtml(formatLocal(latest.created_at || ""))}</div>
            <div><strong>Approved:</strong> ${escapeHtml(formatLocal(latest.approved_at || ""))}</div>
            <div><strong>Posted:</strong> ${escapeHtml(formatLocal(latest.posted_at || ""))}</div>
            <div><strong>X Tweet ID:</strong> ${escapeHtml(latest.x_tweet_id || "n/a")}</div>
            <div><strong>X Account:</strong> ${escapeHtml(latest.x_account_label || "n/a")} ${escapeHtml(latest.x_account_handle || "")}</div>
            <div><strong>Persona:</strong> ${escapeHtml(latest.generated_twitter_persona || latest.persona || "n/a")}</div>
            <div><strong>Post Mode:</strong> ${escapeHtml(latest.post_mode || "n/a")}</div>
          </div>

          <div style="margin-bottom:10px;">
            <span class="status ${statusClass(latest.status)}">${escapeHtml(latest.status || "draft")}</span>
            <span class="status ${statusClass(latest.x_post_status === "sent" ? "posted" : "draft")}">
              X: ${escapeHtml(latest.x_post_status || "not_sent")}
            </span>
            ${hasAnyDrift(latest) ? `<span class="status status-failed">drift detected</span>` : ""}
          </div>

          <div class="label">Latest Run X Account</div>
          ${renderXAccountSelect(`x-account-${latest.id}`, latest.x_account_label)}
          <div class="btns" style="margin-bottom:10px;">
            <button class="btn-orange" type="button" onclick="saveXAccount('${latest.id}')">Save X Account</button>
          </div>

          <div class="metrics-line">
            <div class="metric-chip">Likes: ${escapeHtml(latestMetrics?.like_count || 0)}</div>
            <div class="metric-chip">Replies: ${escapeHtml(latestMetrics?.reply_count || 0)}</div>
            <div class="metric-chip">Reposts: ${escapeHtml(latestMetrics?.repost_count || 0)}</div>
            <div class="metric-chip">Quotes: ${escapeHtml(latestMetrics?.quote_count || 0)}</div>
            <div class="metric-chip">Impressions: ${escapeHtml(latestMetrics?.impression_count || 0)}</div>
            <div class="metric-chip">Account: ${escapeHtml(latestMetrics?.account_label || latest.x_account_label || "n/a")}</div>
            <div class="metric-chip">Persona: ${escapeHtml(latestMetrics?.persona || latest.generated_twitter_persona || "n/a")}</div>
          </div>

          <div class="label">Summary</div>
          <div class="value">${escapeHtml(latest.summary || "")}</div>

          <div class="btns" style="margin-bottom:10px;">
            <button class="approve" onclick="updateStatus('${latest.id}', 'approved')">Approve</button>
            <button class="draft" onclick="updateStatus('${latest.id}', 'draft')">Move to Draft</button>
            <button class="postx" onclick="postX('${latest.id}')">Post to X</button>
            <button class="btn-orange" onclick="syncXMetrics('${latest.id}')">Sync X Metrics</button>
            <button class="btn-orange" type="button" onclick="toggleEditor('${latest.id}')">Edit Latest Run</button>
            <a class="btn-link btn-blue" href="/runs/${latest.id}">Open Details</a>
          </div>

          <div id="editor-${latest.id}" style="display:none; margin-top:8px;">
            <div class="label">Edit Summary</div>
            <textarea id="summary-${latest.id}">${escapeHtml(latest.summary || "")}</textarea>

            <div class="label">Edit Slack</div>
            <textarea id="slack-${latest.id}">${escapeHtml(latest.slack_text || "")}</textarea>

            <div class="label">Edit LinkedIn</div>
            <textarea id="linkedin-${latest.id}">${escapeHtml(latest.linkedin_text || "")}</textarea>

            <div class="label">Edit Twitter</div>
            <textarea id="twitter-${latest.id}">${escapeHtml(latest.twitter_text || "")}</textarea>

            <div class="label">Edit TikTok Script</div>
            <textarea id="tiktok-script-${latest.id}">${escapeHtml(latest.tiktok_script || "")}</textarea>

            <div class="label">Edit TikTok Caption</div>
            <textarea id="tiktok-caption-${latest.id}">${escapeHtml(latest.tiktok_caption || "")}</textarea>

            <div class="btns">
              <button class="btn-green" type="button" onclick="saveEdits('${latest.id}')">Save Edits</button>
            </div>
          </div>
        `
            : `<div class="muted">No runs found yet.</div>`
        }
      </section>
    </div>

    <div class="ai-grid">
      <section class="box">
        <div class="box-title">
          <h2>Ask AI</h2>
          <div class="eyebrow">Ask About Your Posts</div>
        </div>

        <div class="label">Question</div>
        <textarea id="ask-ai-question" placeholder="Example: What were my last week of posts mostly about? Which posts performed best?"></textarea>

        <div class="btns">
          <button class="btn-blue" onclick="askAI()">Ask AI</button>
        </div>

        <div class="label">Answer</div>
        <div id="ask-ai-answer" class="ai-answer">No answer yet.</div>
      </section>

      <section class="box">
        <div class="box-title">
          <h2>Weekly Rundown</h2>
          <div class="eyebrow">7-Day Analysis</div>
        </div>

        <div class="subcopy" style="margin-bottom:12px;">
          Pulls the last 7 days of runs and any synced X metrics, then gives you a plain-English rundown of themes, winners, weak spots, and what to do next.
        </div>

        <div class="btns">
          <button class="btn-green" onclick="runWeeklyRundown()">Run Weekly Rundown</button>
        </div>

        <div class="label">Weekly Output</div>
        <div id="weekly-rundown-answer" class="ai-answer">No weekly rundown yet.</div>
      </section>
    </div>

    <section class="box">
      <div class="box-title">
        <h2>Queue Review</h2>
        <div class="eyebrow">Investigate / Override / Archive</div>
      </div>

      ${
        queue.length === 0
          ? `<div class="muted">Queue is empty.</div>`
          : `
        <div class="history-grid">
          ${queue.map((item) => {
            const reviewClass =
              item.review_status === "investigating"
                ? "status-investigating"
                : item.review_status === "archived"
                ? "status-archived"
                : "status-draft";

            return `
              <div class="queue-item">
                <div class="meta">
                  <div><strong>ID:</strong> ${escapeHtml(item.id || "")}</div>
                  <div><strong>Channel:</strong> ${escapeHtml(getQueueChannelLabel(item))}</div>
                  <div><strong>Created:</strong> ${escapeHtml(formatLocal(item.created_at || ""))}</div>
                  <div><strong>Scheduled:</strong> ${escapeHtml(formatLocal(item.scheduled_for || ""))}</div>
                </div>

                <div style="margin-bottom:8px;">
                  <span class="status ${statusClass(item.status)}">${escapeHtml(item.status || "pending")}</span>
                  <span class="status ${reviewClass}">${escapeHtml(item.review_status || "none")}</span>
                </div>

                <div class="label">Content</div>
                <div class="value">${escapeHtml(item.content || "")}</div>

                <div class="label">AI Review</div>
                <div class="value">${escapeHtml(item.risk_summary || "No AI review yet.")}</div>

                <div class="label">Recommended Action</div>
                <div class="value">${escapeHtml(item.recommended_action || "None")}</div>

                <div class="btns">
                  <button class="btn-orange" onclick="investigateQueueItem('${item.id}')">Investigate</button>
                  <button class="approve" onclick="postAnywayQueueItem('${item.id}')">Post Anyway</button>
                  <button class="draft" onclick="archiveQueueItem('${item.id}')">Archive</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `
      }
    </section>

    <section class="box">
      <div class="box-title">
        <h2>Run History</h2>
        <div class="eyebrow">Recent Sessions</div>
      </div>

      <div class="filters" style="margin-bottom:12px;">
        <a class="btn-link btn-gray" href="/?status=">All</a>
        <a class="btn-link btn-gray" href="/?status=draft">Draft</a>
        <a class="btn-link btn-gray" href="/?status=approved">Approved</a>
        <a class="btn-link btn-gray" href="/?status=posted">Posted</a>
        <a class="btn-link btn-gray" href="/?status=failed">Failed</a>
      </div>

      <div class="history-grid">
        ${rows.map((run) => {
          const runMetrics = metricsStore[run.id] || null;
          return `
          <div class="run-card">
            <div class="meta">
              <div><strong>ID:</strong> ${escapeHtml(run.id || "")}</div>
              <div><strong>Created:</strong> ${escapeHtml(formatLocal(run.created_at || ""))}</div>
              <div><strong>Posted:</strong> ${escapeHtml(formatLocal(run.posted_at || ""))}</div>
              <div><strong>X Account:</strong> ${escapeHtml(run.x_account_label || "n/a")} ${escapeHtml(run.x_account_handle || "")}</div>
              <div><strong>Persona:</strong> ${escapeHtml(run.generated_twitter_persona || run.persona || "n/a")}</div>
            </div>

            <div style="margin-bottom:8px;">
              <span class="status ${statusClass(run.status)}">${escapeHtml(run.status || "draft")}</span>
              <span class="status ${statusClass(run.x_post_status === "sent" ? "posted" : "draft")}">
                X: ${escapeHtml(run.x_post_status || "not_sent")}
              </span>
              ${hasAnyDrift(run) ? `<span class="status status-failed">drift detected</span>` : ""}
            </div>

            <div class="label">Run X Account</div>
            ${renderXAccountSelect(`x-account-${run.id}`, run.x_account_label)}
            <div class="btns" style="margin-bottom:8px;">
              <button class="btn-orange" onclick="saveXAccount('${run.id}')">Save X Account</button>
            </div>

            <div class="metrics-line">
              <div class="metric-chip">Likes: ${escapeHtml(runMetrics?.like_count || 0)}</div>
              <div class="metric-chip">Replies: ${escapeHtml(runMetrics?.reply_count || 0)}</div>
              <div class="metric-chip">Reposts: ${escapeHtml(runMetrics?.repost_count || 0)}</div>
              <div class="metric-chip">Account: ${escapeHtml(runMetrics?.account_label || run.x_account_label || "n/a")}</div>
              <div class="metric-chip">Persona: ${escapeHtml(runMetrics?.persona || run.generated_twitter_persona || "n/a")}</div>
            </div>

            <div class="label">Summary</div>
            <div class="value">${escapeHtml(run.summary || "")}</div>

            <div class="btns">
              <button class="approve" onclick="updateStatus('${run.id}', 'approved')">Approve</button>
              <button class="draft" onclick="updateStatus('${run.id}', 'draft')">Move to Draft</button>
              <button class="postx" onclick="postX('${run.id}')">Post to X</button>
              <button class="btn-orange" onclick="syncXMetrics('${run.id}')">Sync X Metrics</button>
              <a class="btn-link btn-blue" href="/runs/${run.id}">Open Details</a>
            </div>
          </div>
        `;
        }).join("")}
      </div>
    </section>

  </div>

  <script>
    function getSelectedAccount(id) {
      return document.getElementById('x-account-' + id)?.value || '';
    }

    async function saveXAccount(id) {
      const account_label = getSelectedAccount(id);

      const res = await fetch('/api/runs/' + id + '/x-account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_label })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to save X account');
        return;
      }

      window.location.reload();
    }

    async function updateStatus(id, status) {
      const res = await fetch('/api/runs/' + id + '/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to update status');
        return;
      }

      window.location.reload();
    }

    async function postX(id) {
      const account_label = getSelectedAccount(id);

      const res = await fetch('/api/runs/' + id + '/post-x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_label })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to post to X');
        return;
      }

      window.location.reload();
    }

    async function syncXMetrics(id) {
      const account_label = getSelectedAccount(id);

      const res = await fetch('/api/runs/' + id + '/sync-x-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_label })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to sync X metrics');
        return;
      }

      alert('X metrics synced');
      window.location.reload();
    }

    function toggleEditor(id) {
      const editor = document.getElementById('editor-' + id);
      if (!editor) return;
      editor.style.display = (editor.style.display === 'none' || editor.style.display === '') ? 'block' : 'none';
    }

    async function saveEdits(id) {
      const payload = {
        summary: document.getElementById('summary-' + id)?.value || '',
        slack_text: document.getElementById('slack-' + id)?.value || '',
        linkedin_text: document.getElementById('linkedin-' + id)?.value || '',
        twitter_text: document.getElementById('twitter-' + id)?.value || '',
        tiktok_script: document.getElementById('tiktok-script-' + id)?.value || '',
        tiktok_caption: document.getElementById('tiktok-caption-' + id)?.value || '',
      };

      const res = await fetch('/api/runs/' + id + '/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.details || data.error || 'Failed to save edits');
        return;
      }

      window.location.reload();
    }

    async function clearQueue() {
      const ok = confirm('Clear the entire queue and archive everything?');
      if (!ok) return;

      const res = await fetch('/api/queue/clear', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        alert(data.details || data.error || 'Failed to clear queue');
        return;
      }

      window.location.reload();
    }

    async function archiveQueueItem(id) {
      const res = await fetch('/api/queue/' + id + '/archive', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        alert(data.details || data.error || 'Failed to archive queue item');
        return;
      }

      window.location.reload();
    }

    async function investigateQueueItem(id) {
      const res = await fetch('/api/queue/' + id + '/investigate', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        alert(data.details || data.error || 'Failed to investigate queue item');
        return;
      }

      alert(data.ai_summary || 'Investigation complete.');
      window.location.reload();
    }

    async function postAnywayQueueItem(id) {
      const res = await fetch('/api/queue/' + id + '/post-anyway', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        alert(data.details || data.error || 'Failed to override queue item');
        return;
      }

      window.location.reload();
    }

    async function askAI() {
      const question = document.getElementById('ask-ai-question')?.value || '';
      const answerBox = document.getElementById('ask-ai-answer');

      answerBox.textContent = 'Thinking...';

      const res = await fetch('/api/ai/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question })
      });

      const data = await res.json();

      if (!res.ok) {
        answerBox.textContent = data.details || data.error || 'Ask AI failed';
        return;
      }

      answerBox.textContent = data.answer || 'No answer returned.';
    }

    async function runWeeklyRundown() {
      const answerBox = document.getElementById('weekly-rundown-answer');
      answerBox.textContent = 'Running weekly rundown...';

      const res = await fetch('/api/ai/weekly-rundown', {
        method: 'POST'
      });

      const data = await res.json();

      if (!res.ok) {
        answerBox.textContent = data.details || data.error || 'Weekly rundown failed';
        return;
      }

      answerBox.textContent = data.answer || 'No weekly rundown returned.';
    }
  </script>
</body>
</html>
    `;

    return res.send(html);
  } catch (err) {
    return res.status(500).send(`
      <h1>Dashboard Error</h1>
      <pre>${escapeHtml(err.message)}</pre>
    `);
  }
});

app.get("/api/runs", async (req, res) => {
  try {
    let query = supabase
      .from("build_logger_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (req.query.status) {
      query = query.eq("status", req.query.status);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch runs",
        details: error.message,
      });
    }

    return res.json(attachRunAccountMetadataList(data || []));
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

app.get("/api/runs/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("build_logger_runs")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch run",
        details: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({ error: "Run not found" });
    }

    return res.json(attachRunAccountMetadata(data));
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

// =======================
// FIXED BROKEN ROUTES
// =======================

app.post("/api/runs/:id/edit", async (req, res) => {
  try {
    const id = req.params.id;

    const {
      summary,
      slack_text,
      linkedin_text,
      twitter_text,
      tiktok_script,
      tiktok_caption,
    } = req.body;

    const { data: existingRun, error: fetchError } = await supabase
      .from("build_logger_runs")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({
        error: "Failed to fetch run before edit",
        details: fetchError.message,
      });
    }

    if (!existingRun) {
      return res.status(404).json({
        error: "Run not found",
      });
    }

    const nextSummary =
      summary !== undefined ? String(summary) : existingRun.summary || "";
    const nextSlack =
      slack_text !== undefined ? String(slack_text) : existingRun.slack_text || "";
    const nextLinkedin =
      linkedin_text !== undefined
        ? String(linkedin_text)
        : existingRun.linkedin_text || "";
    const nextTwitter =
      twitter_text !== undefined
        ? String(twitter_text)
        : existingRun.twitter_text || "";
    const nextTikTokScript =
      tiktok_script !== undefined
        ? String(tiktok_script)
        : existingRun.tiktok_script || "";
    const nextTikTokCaption =
      tiktok_caption !== undefined
        ? String(tiktok_caption)
        : existingRun.tiktok_caption || "";

    const updatePayload = {
      summary: nextSummary,
      slack_text: nextSlack,
      linkedin_text: nextLinkedin,
      twitter_text: nextTwitter,
      tiktok_script: nextTikTokScript,
      tiktok_caption: nextTikTokCaption,

      drift_summary:
        normalizeForDrift(nextSummary) !==
        normalizeForDrift(existingRun.generated_summary),
      drift_slack:
        normalizeForDrift(nextSlack) !==
        normalizeForDrift(existingRun.generated_slack_text),
      drift_linkedin:
        normalizeForDrift(nextLinkedin) !==
        normalizeForDrift(existingRun.generated_linkedin_text),
      drift_twitter:
        normalizeForDrift(nextTwitter) !==
        normalizeForDrift(existingRun.generated_twitter_text),
      drift_tiktok_script:
        normalizeForDrift(nextTikTokScript) !==
        normalizeForDrift(existingRun.generated_tiktok_script),
      drift_tiktok_caption:
        normalizeForDrift(nextTikTokCaption) !==
        normalizeForDrift(existingRun.generated_tiktok_caption),
    };

    const { data: updatedRun, error: updateError } = await supabase
      .from("build_logger_runs")
      .update(updatePayload)
      .eq("id", id)
      .select()
      .maybeSingle();

    if (updateError) {
      return res.status(500).json({
        error: "Failed to save edits",
        details: updateError.message,
      });
    }

    return res.json({
      message: "Run updated",
      run: attachRunAccountMetadata(updatedRun),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

app.post("/api/run", async (req, res) => {
  try {
    const input = String(req.body.input || "").trim();
    const topicOverride = String(req.body.topicOverride || "").trim();
    const xAccountLabel = safeTrim(req.body.xAccountLabel);

    if (!input) {
      return res.status(400).json({ error: "Missing input" });
    }

    const run = await createRunFromInput(input, topicOverride, xAccountLabel);

    return res.json({
      message: "Run completed and saved",
      run,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

app.post("/dashboard/run", async (req, res) => {
  try {
    const input = String(req.body.input || "").trim();
    const topicOverride = String(req.body.topicOverride || "").trim();
    const xAccountLabel = safeTrim(req.body.xAccountLabel);

    if (!input) {
      return res
        .status(400)
        .send("<h1>Missing input</h1><p>Go back and enter build notes.</p>");
    }

    await createRunFromInput(input, topicOverride, xAccountLabel);
    return res.redirect("/");
  } catch (err) {
    return res.status(500).send(`
      <h1>Run failed</h1>
      <pre>${escapeHtml(err.message)}</pre>
      <p><a href="/">Go back</a></p>
    `);
  }
});

app.patch("/api/runs/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["draft", "approved", "posted", "failed"];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: "Invalid status",
        allowed,
      });
    }

    const updatePayload = { status };

    if (status === "approved") {
      updatePayload.approved_at = new Date().toISOString();
    }

    if (status === "posted") {
      updatePayload.posted_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from("build_logger_runs")
      .update(updatePayload)
      .eq("id", req.params.id)
      .select()
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: "Failed to update status",
        details: error.message,
      });
    }

    if (!data) {
      return res.status(404).json({ error: "Run not found" });
    }

    return res.json({
      message: "Status updated",
      run: attachRunAccountMetadata(data),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

app.post("/api/runs/:id/post-x", async (req, res) => {
  try {
    const { data: run, error: fetchError } = await supabase
      .from("build_logger_runs")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (fetchError) {
      return res.status(500).json({
        error: "Failed to fetch run",
        details: fetchError.message,
      });
    }

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    try {
      const accountLabel = safeTrim(req.body.account_label);
      const result = await postRunToX(run, { accountLabel });

      return res.json({
        message: "Posted to X successfully",
        tweet: result.tweet,
        account: result.account,
        run: result.run,
      });
    } catch (postErr) {
      await supabase
        .from("build_logger_runs")
        .update({
          x_post_status: "failed",
          error_message: postErr.message,
        })
        .eq("id", req.params.id);

      return res.status(500).json({
        error: "Failed to post to X",
        details: postErr.message,
      });
    }
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

// =======================
// STARTUP
// =======================

ensureQueueFiles();
ensureAccountsFile();

if (ENABLE_LOCAL_CRON) {
  cron.schedule("*/5 * * * *", () => {
    console.log(`[cron] heartbeat ${new Date().toISOString()}`);
  });
  console.log("Local cron enabled");
} else {
  console.log("Local cron disabled");
}

app.listen(PORT, () => {
  console.log(`Build Logger API running on port ${PORT}`);
});
