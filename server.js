const { analyzeCfr38 } = require("./lib/cfr38-engine");
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

const app = express();


/* =======================
   CORE BROWSER ROUTES
======================= */

app.get("/", (req, res) => {
  return res.redirect("/signup");
});

app.get("/login", (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.get("/signup", (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "signup.html"));
});

app.get("/dashboard", (req, res) => {
  if (!isAuthenticated(req)) {
    return res.redirect("/login");
  }
  return res.sendFile(path.join(__dirname, "views", "dashboard.html"));
});

   // ✅ ONLY ONE TIME

// ----------------------------
// MIDDLEWARE
// ----------------------------
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// ----------------------------
// ROUTES (SAFE TO USE app NOW)
// ----------------------------


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

app.use((req, res, next) => {
  console.log("REQ:", req.method, req.url);
  next();
});

const PORT = process.env.PORT || 3000;
if (!process.env.OPENAI_API_KEY) {
  console.log("Warning: OPENAI_API_KEY is missing");
}
if (!process.env.SUPABASE_URL) {
  console.log("Warning: SUPABASE_URL is missing");
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("Warning: SUPABASE_SERVICE_ROLE_KEY is missing");
}
if (!process.env.SUPABASE_ANON_KEY) {
  console.log("Warning: SUPABASE_ANON_KEY is missing");
}
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

app.get("/ping", (req, res) => {
  return res.send("pong");
});


app.get("/health", (req, res) => {
  res.json({ ok: true, service: "build-logger-api" });
});

app.post("/login", async (req, res) => {
  try {
    console.log("LOGIN HIT");
    console.log("BODY:", req.body);

    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: "Missing email or password",
        received: req.body
      });
    }

    const { data, error } = await supabaseAuth.auth.signInWithPassword({
      email,
      password,
    });

    console.log("SUPABASE LOGIN:", { data, error });

    if (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    return res.json({
      success: true,
      session: data.session,
      user: data.user,
    });

  } catch (err) {
    console.error("LOGIN CRASH:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
});

app.post("/signup", async (req, res) => {
  try {
    console.log("SIGNUP HIT");
    console.log("SIGNUP BODY:", req.body);

    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({
        error: "Missing email or password",
        received: req.body || null
      });
    }

    const { data, error } = await supabaseAuth.auth.signUp({
      email,
      password,
    });

    console.log("SUPABASE SIGNUP:", { data, error });

    if (error) {
      return res.status(400).json({
        error: error.message,
      });
    }

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("SIGNUP CRASH:", err);
    return res.status(500).json({
      error: err.message,
    });
  }
});

app.listen(PORT, function () {
  console.log("Build Logger API running on port " + PORT);
});
