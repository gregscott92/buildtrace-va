const { analyzeCfr38 } = require("./lib/cfr38-engine");

const multer = require("multer");
const upload = multer({ dest: "uploads/" });

require("dotenv").config();

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const { TwitterApi } = require("twitter-api-v2");
const cron = require("node-cron");
const axios = require("axios");

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const app = express();   // ✅ ONLY ONE TIME

// ----------------------------
// MIDDLEWARE
// ----------------------------
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ----------------------------
// ROUTES (SAFE TO USE app NOW)
// ----------------------------
app.get("/", (req, res) => {
  return res.redirect("/signup");
});
app.get("/dashboard", (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect("/login");
  }
  return res.sendFile(path.join(__dirname, "views", "dashboard.html"));
});

const { runFivePassPipeline } = require("./lib/ai-pipeline");
const { finalizePost, choosePersona } = require("./lib/persona");
const { upsertXMetric } = require("./lib/metrics");
const { dollarsFromTokens, summarizeUsage } = require("./lib/costs");
const { getSpendSummary, assertBudgetAvailable } = require("./lib/budget-guard");
const { execSync } = require("child_process");
const {
  vaCombineRatings,
  estimateCrsc,
  buildVaOutcomePrompt,
  extractSection,
} = require("./lib/va-helpers");

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

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

const supabaseAuth =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY
      )
    : null;

// BASIC HELPERS
// STARTUP
// =====================// =======================// =======================
// SIMPLE PASSWORD LOCK
// =======================

const APP_PASSWORD = process.env.APP_PASSWORD || "changeme";
const AUTH_COOKIE_NAME = "buildtrace_auth";

function parseCookies(req) {
  const header = req.headers.cookie || "";
  return header.split(";").reduce((acc, part) => {
    const pieces = part.split("=");
    const rawKey = pieces.shift();
    const key = String(rawKey || "").trim();
    if (!key) return acc;
    acc[key] = decodeURIComponent(pieces.join("=") || "");
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
    AUTH_COOKIE_NAME +
      "=" +
      encodeURIComponent(APP_PASSWORD) +
      "; HttpOnly; Path=/; SameSite=Lax" +
      (isProd ? "; Secure" : "")
  );
}

function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    AUTH_COOKIE_NAME +
      "=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax" +
      (isProd ? "; Secure" : "")
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


async function getSupabaseUserFromRequest(req) {
  try {
    const authHeader = String(req.headers.authorization || "");
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      return { user: null, error: "Missing bearer token" };
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return { user: null, error: "Invalid token" };
    }

    const user = await response.json();
    return { user, error: null };
  } catch (err) {
    return { user: null, error: err.message };
  }
}

async function requireApiUser(req, res, next) {
  const { user, error } = await getSupabaseUserFromRequest(req);

  if (!user) {
    return res.status(401).json({
      error: "Unauthorized",
      details: error || "Login required",
    });
  }

  req.apiUser = user;
  next();
}

// DISABLED OLD LOGIN
function renderLoginPage(message) {
  const safeMessage = escapeHtml(message || "");

  return [
    "<html>",
    "<head>",
    "<title>BuildTrace Login</title>",
    "<style>",
    "body {",
    "  background: #0b0f19;",
    "  color: #fff;",
    "  display: flex;",
    "  justify-content: center;",
    "  align-items: center;",
    "  height: 100vh;",
    "  font-family: Arial, sans-serif;",
    "  margin: 0;",
    "}",
    ".box {",
    "  background: #111827;",
    "  padding: 30px;",
    "  border-radius: 12px;",
    "  text-align: center;",
    "  width: 320px;",
    "  box-shadow: 0 10px 30px rgba(0,0,0,.35);",
    "}",
    "input {",
    "  padding: 10px;",
    "  margin-top: 10px;",
    "  width: 100%;",
    "  box-sizing: border-box;",
    "  border-radius: 8px;",
    "  border: 1px solid #374151;",
    "  background: #0b1220;",
    "  color: white;",
    "}",
    "button {",
    "  margin-top: 12px;",
    "  padding: 10px;",
    "  width: 100%;",
    "  background: #2563eb;",
    "  color: white;",
    "  border: none;",
    "  border-radius: 8px;",
    "  cursor: pointer;",
    "  font-weight: bold;",
    "}",
    ".msg {",
    "  color: #fca5a5;",
    "  min-height: 18px;",
    "  margin-top: 10px;",
    "  font-size: 14px;",
    "}",
    "</style>",
    "</head>",
    "<body>",
    '<div class="box">',
    "<h2>BuildTrace</h2>",
    "<p>Enter password</p>",
    '<form method="POST" action="/login">',
    '<input type="password" name="password" placeholder="Password" required />',
    '<button type="submit">Enter</button>',
    "</form>",
    '<div class="msg">' + safeMessage + "</div>",
    "</div>",
    "</body>",
    "</html>"
  ].join("\n");
}

function checkAuth(req, res, next) {
  if (isAuthenticated(req)) {
    return next();
  }

  const apiPassword = String(req.headers["x-app-password"] || "").trim();

  if (apiPassword && apiPassword === APP_PASSWORD) {
    return next();
  }

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return next(); // old password lock disabled
}

// =======================

// PUBLIC ROUTES
// =======================

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "build-logger-api" });
});

app.get("/login", (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
        user: null
      });
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message,
        user: null
      });
    }

    return res.json({
      success: true,
      error: null,
      user: {
        id: data?.user?.id ?? data?.session?.user?.id ?? null,
        email: data?.user?.email ?? data?.session?.user?.email ?? null
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Server error",
      user: null
    });
  }
});

app.post("/logout", (req, res) => {
  clearAuthCookie(res);
  return res.json({ success: true });
});

// everything except login/health is protected
app.use((req, res, next) => {
  if (req.path.startsWith("/login") || req.path === "/health") {
    return next();
  }

  return checkAuth(req, res, next);
});

// =======================
// BASIC HELPERS
// =======================
async function logApiUsage({
  feature,
  model,
  organizationId = null,
  userId = null,
  requestId = null,
  inputTokens = 0,
  outputTokens = 0,
  cachedInputTokens = 0,
  estimatedCostUsd = 0,
  status = "success",
  errorMessage = null,
  meta = {},
}) {
  try {
    const { error } = await supabase.from("api_usage_logs").insert({
      feature,
      provider: "openai",
      model,
      request_id: requestId,
      user_id: userId,
      organization_id: organizationId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_input_tokens: cachedInputTokens,
      estimated_cost_usd: estimatedCostUsd,
      status,
      error_message: errorMessage,
      meta,
    });

    if (error) {
      console.log("logApiUsage insert error:", error.message);
    }
  } catch (err) {
    console.log("logApiUsage failed:", err.message);
  }
}

async function runTrackedChatCompletion({
  feature,
  model,
  messages,
  temperature = 0.3,
  max_tokens,
  organizationId = null,
  userId = null,
  meta = {},
}) {
  await assertBudgetAvailable({
    supabase,
    organizationId,
    feature,
  });

  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      temperature,
      ...(max_tokens ? { max_tokens } : {}),
    });

    const usageSummary = summarizeUsage(response.usage || {});
    const estimatedCostUsd = dollarsFromTokens({
      model,
      inputTokens: usageSummary.inputTokens,
      cachedInputTokens: usageSummary.cachedInputTokens,
      outputTokens: usageSummary.outputTokens,
    });

    await logApiUsage({
      feature,
      model,
      organizationId,
      userId,
      requestId: response.id || null,
      inputTokens: usageSummary.inputTokens,
      outputTokens: usageSummary.outputTokens,
      cachedInputTokens: usageSummary.cachedInputTokens,
      estimatedCostUsd,
      status: "success",
      meta,
    });

    return {
      response,
      usage: {
        ...usageSummary,
        estimatedCostUsd,
      },
    };
  } catch (err) {
    await logApiUsage({
      feature,
      model,
      organizationId,
      userId,
      estimatedCostUsd: 0,
      status: "error",
      errorMessage: err.message,
      meta,
    });

    throw err;
  }
}

function getRequestOrgId(req) {
  return (
    safeTrim(req.body?.organization_id) ||
    safeTrim(req.query?.organization_id) ||
    safeTrim(req.headers["x-organization-id"]) ||
    safeTrim(process.env.DEFAULT_ORGANIZATION_ID) ||
    null
  );
}
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
function safeJson(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function buildVaEntryInsert(payload = {}) {
  return {
    title: safeTrim(payload.title) || "Untitled VA Entry",
    topic: safeTrim(payload.topic) || "general",
    source_type: safeTrim(payload.source_type) || "manual",
    source_name: safeTrim(payload.source_name) || "manual entry",
    source_url: safeTrim(payload.source_url) || null,
    raw_text: String(payload.raw_text || "").trim(),
    summary: payload.summary ? String(payload.summary).trim() : null,
    extracted_text: payload.extracted_text ? String(payload.extracted_text).trim() : null,
    ai_summary: payload.ai_summary ? String(payload.ai_summary).trim() : null,
    likely_rating_range: payload.likely_rating_range
      ? String(payload.likely_rating_range).trim()
      : null,
    strengths: Array.isArray(payload.strengths)
      ? payload.strengths
      : safeJson(payload.strengths, []),
    weaknesses: Array.isArray(payload.weaknesses)
      ? payload.weaknesses
      : safeJson(payload.weaknesses, []),
    next_steps: Array.isArray(payload.next_steps)
      ? payload.next_steps
      : safeJson(payload.next_steps, []),
    meta: typeof payload.meta === "object" && payload.meta !== null ? payload.meta : {},
  };
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
    throw new Error(`X account "${accountLabel}" not found || inactive.`);
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
      throw new Error(
        `Requested X account "${requested}" was not found || is inactive.`
      );
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
    if (Number.isNaN(scheduled.getTime()) || Number.isNaN(postedAt.getTime())) {
      return false;
    }
    return postedAt < scheduled;
  });

  const actions = [];

  if (readyNow.length > 0) {
    actions.push({
      priority: "high",
      title: "Queue ready now",
      channel: summarizeAffectedChannels(readyNow),
      impact: String(readyNow.length) + " post(s) can publish immediately.",
      nextMove: "Run scheduler now.",
      command: "node scheduler.js",
    });
  }

  if (failed.length > 0) {
    actions.push({
      priority: "high",
      title: "Failures need review",
      channel: summarizeAffectedChannels(failed),
      impact: String(failed.length) + " failed post(s) need intervention.",
      nextMove: "Inspect queue errors && decide retry/remove.",
      command: "type queue\\posts.json",
    });
  }

  if (investigating.length > 0) {
    actions.push({
      priority: "medium",
      title: "Items under investigation",
      channel: summarizeAffectedChannels(investigating),
      impact: String(investigating.length) + " item(s) were moved into review.",
      nextMove: "Read AI reasoning && decide archive || post anyway.",
      command: "http://localhost:3000",
    });
  }

  if ((drift?.duplicate_attempts_total || 0) > 0) {
    actions.push({
      priority: "medium",
      title: "Duplicate drift detected",
      channel: "Cross-channel behavior",
      impact: String(drift.duplicate_attempts_total) + " duplicate attempts were caught.",
      nextMove: "Review repeated trigger behavior.",
      command: "type queue\\drift.json",
    });
  }

  if (suspiciousPosts.length > 0) {
    actions.push({
      priority: "high",
      title: "Timing drift detected",
      channel: summarizeAffectedChannels(suspiciousPosts),
      impact: String(suspiciousPosts.length) + " post(s) were published before schedule.",
      nextMove: "Validate scheduler timing logic.",
      command: "type queue\\posts.json",
    });
  }

  if (dueSoon.length > 0) {
    actions.push({
      priority: "low",
      title: "Posts due soon",
      channel: summarizeAffectedChannels(dueSoon),
      impact: String(dueSoon.length) + " post(s) are due within 60 minutes.",
      nextMove: "Keep scheduler active && watch the next publish window.",
      command: "node scheduler.js",
    });
  }

  if (actions.length === 0) {
    actions.push({
      priority: "low",
      title: "Stable state",
      channel: "All channels",
      impact: "System is operating normally.",
      nextMove: "Keep scheduler alive && generate the next batch when ready.",
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
// AI USAGE SCORE MVP
// =======================

function clampScore(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function calculateAiUsageScore(runs, metricsStore = {}) {
  const allRuns = Array.isArray(runs) ? runs : [];
  const recentRuns = allRuns.slice(0, 30);

  const totalRuns = recentRuns.length;
  const approvedRuns = recentRuns.filter(
    (r) => r.status === "approved" || r.status === "posted"
  ).length;
  const postedRuns = recentRuns.filter((r) => r.status === "posted").length;
  const editedRuns = recentRuns.filter((r) => hasAnyDrift(r)).length;
  const withPersona = recentRuns.filter(
    (r) => r.generated_twitter_persona || r.generated_linkedin_persona || r.persona
  ).length;
  const withLearningNotes = recentRuns.filter((r) => safeTrim(r.learning_notes)).length;
  const withRecommendedPersona = recentRuns.filter(
    (r) => safeTrim(r.recommended_persona)
  ).length;
  const withNextAction = recentRuns.filter((r) => safeTrim(r.next_action_text)).length;
  const withImpact = recentRuns.filter((r) => safeTrim(r.impact_text)).length;
  const withOutcome = recentRuns.filter((r) => safeTrim(r.outcome_text)).length;
  const withProgressState = recentRuns.filter(
    (r) => safeTrim(r.progress_state_text)
  ).length;

  const metricsList = recentRuns.map((r) => metricsStore[r.id]).filter(Boolean);

  const totalImpressions = metricsList.reduce(
    (sum, item) => sum + Number(item.impression_count || 0),
    0
  );

  const avgImpressions =
    metricsList.length > 0 ? Math.round(totalImpressions / metricsList.length) : 0;

  const activityScore = totalRuns >= 10 ? 25 : Math.round((totalRuns / 10) * 25);
  const shippingScore =
    totalRuns > 0 ? Math.round((postedRuns / totalRuns) * 25) : 0;

  const structureScoreRaw =
    (withImpact > 0 ? 5 : 0) +
    (withOutcome > 0 ? 5 : 0) +
    (withProgressState > 0 ? 5 : 0) +
    (withNextAction > 0 ? 5 : 0) +
    (withPersona > 0 ? 5 : 0);
  const structureScore = clampScore(structureScoreRaw, 0, 25);

  let optimizationScore = 0;
  if (editedRuns > 0) optimizationScore += 8;
  if (withLearningNotes > 0) optimizationScore += 6;
  if (withRecommendedPersona > 0) optimizationScore += 4;
  if (avgImpressions >= 100) optimizationScore += 7;
  optimizationScore = clampScore(optimizationScore, 0, 25);

  const score = clampScore(
    activityScore + shippingScore + structureScore + optimizationScore,
    0,
    100
  );

  let grade = "D";
  if (score >= 90) grade = "A";
  else if (score >= 80) grade = "B";
  else if (score >= 70) grade = "C";

  let label = "Early";
  if (score >= 80) label = "Strong";
  else if (score >= 60) label = "Building";

  return {
    score,
    grade,
    label,
    factors: {
      total_runs: totalRuns,
      approved_runs: approvedRuns,
      posted_runs: postedRuns,
      edited_runs: editedRuns,
      runs_with_persona: withPersona,
      runs_with_learning_notes: withLearningNotes,
      runs_with_recommended_persona: withRecommendedPersona,
      runs_with_next_action: withNextAction,
      avg_impressions: avgImpressions,
      total_impressions: totalImpressions,
    },
    breakdown: {
      activity_score: activityScore,
      shipping_score: shippingScore,
      structure_score: structureScore,
      optimization_score: optimizationScore,
    },
  };
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
- urgent && sharp
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
   // throw new Error("Missing NEWS_API_KEY in .env");
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
        `News query failed for ${query || "(no query)"}: ${err.message}`
      );
    }
  }

  throw new Error("No usable news article returned from NewsAPI");
}
async function generateTikTokLane(newsItem, options = {}) {
  const prompt = buildTikTokPrompt(newsItem);
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const tracked = await runTrackedChatCompletion({
    feature: "buildtrace_tiktok_lane",
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.4,
    organizationId: options.organizationId || null,
    userId: options.userId || null,
    meta: {
      sourceName: newsItem.sourceName || "",
      title: newsItem.title || "",
    },
  });

  const output = tracked.response.choices[0]?.message?.content ?? "";

  return {
    tiktokScript: extract(output, "TIKTOK SCRIPT"),
    tiktokCaption: extract(output, "TIKTOK CAPTION"),
    rawTikTokResponse: output,
    usage: tracked.usage,
  };
}
// =======================
// AI Q&A
// =======================
async function askAIAboutRuns(question, runs, metricsStore) {
  const compactRuns = (runs || []).slice(0, 15).map((run) => ({
    id: run.id,
    created_at: run.created_at,
    status: run.status,
    approved_at: run.approved_at,
    posted_at: run.posted_at,
    summary: run.summary,
    twitter_text: run.twitter_text,
    linkedin_text: run.linkedin_text,
    slack_text: run.slack_text,
    persona:
      run.generated_twitter_persona ||
      run.generated_linkedin_persona ||
      run.persona ||
      null,
    post_mode: run.post_mode || null,
    x_account_label: run.x_account_label || null,
    drift_summary: run.drift_summary,
    drift_slack: run.drift_slack,
    drift_linkedin: run.drift_linkedin,
    drift_twitter: run.drift_twitter,
  }));

  const compactMetrics = Object.entries(metricsStore || {})
    .slice(0, 15)
    .map(([runId, metric]) => ({
      run_id: runId,
      impression_count: metric?.impression_count || 0,
      like_count: metric?.like_count || 0,
      reply_count: metric?.reply_count || 0,
      repost_count: metric?.repost_count || 0,
      quote_count: metric?.quote_count || 0,
      account_label: metric?.account_label || null,
      persona: metric?.persona || null,
    }));

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

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const tracked = await runTrackedChatCompletion({
    feature: "buildtrace_ai_ask",
    model,
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3,
    organizationId: options.organizationId || null,
    userId: options.userId || null,
    meta: {
      question,
      runCount: Array.isArray(runs) ? runs.length : 0,
    },
  });

  return tracked.response.choices[0]?.message?.content?.trim() || "No answer returned.";
}
// =======================
// RUN CREATION
// =======================

async function createRunFromInput(
  input,
  topicOverride = "",
  xAccountLabel = "",
  options = {}
) {
let newsItem;

if (topicOverride && topicOverride.trim()) {
  newsItem = {
    sourceName: "Manual Override",
    title: topicOverride.trim(),
    url: "",
    description: topicOverride.trim(),
    publishedAt: new Date().toISOString(),
  };
} else {
  newsItem = await getRealNewsItem();
}
  const pipeline = await runFivePassPipeline(input, {
    linkedinGoal: "thought_leadership",
    twitterGoal: "engagement",
    slackGoal: "build_log",
  });

  const summary =
    String(pipeline.outputs?.summary || "").trim() ||
    "Build content generated. Review edits before posting.";

  const linkedinFinal = pipeline.outputs?.linkedin || {
    finalText: "",
    persona: choosePersona({
      platform: "linkedin",
      goal: "thought_leadership",
    }),
    postMode: "thought_leadership",
  };

  const twitterFinal = pipeline.outputs?.twitter || {
    finalText: "",
    persona: choosePersona({
      platform: "twitter",
      goal: "engagement",
    }),
    postMode: "engagement",
  };

  const slackFinal = pipeline.outputs?.slack || {
    finalText: "",
    persona: choosePersona({
      platform: "slack",
      goal: "build_log",
    }),
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

  const tiktokLane = await generateTikTokLane(newsItem, {
    organizationId: options.organizationId || null,
    userId: options.userId || null,
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

    tiktok_topic: newsItem.title,
    tiktok_script: tiktokLane.tiktokScript || "",
    tiktok_caption: tiktokLane.tiktokCaption || "",

    news_source_name: newsItem.sourceName,
    news_source_title: newsItem.title,
    news_source_url: newsItem.url,
    news_published_at: newsItem.publishedAt || null,

    raw_response: JSON.stringify(
      {
        build_pipeline: pipeline.raw,
        tiktok_raw_response: tiktokLane.rawTikTokResponse || "",
        tiktok_usage: tiktokLane.usage || null,
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
3. whether the best action is archive, investigate, || post anyway

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
// AI SCORE ROUTES
// =======================

app.get("/api/ai/score", async (req, res) => {
  try {
    const { data: runs, error } = await supabase
      .from("build_logger_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch runs for AI score",
        details: error.message,
      });
    }

    const runsWithAccounts = attachRunAccountMetadataList(runs || []);
    const metricsStore = readXMetricsFile().metrics || {};
    const score = calculateAiUsageScore(runsWithAccounts, metricsStore);

    return res.json({
      message: "AI usage score ready",
      score,
    });
  } catch (err) {
    return res.status(500).json({
      error: "AI usage score failed",
      details: err.message,
    });
  }
});
// =======================
// COST / BUDGET ROUTES
// =======================

app.get("/api/admin/costs/summary", async (req, res) => {
  try {
    const organizationId = getRequestOrgId(req);
    const summary = await getSpendSummary(supabase, organizationId);

    return res.json({
      ok: true,
      organization_id: organizationId,
      summary,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Failed to load cost summary",
      details: err.message,
    });
  }
});

app.get("/api/admin/costs/health", async (req, res) => {
  try {
    const organizationId = getRequestOrgId(req);
    const summary = await getSpendSummary(supabase, organizationId);

    const state =
      summary.monthlyRemaining <= 0 || summary.dailyRemaining <= 0
        ? "blocked"
        : summary.dailyRemaining <= 0.5 || summary.vaDailyRemaining <= 0.5
        ? "warning"
        : "healthy";

    return res.json({
      ok: true,
      state,
      organization_id: organizationId,
      summary,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: "Failed to load cost health",
      details: err.message,
    });
  }
});
// =======================
// VA ROUTES
// =======================
app.post("/api/va/entries", requireApiUser, async (req, res) => {
try {
  const title = String(req.body.title || "").trim();
  const topic = String(req.body.topic || "").trim();
  const raw_text = String(req.body.raw_text || "").trim();

  if (!title || !topic || !raw_text) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // ----------------------------
  // AI ANALYSIS
  // ----------------------------
  const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const aiRes = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are a VA disability expert. Estimate likelihood (low, medium, high) && possible rating (0-100%). Be concise."
      },
      {
        role: "user",
        content: `Condition: ${title}\nCategory: ${topic}\nDetails: ${raw_text}`
      }
    ]
  });

  const aiSummary = aiRes.choices[0].message.content;

  // ----------------------------
  // SAVE TO DB
  // ----------------------------
  const { data, error } = await supabase
    .from("va_entries")
    .insert([
      {
        user_id: req.apiUser.id,
      title,
        topic,
        raw_text,
        summary: aiSummary
      }
    ])
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.json({
    message: "VA entry saved",
    ai_prediction: aiSummary,
    entry: data
  });

} catch (err) {
  return res.status(500).json({ error: err.message });
}

  try {
    const title = String(req.body.title || "").trim();
    const topic = String(req.body.topic || "").trim();
    const raw_text = String(req.body.raw_text || "").trim();

    if (!title || !topic || !raw_text) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const aiRes = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a VA disability expert. Estimate likelihood (low, medium, high) && possible rating (0-100%). Be concise."
        },
        {
          role: "user",
          content: `Condition: ${title}\nCategory: ${topic}\nDetails: ${raw_text}`
        }
      ]
    });

    const aiSummary = aiRes.choices[0].message.content;

    const { data, error } = await supabase
      .from("va_entries")
      .insert([
        {
          title,
          topic,
          raw_text,
          summary: aiSummary
        }
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      message: "VA entry saved",
      ai_prediction: aiSummary,
      entry: data
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
app.post("/api/va/analyze", requireApiUser, async (req, res) => {
  try {
    const { entry_id } = req.body;

    if (!entry_id) {
      return res.status(400).json({ error: "entry_id required" });
    }

    const { data: entry, error } = await supabase
      .from("va_entries")
      .select("*")
      .eq("id", entry_id)
      .eq("user_id", req.apiUser.id)
      .single();

    if (error || !entry) {
      return res.status(404).json({ error: "Entry not found" });
    }

    const prompt = `
You are a VA disability claims expert.

Analyze this claim:

${entry.raw_text}

Return JSON ONLY:

{
  "summary": "",
  "likely_rating_range": "",
  "strengths": [],
  "weaknesses": [],
  "next_steps": []
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const text = completion.choices[0].message.content;

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {
        summary: text,
        likely_rating_range: "Unknown",
        strengths: [],
        weaknesses: [],
        next_steps: []
      };
    }

    const { error: updateError } = await supabase
      .from("va_entries")
      .update({
        ai_summary: parsed.summary,
        likely_rating_range: parsed.likely_rating_range,
        strengths: parsed.strengths,
        weaknesses: parsed.weaknesses,
        next_steps: parsed.next_steps
      })
      .eq("id", entry_id)
      .eq("user_id", req.apiUser.id);

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.json({ success: true });

  } catch (err) {
    return res.status(500).json({
      error: "Analyze failed",
      details: err.message
    });
  }
});

app.post("/api/va/calculate-crsc", requireApiUser, async (req, res) => {
  try {
    const result = estimateCrsc({
      yearsOfService: req.body.years_of_service,
      retiredPayMonthly: req.body.retired_pay_monthly,
      vaCombinedRating: req.body.va_combined_rating,
      combatRelatedPercent: req.body.combat_related_percent,
    });

    return res.json({
      message: "CRSC estimate complete",
      result,
    });
  } catch (err) {
    return res.status(500).json({
      error: "CRSC estimate failed",
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
  "Give me a weekly rundown of my last 7 days of posts. Tell me the main themes, what performed best, what underperformed, && 5 direct recommendations for the next posts.",
  runsWithAccounts,
  metricsStore,
  {
    organizationId: getRequestOrgId(req),
  }
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
      .select(`
        id,
        created_at,
        status,
        summary,
        input_text,
        twitter_text,
        linkedin_text,
        generated_twitter_persona,
        generated_linkedin_persona,
        persona,
        post_mode,
        approved_at,
        posted_at,
        x_tweet_id
      `)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch runs for AI",
        details: error.message,
      });
    }

    const runsWithAccounts = attachRunAccountMetadataList(runs || []);

    const compactRuns = runsWithAccounts.map((run) => ({
      id: run.id,
      created_at: run.created_at,
      status: run.status,
      summary: run.summary || "",
      input_text: run.input_text || "",
      twitter_text: run.twitter_text || "",
      linkedin_text: run.linkedin_text || "",
      persona:
        run.generated_twitter_persona ||
        run.generated_linkedin_persona ||
        run.persona ||
        "",
      post_mode: run.post_mode || "",
      x_account_label: run.x_account_label || "",
      x_tweet_id: run.x_tweet_id || null,
      approved_at: run.approved_at || null,
      posted_at: run.posted_at || null,
    }));

    const fullMetricsStore = readXMetricsFile().metrics || {};
    const compactMetricsStore = {};

    compactRuns.forEach((run) => {
      if (fullMetricsStore[run.id]) {
        compactMetricsStore[run.id] = {
          like_count: Number(fullMetricsStore[run.id].like_count || 0),
          reply_count: Number(fullMetricsStore[run.id].reply_count || 0),
          repost_count: Number(fullMetricsStore[run.id].repost_count || 0),
          quote_count: Number(fullMetricsStore[run.id].quote_count || 0),
          impression_count: Number(fullMetricsStore[run.id].impression_count || 0),
          synced_at: fullMetricsStore[run.id].synced_at || null,
          account_label: fullMetricsStore[run.id].account_label || "",
          persona: fullMetricsStore[run.id].persona || "",
        };
      }
    });

const answer = await askAIAboutRuns(
  question,
  runsWithAccounts,
  metricsStore,
  {
    organizationId: getRequestOrgId(req),
  }
);
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
<button class="draft" onclick="deleteRun('${run.id}')">Delete</button>
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
function toggleRunHistory() {
  const el = document.getElementById('run-history-wrap');
  if (!el) {
    alert('run-history-wrap not found');
    return;
  }

  if (el.style.display === 'none' || el.style.display === '') {
    el.style.display = 'block';
    alert('history opened');
  } else {
    el.style.display = 'none';
    alert('history closed');
  }
}
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
async function deleteRun(id) {
  const ok = confirm('Delete this run? This cannot be undone.');
  if (!ok) return;

  const res = await fetch('/api/runs/' + id, {
    method: 'DELETE'
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.details || data.error || 'Failed to delete run');
    return;
  }

  window.location.href = '/';
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
    let query = supabase
      .from("build_logger_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(24);

    const { data: rawRuns, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    return res.json({
      message: "Dashboard loaded",
      runs: rawRuns || []
    });

  } catch (err) {
    return res.status(500).json({
      error: "Dashboard failed",
      details: err.message
    });
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
app.delete("/api/runs/:id", async (req, res) => {
  try {
    const { error } = await supabase
      .from("build_logger_runs")
      .delete()
      .eq("id", req.params.id);

    if (error) {
      return res.status(500).json({
        error: "Failed to delete run",
        details: error.message,
      });
    }

    return res.json({
      message: "Run deleted",
      id: req.params.id,
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

    const run = await createRunFromInput(input, topicOverride, xAccountLabel, {
      organizationId: getRequestOrgId(req),
    });

    return res.json({
      message: "Run completed && saved",
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
        .send("<h1>Missing input</h1><p>Go back && enter build notes.</p>");
    }

    await createRunFromInput(input, topicOverride, xAccountLabel, {
      organizationId: getRequestOrgId(req),
    });

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
// VA ROUTES
// =======================

app.post("/api/va/entries", requireApiUser, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const topic = String(req.body.topic || "").trim();
    const source_type = String(req.body.source_type || "manual").trim();
    const source_name = String(req.body.source_name || "").trim();
    const source_url = String(req.body.source_url || "").trim();
    const raw_text = String(req.body.raw_text || "").trim();

    if (!title) {
      return res.status(400).json({ error: "Missing title" });
    }

    if (!topic) {
      return res.status(400).json({ error: "Missing topic" });
    }

    if (!raw_text) {
      return res.status(400).json({ error: "Missing raw_text" });
    }

    const { data, error } = await supabase
      .from("va_entries")
      .insert([
        {
          title,
          topic,
          source_type,
          source_name: source_name || null,
          source_url: source_url || null,
          raw_text,
          summary: null,
        },
      ])
      .select()
      .single();

    if (error) {
      return res.status(500).json({
        error: "Failed to save VA entry",
        details: error.message,
      });
    }

    return res.json({
      message: "VA entry saved",
      entry: data,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});

// =====================
// HOME (TEMP DASHBOARD)
// =====================

app.get("/login", (req, res) => {
  res.sendFile(require("path").join(__dirname, "views", "login.html"));
});

app.get("/signup", (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "signup.html"));
});

app.get("/", (req, res) => {
  return res.redirect("/signup");
});
app.get("/dashboard", (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect("/login");
  }
  return res.sendFile(path.join(__dirname, "views", "dashboard.html"));
});
app.get("/api/runs", checkAuth, async (req, res) => {
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

    return res.json({
      runs: data || [],
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message,
    });
  }
});
app.get("/api/va/entries", checkAuth, async (req, res) => {
  try {
    let query = supabase
      .from("va_entries")
      .select("*")
      .eq("user_id", req.apiUser.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (req.query.topic) {
      query = query.eq("topic", String(req.query.topic).trim());
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        error: "Failed to load VA entries",
        details: error.message,
      });
    }

    return res.json({
      entries: data || [],
    });
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
  cron.schedule("*/5 * * * *", function () {
    console.log("[cron] heartbeat " + new Date().toISOString());
  });
  console.log("Local cron enabled");
} else {
  console.log("Local cron disabled");
}


// ============================
// VA ANALYZE ROUTE (FORCED)
// ============================
app.post("/analyze", async (req, res) => {
  try {
    const { input } = req.body || {};

    if (!input) {
      return res.status(400).json({ error: "Missing input" });
    }

    const raw = String(input || "");
    const t = raw.toLowerCase();

    function hasAny(words) {
      return words.some(w => t.includes(w));
    }

    const mentionsHeadache = hasAny([
      "headache", "headaches", "migraine", "migraines"
    ]);

    const prostrating = hasAny([
      "lay down", "lie down", "dark room", "bedrest", "bed rest",
      "prostrating", "prostrate", "can't function", "cannot function",
      "have to stop", "stop working", "nausea", "vomit", "vomiting",
      "light sensitivity", "photophobia", "sound sensitivity", "phonophobia"
    ]);

    const monthly30 = hasAny([
      "once a month", "1 time a month", "monthly", "every month"
    ]);

    const twoMonth10 = hasAny([
      "every 2 months", "once every 2 months", "one in 2 months"
    ]);

    const frequent50 = hasAny([
      "daily", "multiple times a week", "several times a week",
      "very frequent", "3 times a week", "4 times a week", "weekly"
    ]);

    const prolonged50 = hasAny([
      "all day", "last all day", "prolonged", "hours", "for hours",
      "lasting hours", "lasts hours"
    ]);

    const economic50 = hasAny([
      "miss work", "missing work", "call out", "called out",
      "leave work", "left work", "can't keep a job", "cannot keep a job",
      "write up", "written up", "economic", "severe economic",
      "job impact", "lost wages", "work impact"
    ]);

    let rating = 0;
    const reasons = [];
    const nextSteps = [];

    if (!mentionsHeadache) {
      rating = 0;
      reasons.push("Input does not clearly describe headaches || migraines.");
      nextSteps.push("State the exact condition being claimed.");
      nextSteps.push("Describe frequency, duration, && functional impact.");
    } else {
      reasons.push("Input describes headache || migraine symptoms.");

      if (prostrating) {
        reasons.push("Text suggests prostrating-type features such as needing to lie down || isolate.");
      } else {
        reasons.push("Text does not clearly establish prostrating attacks yet.");
      }

      if (prostrating && frequent50 && prolonged50 && economic50) {
        rating = 50;
        reasons.push("Text suggests very frequent, completely prostrating, prolonged attacks with severe work/economic impact.");
      } else if (prostrating && (monthly30 || frequent50)) {
        rating = 30;
        reasons.push("Text suggests characteristic prostrating attacks at least around monthly || more.");
      } else if (prostrating && twoMonth10) {
        rating = 10;
        reasons.push("Text suggests prostrating attacks averaging about one in two months.");
      } else if (prostrating) {
        rating = 10;
        reasons.push("Text suggests some prostrating attacks, but frequency is not documented strongly enough for 30% || 50%.");
      } else {
        rating = 0;
        reasons.push("Headaches are described, but the text does not yet clearly show characteristic prostrating attacks.");
      }

      nextSteps.push("Document frequency over the last several months.");
      nextSteps.push("State whether attacks are prostrating && require lying down in a dark room.");
      nextSteps.push("State duration of attacks, such as hours || all day.");
      nextSteps.push("State work impact: missed work, reduced productivity, leaving early, || severe economic effects.");
      nextSteps.push("Upload medical notes, DBQs, migraine logs, prescriptions, && employer impact evidence.");
    }

    const result = analyzeCfr38(input);

    const { error: insertError } = await supabase
      .from("va_claims")
      .insert({
        user_id: null,
        input_text: raw,
        result_text: result
      });

    if (insertError) {
      console.log("VA CLAIM SAVE ERROR:", insertError);
      return res.status(500).json({
        error: "Failed to save VA claim",
        details: insertError.message
      });
    }

    return res.json({ result });
  } catch (err) {
    console.log("VA ANALYZE ERROR:", err);
    return res.status(500).json({
      error: "VA analysis failed",
      details: err.message
    });
  }
});


// =============================
// GET VA CLAIMS
// =============================
app.get("/claims", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("va_claims")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return res.status(500).json({
        error: "Failed to fetch claims",
        details: error.message
      });
    }

    return res.json({ claims: data });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
});


// ============================
// ANALYZE IMAGE PAPERWORK
// ============================
app.post("/analyze-image", async (req, res) => {
  try {
    const { imagePath } = req.body || {};

    if (!imagePath) {
      return res.status(400).json({ error: "Missing imagePath" });
    }

    const escapedPath = String(imagePath).replace(/"/g, '\"');
    const ocrText = execSync(`python ocr.py "${escapedPath}"`, {
      encoding: "utf8"
    });

    const cleanedText = String(ocrText || "").trim();

    if (!cleanedText) {
      return res.status(400).json({
        error: "OCR returned no text",
        extracted_text: ""
      });
    }

    const filteredText = cleanOcrText(cleanedText);

    if (!filteredText || isGarbageOcrText(filteredText)) {
      return garbageOcrResponse(res, filteredText || cleanedText);
    }

    const result = analyzeCfr38(filteredText);

    const detectedCondition = extractFieldFromResult_local(result, "Condition");
    const estimatedRating = extractEstimatedRating_local(result);
    const confidenceLabel = extractFieldFromResult_local(result, "Confidence");
    const exportSummary = buildExportSummary_local({
      condition: detectedCondition,
      rating: estimatedRating,
      confidence: confidenceLabel,
      resultText: result
    });

    const { error: insertError } = await supabase
      .from("va_claims")
      .insert({
        user_id: null,
        source_type: "image_ocr",
        input_text: `[IMAGE OCR]`,
        extracted_text: filteredText,
        result_text: result,
        detected_condition: detectedCondition,
        estimated_rating: estimatedRating,
        confidence_label: confidenceLabel,
        export_summary: exportSummary
      });

    if (insertError) {
      console.log("OCR CLAIM SAVE ERROR:", insertError);
    }

    return res.json({
      extracted_text: filteredText,
      result
    });
  } catch (err) {
    return res.status(500).json({
      error: "OCR failed",
      details: err.message
    });
  }
});


// ============================
// BROWSER PAPERWORK UPLOAD
// ============================

function countRegexMatches(text, regex) {
  const matches = String(text || "").match(regex);
  return matches ? matches.length : 0;
}

function isGarbageOcrText(text) {
  const t = String(text || "").toLowerCase().trim();

  if (!t) {
    return true;
  }

  const words = t.split(/\s+/).filter(Boolean);
  const lineCount = t.split(/\n+/).filter(Boolean).length;
  const alphaCount = countRegexMatches(t, /[a-z]/g);
  const digitCount = countRegexMatches(t, /[0-9]/g);

  const hasClaimWords = [
    "migraine",
    "headache",
    "ptsd",
    "anxiety",
    "depression",
    "panic",
    "tinnitus",
    "ringing",
    "back pain",
    "lumbar",
    "knee",
    "sleep apnea",
    "cpap",
    "rhinitis",
    "sinusitis",
    "gerd",
    "reflux",
    "radiculopathy",
    "dbq",
    "diagnosis",
    "service",
    "military",
    "symptoms",
    "medical",
    "treatment"
  ].some((term) => t.includes(term));

  const hasUiJunk = [
    "termux",
    "images",
    "screenshot_",
    "chrome.jpg",
    "chatgpt.jpg",
    "payloadtoolargeerror",
    "upgrade: pkg upgrade",
    "report issues at",
    "title ©",
    "camera",
    "downloads",
    "pictures"
  ].some((term) => t.includes(term));

  if (hasUiJunk && !hasClaimWords) {
    return true;
  }

  if (words.length < 6) {
    return true;
  }

  if (alphaCount < 20) {
    return true;
  }

  if (digitCount > alphaCount && !hasClaimWords) {
    return true;
  }

  if (lineCount <= 2 && !hasClaimWords) {
    return true;
  }

  return false;
}


function cleanOcrText(raw) {
  if (!raw) return "";

  const medicalKeywords = [
    "headache", "migraine", "migraines", "photophobia", "light sensitivity", "dark room", "prostrating",
    "ptsd", "mental health", "anxiety", "depression", "panic", "panic attacks", "nightmares", "hygiene",
    "memory", "suicidal", "occupational", "social", "relationships", "sleep impairment",
    "sleep apnea", "cpap", "bipap", "daytime hypersomnolence", "snoring",
    "lumbar", "back pain", "thoracolumbar", "sciatica", "radiculopathy", "tingling", "numbness",
    "knee", "instability", "locking", "flare-ups",
    "tinnitus", "ringing", "hearing loss", "audiology",
    "gerd", "reflux", "heartburn", "dysphagia", "regurgitation",
    "sinusitis", "rhinitis", "polyps", "obstruction",
    "scar", "scars", "disfigurement",
    "diagnosis", "diagnosed", "doctor", "provider", "treatment", "therapy", "medication", "prescription",
    "dbq", "medical", "service", "military", "deployment", "work", "misses work", "productivity",
    "daily activities", "functional impact", "frequency", "weekly", "monthly", "per month", "times per month"
  ];

  const junkPhrases = [
    "reddit",
    "help guess my rating",
    "u/",
    "r/",
    "chatgpt",
    "termux",
    "google play",
    "app store",
    "create account",
    "already have account",
    "my current courses",
    "screenshot_",
    "payloadtoolargeerror",
    "report issues at",
    "pkg upgrade",
    "chrome.jpg",
    "camera",
    "downloads",
    "pictures",
    "comments",
    "upvote",
    "section iii: symptoms" // can be useful context, but usually header noise
  ];

  function looksLikeJunk(line) {
    const lower = line.toLowerCase().trim();
    if (!lower) return true;

    if (junkPhrases.some(j => lower.includes(j))) return true;

    if (/^[@#/=x><~\[\]\(\)\{\}\|\-\_\.\,\:\;'"`0-9\s%+&]+$/.test(lower) && !medicalKeywords.some(k => lower.includes(k))) {
      return true;
    }

    if ((lower.match(/[0-9]/g) || []).length > (lower.match(/[a-z]/g) || []).length && !medicalKeywords.some(k => lower.includes(k))) {
      return true;
    }

    if (lower.length < 3) return true;

    return false;
  }

  function normalizeLine(line) {
    return String(line || "")
      .replace(/[^\x20-\x7E]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  let lines = String(raw || "")
    .split(/\n+/)
    .map(normalizeLine)
    .filter(Boolean)
    .filter(line => !looksLikeJunk(line));

  // Prefer lines with claim-relevant content
  let relevant = lines.filter(line => {
    const lower = line.toLowerCase();
    return medicalKeywords.some(k => lower.includes(k));
  });

  // If OCR split good sentences badly, keep nearby useful-looking symptom lines
  if (relevant.length === 0) {
    relevant = lines.filter(line => {
      const lower = line.toLowerCase();
      return /pain|sleep|panic|anxiety|depression|memory|work|military|service|diagnosis|treatment|headache|migraine|knee|back|ringing|cpap/i.test(lower);
    });
  }

  // de-dup near-identical lines
  const seen = new Set();
  const deduped = [];
  for (const line of relevant) {
    const key = line.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(line);
    }
  }

  // keep only the strongest lines
  const finalLines = deduped
    .filter(line => line.length >= 4)
    .slice(0, 25);

  return finalLines.join("\n").trim();
}


function garbageOcrResponse(res, extractedText) {
  return res.status(400).json({
    error: "Could not confidently extract claim-relevant medical text from this image. Please upload a clearer document or enter the condition manually.",
    extracted_text: extractedText || ""
  });


function extractFieldFromResult(resultText, label) {
  const text = String(resultText || "");
  const regex = new RegExp(`^${label}:\\s*(.+)$`, "mi");
  const match = text.match(regex);
  return match ? String(match[1]).trim() : null;
}

function extractEstimatedRating(resultText) {
  const value = extractFieldFromResult(resultText, "Estimated VA Rating");
  if (!value) return null;
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function buildExportSummary({ condition, rating, confidence, resultText }) {
  const parts = [];
  if (condition) parts.push(`Condition: ${condition}`);
  if (rating !== null && rating !== undefined) parts.push(`Estimated VA Rating: ${rating}%`);
  if (confidence) parts.push(`Confidence: ${confidence}`);
  parts.push("");
  parts.push(String(resultText || "").trim());
  return parts.join("\n");
}

}



function extractFieldFromResult_local(resultText, label) {
  const text = String(resultText || "");
  const safeLabel = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("^" + safeLabel + ":\\s*(.+)$", "mi");
  const match = text.match(regex);
  return match ? String(match[1]).trim() : null;
}

function extractEstimatedRating_local(resultText) {
  const value = extractFieldFromResult_local(resultText, "Estimated VA Rating");
  if (!value) return null;
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function buildExportSummary_local(payload) {
  const condition = payload && payload.condition ? payload.condition : null;
  const rating = payload && payload.rating !== undefined && payload.rating !== null ? payload.rating : null;
  const confidence = payload && payload.confidence ? payload.confidence : null;
  const resultText = payload && payload.resultText ? payload.resultText : "";

  const parts = [];
  if (condition) parts.push("Condition: " + condition);
  if (rating !== null) parts.push("Estimated VA Rating: " + rating + "%");
  if (confidence) parts.push("Confidence: " + confidence);
  if (parts.length) parts.push("");
  parts.push(String(resultText).trim());

  return parts.join("\n");
}


app.post("/upload-paperwork-json", async (req, res) => {
  let tempPath = null;

  try {
    const { imageBase64, filename } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    const match = String(imageBase64).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

    if (!match) {
      return res.status(400).json({ error: "Invalid image payload" });
    }

    const mimeType = match[1];
    const base64Data = match[2];

    let ext = ".jpg";
    if (mimeType.includes("png")) ext = ".png";
    if (mimeType.includes("jpeg")) ext = ".jpg";
    if (mimeType.includes("jpg")) ext = ".jpg";
    if (typeof filename === "string" && filename.toLowerCase().endsWith(".png")) ext = ".png";

    const uploadsDir = path.join(__dirname, "uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });

    tempPath = path.join(uploadsDir, `paperwork_${Date.now()}${ext}`);
    fs.writeFileSync(tempPath, Buffer.from(base64Data, "base64"));

    const ocrText = execFileSync("python", ["ocr.py", tempPath], {
      encoding: "utf8"
    });

    const cleanedText = String(ocrText || "").trim();

    if (!cleanedText) {
      return res.status(400).json({
        error: "OCR returned no text",
        extracted_text: ""
      });
    }

    const filteredText = cleanOcrText(cleanedText);

    if (!filteredText || isGarbageOcrText(filteredText)) {
      return garbageOcrResponse(res, filteredText || cleanedText);
    }

    const result = analyzeCfr38(filteredText);

    const detectedCondition = extractFieldFromResult_local(result, "Condition");
    const estimatedRating = extractEstimatedRating_local(result);
    const confidenceLabel = extractFieldFromResult_local(result, "Confidence");
    const exportSummary = buildExportSummary_local({
      condition: detectedCondition,
      rating: estimatedRating,
      confidence: confidenceLabel,
      resultText: result
    });

    const { error: insertError } = await supabase
      .from("va_claims")
      .insert({
        user_id: null,
        source_type: "image_ocr",
        input_text: `[IMAGE OCR]`,
        extracted_text: filteredText,
        result_text: result,
        detected_condition: detectedCondition,
        estimated_rating: estimatedRating,
        confidence_label: confidenceLabel,
        export_summary: exportSummary
      });

    if (insertError) {
      console.log("UPLOAD OCR CLAIM SAVE ERROR:", insertError);
    }

    return res.json({
      success: true,
      extracted_text: filteredText,
      result
    });
  } catch (err) {
    console.log("UPLOAD PAPERWORK ERROR:", err);
    return res.status(500).json({
      error: "Upload analysis failed",
      details: err.message
    });
  } finally {
    try {
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (cleanupErr) {
      console.log("UPLOAD TEMP FILE CLEANUP ERROR:", cleanupErr.message);
    }
  }
});


app.post("/signup", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Email and password are required",
        user: null
      });
    }

    const { data, error } = await supabaseAuth.auth.signUp({
      email,
      password,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: error.message,
        user: null
      });
    }

    return res.json({
      success: true,
      error: null,
      user: {
        id: data?.user?.id ?? data?.session?.user?.id ?? null,
        email: data?.user?.email ?? data?.session?.user?.email ?? null
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Server error",
      user: null
    });
  }
});


app.post("/va/analyze", upload.single("image"), async (req, res) => {
  try {
    const issue = req.body?.issue || "";
    const serviceContext = req.body?.serviceContext || "";
    const hasImage = !!req.file;

    const input = [
      issue,
      serviceContext,
      hasImage ? "User uploaded VA evidence image." : ""
    ]
      .filter(Boolean)
      .join("\n\n");

");

    if (!input.trim()) {
      return res.status(400).json({
        error: "issue, serviceContext, or image is required"
      });
    }

    const result = analyzeCfr38(input);

    return res.json({
      success: true,
      likelihood: "See analysis",
      summary: result,
      nextSteps: []
    });
  } catch (err) {
    console.log("MOBILE VA ANALYZE ERROR:", err);
    return res.status(500).json({
      error: "VA analysis failed",
      details: err.message
    });
  }
});
app.listen(PORT, function () {
  console.log("Build Logger API running on port " + PORT);
});