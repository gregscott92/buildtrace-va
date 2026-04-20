const { analyzeCfr38 } = require("./lib/cfr38-engine");

const multer = require("multer");
const upload = multer({ dest: "uploads/" });

      
require("dotenv").config();

const express = require("express");
const rateLimit = require("express-rate-limit");
const createArenaRouter = require("./arena.routes");
const cookieParser = require("cookie-parser");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const { TwitterApi } = require("twitter-api-v2");
const cron = require("node-cron");
const axios = require("axios");

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const app = express();

const arenaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many requests. Slow down." },
});


// ===== CREATOR BYPASS =====
const CREATOR_EMAIL = "greg.scott92@icloud.com";

function isCreator(user) {
  return user && user.email === CREATOR_EMAIL;
}


// ===== FUNNEL TRACKING =====
let funnel = {
  signup: 0,
  login: 0,
  dashboard: 0
};

function track(route) {
  if (funnel[route] !== undefined) {
    funnel[route]++;
  }

  console.log(
    "FUNNEL:",
    JSON.stringify(funnel)
  );
}


let visitCount = 0;

function logVisit(route) {
  visitCount++;
  console.log("VISIT:", route, "| total:", visitCount);
}


// ===== SIMPLE VISIT TRACKING =====
function logVisit(route) {
  try {
    const line = `${new Date().toISOString()} | ${route}\n`;
    console.log("VISIT:", route, new Date().toISOString());
  } catch (e) {
    console.log("visit log error", e.message);
  }
}
   // ✅ ONLY ONE TIME

// ----------------------------
// MIDDLEWARE
// ----------------------------
app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

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


// ----------------------------
// ROUTES (SAFE TO USE app NOW)
// ----------------------------
app.get("/", (req, res) => {
  return res.redirect("/dashboard");
});
app.get("/va", (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "dashboard.html"));
});

app.get("/dashboard", (req, res) => {
  logVisit("dashboard");
  track("dashboard");
  return res.sendFile(path.join(__dirname, "views", "dashboard.html"));
});

app.get("/arena", (req, res) => {
  return res.sendFile(path.join(__dirname, "views", "arena.html"));
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


async function extractVisionTextFromBase64(base64Image) {
  if (!base64Image) return "";

  const imageUrl = `data:image/jpeg;base64,${base64Image}`;

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Extract all readable medical and claim-relevant text from this image.

Focus on:
- Diagnoses
- Symptoms
- Body parts affected
- Frequency, severity, duration
- Functional impact (work, daily life)
- Range of motion if present
- Medications or treatment

Return clean structured text. Do not summarize away details.`
          },
          {
            type: "input_image",
            image_url: imageUrl
          }
        ]
      }
    ]
  });

  return String(response.output_text || "").trim();
}

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

function fileToDataUrl(filePath, mimeType) {
  const base64 = fs.readFileSync(filePath, "base64");
  return `data:${mimeType};base64,${base64}`;
}

async function extractVisionTextFromUpload(uploadedFile, issue, serviceContext) {
  if (!uploadedFile) return "";

  const mimeType = uploadedFile.mimetype || "image/jpeg";
  const imageUrl = fileToDataUrl(uploadedFile.path, mimeType);

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "You are helping with a VA disability evidence intake workflow. " +
              "Read this uploaded image && extract only useful claim-related details. " +
              "Focus on diagnoses, symptoms, severity, frequency, functional impact, checked boxes, range-of-motion findings, mental health findings, dates, service-connection clues, DBQ-style findings, && any rating-relevant details. " +
              "Return plain text only. If the image is unclear, say what is unclear. " +
              "User issue: " + (issue || "") + ". " +
              "User service context: " + (serviceContext || "") + "."
          },
          {
            type: "input_image",
            image_url: imageUrl,
            detail: "high"
          }
        ]
      }
    ]
  });

  return (response.output_text || "").trim();
}



function mhHas(text, phrases) {
  const t = String(text || "").toLowerCase();
  return phrases.some((p) => t.includes(String(p).toLowerCase()));
}

function mhCount(text, phraseMap) {
  const hits = [];
  for (const item of phraseMap) {
    if (mhHas(text, item.phrases)) {
      hits.push(item.label);
    }
  }
  return hits;
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}


function scoreMentalHealthDbq(text) {
  const t = text.toLowerCase();

  const has = (phrase) => t.includes(phrase);

  let seventy = [];
  let fifty = [];
  let thirty = [];

  // --- 70% CRITERIA ---
  if (has("panic attacks more than once a week")) seventy.push("panic");
  if (has("difficulty adapting")) seventy.push("stress");
  if (has("neglect of personal appearance")) seventy.push("hygiene");
  if (has("intermittent inability to perform activities")) seventy.push("adl");

  // --- 50% CRITERIA ---
  if (has("panic attacks")) fifty.push("panic");
  if (has("memory loss")) fifty.push("memory");
  if (has("disturbances of motivation")) fifty.push("motivation");

  // --- 30% CRITERIA ---
  if (has("depressed mood")) thirty.push("mood");
  if (has("anxiety")) thirty.push("anxiety");

  // --- DECISION ---
  let rating = "0%";
  let confidence = "Low";

  if (seventy.length >= 2) {
    rating = "70%";
    confidence = "Medium";
  } else if (fifty.length >= 2) {
    rating = "50%";
    confidence = "Medium";
  } else if (thirty.length >= 2) {
    rating = "30%";
    confidence = "Low";
  }

  
const isPaid = false; // TODO: replace with real payment check later

return {
  success: true,

  // FREE DATA
  estimated_rating,
  confidence,
  claim_strength,

  // LOCKED DATA
  ...(isPaid && {
    why,
    fastest_improvement,
    biggest_lever,
    missing,
    next_steps,
  }),

  locked: !isPaid,

    condition: "PTSD / Mental Health",
    diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
    estimatedRating: rating,
    confidence,
    reasoning: `Matched symptoms → 70:${seventy.length} 50:${fifty.length} 30:${thirty.length}`,
    evidenceNeeded: "Service connection + medical diagnosis + severity documentation",
    nextSteps: "Submit DBQ + nexus + treatment records",
    important: "Ratings depend on severity, frequency, and functional impact"
  };
}


function scoreMentalHealthDbq(visionExtract) {
  const text = String(visionExtract || "").trim();
  if (!text) return null;

  const mentalAnchorTerms = [
    "depressed mood",
    "anxiety",
    "panic attacks",
    "difficulty adapting to stressful circumstances",
    "neglect of personal appearance && hygiene",
    "difficulty in establishing && maintaining effective work && social relationships",
    "inability to establish && maintain effective relationships",
    "suicidal ideation",
    "obsessional rituals",
    "near-continuous panic",
    "near continuous panic",
    "impaired impulse control",
    "spatial disorientation",
    "gross impairment in thought processes",
    "persistent delusions",
    "persistent hallucinations",
    "intermittent inability to perform activities of daily living",
    "disorientation to time",
    "disorientation to place",
    "memory loss for names of close relatives",
    "mental health",
    "ptsd"
  ];

  const looksMental = mhHas(text, mentalAnchorTerms);
  if (!looksMental) return null;

  const oneHundred = mhCount(text, [
    { label: "gross impairment in thought processes or communication", phrases: ["gross impairment in thought processes", "gross impairment in communication", "gross impairment in thought processes or communication"] },
    { label: "persistent delusions or hallucinations", phrases: ["persistent delusions", "persistent hallucinations"] },
    { label: "grossly inappropriate behavior", phrases: ["grossly inappropriate behavior"] },
    { label: "persistent danger of hurting self or others", phrases: ["persistent danger of hurting self", "persistent danger of hurting others", "persistent danger of hurting self or others"] },
    { label: "intermittent inability to perform activities of daily living", phrases: ["intermittent inability to perform activities of daily living", "inability to maintain minimal personal hygiene", "maintenance of minimal personal hygiene"] },
    { label: "disorientation to time or place", phrases: ["disorientation to time", "disorientation to place", "disorientation to time or place"] },
    { label: "severe memory loss", phrases: ["memory loss for names of close relatives", "memory loss for own occupation", "memory loss for own name"] },
  ]);

  const seventy = mhCount(text, [
    { label: "suicidal ideation", phrases: ["suicidal ideation"] },
    { label: "obsessional rituals", phrases: ["obsessional rituals"] },
    { label: "illogical or irrelevant speech", phrases: ["speech intermittently illogical", "obscure", "irrelevant"] },
    { label: "near-continuous panic or depression", phrases: ["near-continuous panic", "near continuous panic", "near-continuous depression", "near continuous depression"] },
    { label: "impaired impulse control", phrases: ["impaired impulse control", "unprovoked irritability with periods of violence"] },
    { label: "spatial disorientation", phrases: ["spatial disorientation"] },
    { label: "neglect of personal appearance && hygiene", phrases: ["neglect of personal appearance && hygiene"] },
    { label: "difficulty adapting to stressful circumstances", phrases: ["difficulty adapting to stressful circumstances", "including work or a work like setting", "work-like setting"] },
    { label: "inability to establish && maintain effective relationships", phrases: ["inability to establish && maintain effective relationships"] },
  ]);

  const fifty = mhCount(text, [
    { label: "flattened affect", phrases: ["flattened affect"] },
    { label: "circumstantial/circumlocutory/stereotyped speech", phrases: ["circumstantial", "circumlocutory", "stereotyped speech"] },
    { label: "panic attacks more than once a week", phrases: ["panic attacks more than once a week"] },
    { label: "difficulty understanding complex commands", phrases: ["difficulty in understanding complex commands"] },
    { label: "memory impairment", phrases: ["impairment of short && long term memory", "mild memory loss", "retention of only highly learned material", "forgetting to complete tasks"] },
    { label: "impaired judgment", phrases: ["impaired judgment"] },
    { label: "impaired abstract thinking", phrases: ["impaired abstract thinking"] },
    { label: "disturbances of motivation && mood", phrases: ["disturbances of motivation && mood"] },
    { label: "difficulty establishing && maintaining effective work && social relationships", phrases: ["difficulty in establishing && maintaining effective work && social relationships"] },
  ]);

  const thirty = mhCount(text, [
    { label: "depressed mood", phrases: ["depressed mood"] },
    { label: "anxiety", phrases: ["anxiety"] },
    { label: "suspiciousness", phrases: ["suspiciousness"] },
    { label: "panic attacks weekly or less often", phrases: ["panic attacks that occur weekly or less often"] },
    { label: "chronic sleep impairment", phrases: ["chronic sleep impairment"] },
    { label: "mild memory loss", phrases: ["mild memory loss"] },
  ]);

  const ten = mhCount(text, [
    { label: "mild or transient symptoms", phrases: ["mild", "transient"] },
  ]);

  let estimatedRating = "0%";
  let confidence = "Low";
  let whyNotHigher = [];
  let reasoning = [];
  let evidenceNeeded = [];
  let nextSteps = [];
  let important = [];

  if (oneHundred.length >= 2) {
    estimatedRating = "100%";
    confidence = "Medium";
    reasoning = [
      "The extracted evidence contains multiple 100% mental-health indicators.",
      "The presentation suggests total occupational && social impairment may be in play."
    ];
    whyNotHigher = [];
  } else if (seventy.length >= 2 || (seventy.length >= 1 && fifty.length >= 2)) {
    estimatedRating = "70%";
    confidence = "Medium";
    reasoning = [
      "The extracted evidence supports deficiencies in most areas such as work, judgment, thinking, or mood.",
      "Multiple 70% indicators are present in the uploaded DBQ-style evidence."
    ];
    whyNotHigher = [
      "No strong 100% indicator cluster was established.",
      "The evidence does not clearly show total occupational && social impairment."
    ];
  } else if (fifty.length >= 2 || (fifty.length >= 1 && thirty.length >= 2)) {
    estimatedRating = "50%";
    confidence = "Medium";
    reasoning = [
      "The extracted evidence supports reduced reliability && productivity.",
      "Several 50% indicators are present."
    ];
    whyNotHigher = [
      "The evidence does not clearly establish the stronger 70% pattern.",
      "Higher-tier indicators like suicidal ideation, neglect of hygiene, or inability to maintain relationships were not established strongly enough."
    ];
  } else if (thirty.length >= 2) {
    estimatedRating = "30%";
    confidence = "Medium";
    reasoning = [
      "The extracted evidence supports occasional decrease in work efficiency with intermittent periods of inability to perform occupational tasks.",
      "The symptom cluster is more consistent with the 30% tier than the higher tiers."
    ];
    whyNotHigher = [
      "Weekly-plus panic, major relationship impairment, or higher-severity functional deficits were not established strongly enough."
    ];
  } else if (thirty.length >= 1 || ten.length >= 1) {
    estimatedRating = "10%";
    confidence = "Low";
    reasoning = [
      "The evidence shows mental-health symptoms, but the severity pattern is not yet well developed.",
      "The file supports at least mild functional impact, but not a confident higher tier."
    ];
    whyNotHigher = [
      "The extracted symptoms do not yet establish the stronger 30%, 50%, or 70% thresholds."
    ];
  } else {
    return {
      condition: "PTSD / Mental Health",
      diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
      estimatedRating: "0%",
      confidence: "Low",
      reasoning: "The image appears mental-health related, but the engine could not confidently score the symptom pattern.",
      evidenceNeeded: "A clearer DBQ, treatment notes, diagnosis history, && occupational/social impairment details are needed.",
      nextSteps: "Upload a clearer DBQ image && add diagnosis, treatment, && functional impact context.",
      important: "Final ratings depend on the total medical && service record, exam findings, && adjudicator review."
    };
  }

  const symptomSummary = uniq([
    ...oneHundred.map((x) => `100% indicator: ${x}`),
    ...seventy.map((x) => `70% indicator: ${x}`),
    ...fifty.map((x) => `50% indicator: ${x}`),
    ...thirty.map((x) => `30% indicator: ${x}`),
  ]);

  evidenceNeeded = [
    "Formal diagnosis && treatment history.",
    "Occupational && social impairment details.",
    "Therapy notes, DBQ pages, && medication history.",
    "Lay statements or work-impact evidence if available.",
    ...whyNotHigher.map((x) => `Gap to next tier: ${x}`)
  ];

  nextSteps = [
    "Upload all DBQ pages, not just symptoms.",
    "Add work impact, family/social impact, && frequency/duration details.",
    "Add treatment records, medication history, && provider notes.",
    "Add a personal statement describing daily functional impact."
  ];

  important = [
    "This engine estimates likely tiering from extracted symptoms only.",
    "The final rating depends on the complete record && VA adjudication.",
    ...symptomSummary.slice(0, 6)
  ];

  return {
    condition: "PTSD / Mental Health",
    diagnosticCode: "9411 / General Rating Formula for Mental Disorders",
    estimatedRating,
    confidence,
    reasoning: reasoning.join("\n- "),
    evidenceNeeded: evidenceNeeded.join("\n- "),
    nextSteps: nextSteps.join("\n- "),
    important: important.join("\n- ")
  };
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Arena routes
app.use("/arena/posts", arenaLimiter);
app.use("/arena/comments", arenaLimiter);

// ✅ PUBLIC ROUTE BYPASS (upgrade page)
app.use((req, res, next) => {
  if (req.path === "/upgrade" || req.path === "/upgrade.html") {
    return next();
  }
  next();
});

app.use("/arena", createArenaRouter(supabase));

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseAuth =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
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
const ACCESS_TOKEN_COOKIE_NAME = "access_token";

function setAccessTokenCookie(res, accessToken) {
  const isProd = process.env.NODE_ENV === "production";
  res.append(
    "Set-Cookie",
    ACCESS_TOKEN_COOKIE_NAME +
      "=" +
      encodeURIComponent(String(accessToken || "")) +
      "; Path=/; Max-Age=604800; SameSite=None; Secure" +
      (isProd ? "; Secure" : "")
  );
}

function clearAccessTokenCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.append(
    "Set-Cookie",
    ACCESS_TOKEN_COOKIE_NAME +
      "=; Path=/; Max-Age=0; SameSite=None; Secure" +
      (isProd ? "; Secure" : "")
  );
}
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
      "; HttpOnly; Path=/; SameSite=None; Secure" +
      (isProd ? "; Secure" : "")
  );
}

function clearAuthCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.setHeader(
    "Set-Cookie",
    AUTH_COOKIE_NAME +
      "=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure" +
      (isProd ? "; Secure" : "")
  );
}


function setAccessTokenCookie(res, accessToken) {
  if (!accessToken) return;
  const isProd = process.env.NODE_ENV === "production";
  res.append("Set-Cookie",
    "access_token=" +
      encodeURIComponent(accessToken) +
      "; Path=/; HttpOnly; SameSite=None; Secure" +
      (isProd ? "; Secure" : "")
  );
}

function clearAccessTokenCookie(res) {
  const isProd = process.env.NODE_ENV === "production";
  res.append("Set-Cookie",
    "access_token=; Path=/; HttpOnly; Max-Age=0; SameSite=None; Secure" +
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

    const authHeader = req.headers.authorization || "";

    let token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    if (!token) {
      token = decodeURIComponent(cookies["access_token"] || "");
    }

    if (!token) {
      return { user: null, error: "Missing bearer token" };
    }

    const response = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/user`,
      {
        headers: {
          apikey: process.env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
      }
    );

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
  try {
    let token = null;

    // 1. Authorization header
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      token = authHeader.replace("Bearer ", "").trim();
    }

    // 2. Cookie fallback
    if (!token) {
      token = req.cookies?.access_token || null;
    }

    if (!token) {
      
if (
  req.path === "/va/calc" ||
  req.path === "/upgrade" ||
  req.path === "/upgrade.html"
) {
  return next();
}

return res.status(401).json({
        success: false,
        error: "Unauthorized",
        user: null,
      });
    }

    const { data, error } = await supabaseAuth.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({
        success: false,
        error: "Invalid token",
        user: null,
      });
    }

    req.user = data.user;
    req.apiUser = data.user;
    return next();

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Auth failure",
      user: null,
    });
  }
}

// DISABLED OLD LOGIN


// =======================

// PUBLIC ROUTES
// =======================

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "build-logger-api" });
});

app.get("/login", (req, res) => {
  logVisit("login");
  track("login");
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

const accessToken =
  data?.session?.access_token ||
  data?.access_token ||
  null;

if (accessToken) {
  setAccessTokenCookie(res, accessToken);
}

console.log("ANALYZE_BASE64_VERSION: CLEAN_ROUTE_V1");
    
return res.json({
  success: true,

  // FREE
  estimated_rating: structured.estimatedRating,
  confidence: structured.confidence,
  claim_strength: structured.claim_strength || "Unknown",

  // LOCKED
  locked: true
});

  } catch (err) {
    console.log("WEB VA ANALYZE BASE64 ERROR:", err);
    return res.status(500).json({
      success: false,
      error: "VA analysis failed",
      details: err.message,
    });
  }
});

app.post("/va/analyze",  upload.single("image"), async (req, res) => {
  console.log("=== /va/analyze hit ===");
  try {
    const issue = String(req.body?.issue || "").trim();
    const serviceContext = String(req.body?.serviceContext || "").trim();

    console.log("issue:", issue);
    console.log("serviceContext:", serviceContext);
    console.log("file exists:", !!req.file);
    console.log("file info:", req.file ? {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      path: req.file.path,
      size: req.file.size
    } : null);

    if (!issue && !serviceContext && !req.file) {
      return res.status(400).json({
        error: "Provide text or upload an image"
      });
    }

    let visionExtract = "";

if ([].length > 0 && typeof extractVisionTextFromBase64 === "function") {
  const extractedPages = [];

  for (let i = 0; i < [].length; i++) {
    try {
      const pageText = String(
        (await extractVisionTextFromBase64([][i])) || ""
      ).trim();

      if (pageText) {
        extractedPages.push(`Page ${i + 1}:\n${pageText}`);
      }
    } catch (visionErr) {
      console.log(`BASE64 OCR ERROR PAGE ${i + 1}:`, visionErr.message);
    }
  }

  visionExtract = extractedPages.join("\n\n");
}
    if (req.file) {
      try {
        visionExtract = await extractVisionTextFromUpload(req.file, issue, serviceContext);
        console.log("visionExtract length:", visionExtract.length);
        console.log("visionExtract preview:", visionExtract.slice(0, 500));
      } catch (visionErr) {
        console.log("VISION EXTRACT ERROR:", visionErr.message);
        visionExtract = "";
      }
    }

    const input = [issue, serviceContext, visionExtract]
      .filter(Boolean)
      .join("\n\n");
      const result = analyzeCfr38(input);

    console.log("combined input length:", input.length);
    console.log("combined input preview:", input.slice(0, 800));


    console.log("analysis result preview:", String(result).slice(0, 800));

    function readSection(label) {
      const source = String(result || "");
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped + ":\\s*([\\s\\S]*?)(?=\\n(?:Condition|Diagnostic Code|Estimated VA Rating|Confidence|Reasoning|Evidence Still Needed|Next Steps|Important):|$)", "i");
      const match = source.match(regex);
      if (!match || !match[1]) return "N/A";
      return String(match[1]).trim().replace(/^[•-]\s*/gm, "").trim() || "N/A";
    }

    
const structured = {
      condition: readSection("Condition"),
      diagnosticCode: readSection("Diagnostic Code"),
      estimatedRating: readSection("Estimated VA Rating"),
      confidence: readSection("Confidence"),
      reasoning: readSection("Reasoning"),
      evidenceNeeded: readSection("Evidence Still Needed"),
      nextSteps: readSection("Next Steps"),
      important: readSection("Important")
    };

    const mhStructured = scoreMentalHealthDbq(visionExtract);
    if (mhStructured) {
      structured.condition = mhStructured.condition;
      structured.diagnosticCode = mhStructured.diagnosticCode;
      structured.estimatedRating = mhStructured.estimatedRating;
      structured.confidence = mhStructured.confidence;
      structured.reasoning = mhStructured.reasoning;
      structured.evidenceNeeded = mhStructured.evidenceNeeded;
      structured.nextSteps = mhStructured.nextSteps;
      structured.important = mhStructured.important;
    }

    console.log("structured:", structured);

    return res.json({
      success: true,
      likelihood:
        structured.estimatedRating && structured.estimatedRating !== "N/A"
          ? structured.estimatedRating
          : "See analysis",
      summary: result,
      structured,
      visionExtract,
      disclaimer:
        "This tool provides an estimate only. Final VA decisions are made by the VA."
    });
  } catch (err) {
    console.log("MOBILE VA ANALYZE ERROR:", err);
    return res.status(500).json({
      error: "VA analysis failed",
      details: err.message
    });
  } finally {
    try {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
        console.log("temp upload deleted:", req.file.path);
      }
    } catch (cleanupErr) {
      console.log("UPLOAD CLEANUP ERROR:", cleanupErr.message);
    }
  }
});








// Serve frontend static files

// PUBLIC UPGRADE PAGE (no auth)
app.get("/upgrade", (req, res) => {
  res.sendFile(require("path").join(__dirname, "public", "upgrade.html"));
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  return res.redirect("/signup");
});

// Frontend catch-all route

app.post("/va/calc", (req, res) => {
  console.log("VA CALC ROUTE HIT CLEAN");

  try {
    const { ratings = [], left = [], right = [] } = req.body || {};

    function combineRatings(items) {
      const sorted = [...items]
        .map(Number)
        .filter((n) => !Number.isNaN(n))
        .sort((a, b) => b - a);

      let combined = 0;
      for (const r of sorted) {
        combined = combined + (100 - combined) * (r / 100);
      }
      return combined;
    }

    function roundVA(value) {
      return Math.floor((value + 5) / 10) * 10;
    }

    function applyBilateral(leftRatings, rightRatings) {
      if (!leftRatings.length || !rightRatings.length) return 0;
      const combined = combineRatings([...leftRatings, ...rightRatings]);
      return combined + (combined * 0.10);
    }

    
    
        function estimateMonthlyFull(finalRate, opts = {}) {
      const spouse = !!opts.spouse;
      const parents = Number(opts.parents || 0);
      const childUnder18 = Number(opts.child_under_18 || 0);
      const childSchool = Number(opts.child_school || 0);
      const spouseAid = !!opts.spouse_aid;

      const rate = Number(finalRate || 0);

      if (rate === 10) return 180.42;
      if (rate === 20) return 356.66;

      const baseNoChildren = {
        30: { alone: 552.47, spouse: 617.47, spouse1p: 669.47, spouse2p: 721.47, parent1: 604.47, parent2: 656.47, spouseAid: 61.00 },
        40: { alone: 795.84, spouse: 882.84, spouse1p: 952.84, spouse2p: 1022.84, parent1: 865.84, parent2: 935.84, spouseAid: 81.00 },
        50: { alone: 1132.90, spouse: 1241.90, spouse1p: 1329.90, spouse2p: 1417.90, parent1: 1220.90, parent2: 1308.90, spouseAid: 101.00 },
        60: { alone: 1435.02, spouse: 1566.02, spouse1p: 1671.02, spouse2p: 1776.02, parent1: 1540.02, parent2: 1645.02, spouseAid: 121.00 },
        70: { alone: 1808.45, spouse: 1961.45, spouse1p: 2084.45, spouse2p: 2207.45, parent1: 1931.45, parent2: 2054.45, spouseAid: 141.00 },
        80: { alone: 2102.15, spouse: 2277.15, spouse1p: 2417.15, spouse2p: 2557.15, parent1: 2242.15, parent2: 2382.15, spouseAid: 161.00 },
        90: { alone: 2362.30, spouse: 2559.30, spouse1p: 2717.30, spouse2p: 2875.30, parent1: 2520.30, parent2: 2678.30, spouseAid: 181.00 },
        100:{ alone: 3938.58, spouse: 4158.17, spouse1p: 4334.41, spouse2p: 4510.65, parent1: 4114.82, parent2: 4291.06, spouseAid: 201.41 }
      };

      const baseWithChild = {
        30: { childOnly: 596.47, spouse: 666.47, spouse1p: 718.47, spouse2p: 770.47, parent1: 648.47, parent2: 700.47, addU18: 32.00, addSchool: 105.00, spouseAid: 61.00 },
        40: { childOnly: 853.84, spouse: 947.84, spouse1p: 1017.84, spouse2p: 1087.84, parent1: 923.84, parent2: 993.84, addU18: 43.00, addSchool: 140.00, spouseAid: 81.00 },
        50: { childOnly: 1205.90, spouse: 1322.90, spouse1p: 1410.90, spouse2p: 1498.90, parent1: 1293.90, parent2: 1381.90, addU18: 54.00, addSchool: 176.00, spouseAid: 101.00 },
        60: { childOnly: 1523.02, spouse: 1663.02, spouse1p: 1768.02, spouse2p: 1873.02, parent1: 1628.02, parent2: 1733.02, addU18: 65.00, addSchool: 211.00, spouseAid: 121.00 },
        70: { childOnly: 1910.45, spouse: 2074.45, spouse1p: 2197.45, spouse2p: 2320.45, parent1: 2033.45, parent2: 2156.45, addU18: 76.00, addSchool: 246.00, spouseAid: 141.00 },
        80: { childOnly: 2219.15, spouse: 2406.15, spouse1p: 2546.15, spouse2p: 2686.15, parent1: 2359.15, parent2: 2499.15, addU18: 87.00, addSchool: 281.00, spouseAid: 161.00 },
        90: { childOnly: 2494.30, spouse: 2704.30, spouse1p: 2862.30, spouse2p: 3020.30, parent1: 2652.30, parent2: 2810.30, addU18: 98.00, addSchool: 317.00, spouseAid: 181.00 },
        100:{ childOnly: 4085.43, spouse: 4318.99, spouse1p: 4495.23, spouse2p: 4671.47, parent1: 4261.67, parent2: 4437.91, addU18: 109.11, addSchool: 352.45, spouseAid: 201.41 }
      };

      if (![30,40,50,60,70,80,90,100].includes(rate)) return 0;

      const hasAnyChild = (childUnder18 + childSchool) > 0;
      let total = 0;

      if (!hasAnyChild) {
        const row = baseNoChildren[rate];
        if (spouse && parents === 2) total = row.spouse2p;
        else if (spouse && parents === 1) total = row.spouse1p;
        else if (spouse) total = row.spouse;
        else if (parents === 2) total = row.parent2;
        else if (parents === 1) total = row.parent1;
        else total = row.alone;

        if (spouse && spouseAid) total += row.spouseAid;
        return Number(total.toFixed(2));
      }

      const row = baseWithChild[rate];

      if (spouse && parents === 2) total = row.spouse2p;
      else if (spouse && parents === 1) total = row.spouse1p;
      else if (spouse) total = row.spouse;
      else if (parents === 2) total = row.parent2;
      else if (parents === 1) total = row.parent1;
      else total = row.childOnly;

      const extraUnder18 = Math.max(0, childUnder18 - 1);
      total += extraUnder18 * row.addU18;
      total += childSchool * row.addSchool;

      if (spouse && spouseAid) total += row.spouseAid;

      return Number(total.toFixed(2));
    }

function neededForNext(totalValue) {
      const currentTier = Math.floor((totalValue + 5) / 10) * 10;
      const nextTier = currentTier + 10;

      if (nextTier > 100) return null;

      for (let r = 10; r <= 100; r += 10) {
        const test = combineRatings([totalValue, r]);
        const rounded = Math.floor((test + 5) / 10) * 10;
        if (rounded >= nextTier) return r;
      }
      return null;
    }

    let total = 0;

    if (left.length && right.length) {
      const bilateralValue = applyBilateral(left, right);
      const used = [...left, ...right].map(Number);
      const remaining = ratings.map(Number);
      for (const u of used) {
        const idx = remaining.indexOf(u);
        if (idx !== -1) remaining.splice(idx, 1);
      }

      total = combineRatings([bilateralValue, ...remaining]);
    } else {
      total = combineRatings(ratings);
    }

    return res.json({
      success: true,
      raw: Number(total.toFixed(2)),
      final: roundVA(total),
      next_needed: neededForNext(total),
      monthly_estimate: estimateMonthlyFull(roundVA(total), {
      spouse: req.body?.spouse,
      parents: req.body?.parents,
      child_under_18: req.body?.child_under_18,
      child_school: req.body?.child_school,
      spouse_aid: req.body?.spouse_aid,
    }),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "VA calc failed",
    });
  }
});



app.post("/lead", async (req, res) => {
  try {
    const { email, data } = req.body || {};

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email required"
      });
    }

    const payload = {
      email: String(email).trim(),
      claim_data: data || {},
      created_at: new Date().toISOString()
    };

    const { error } = await supabaseAdmin
      .from("leads")
      .insert(payload);

    if (error) {
      console.log("LEAD INSERT ERROR:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to save lead"
      });
    }

    return res.json({
      success: true
    });
  } catch (err) {
    console.log("LEAD ROUTE ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Lead save failed"
    });
  }
});


function getClaimSources(condition, claimType) {
  const sources = [
    {
      label: "General rating rules",
      citation: "38 C.F.R. §§ 4.1, 4.2, 4.3, 4.6, 4.7",
      url: "https://www.ecfr.gov/current/title-38/chapter-I/part-4/subpart-A"
    }
  ];

  const c = String(condition || "").toLowerCase();
  const ct = String(claimType || "").toLowerCase();

  if (c.includes("back") || c.includes("lumbar") || c.includes("spine") || c.includes("knee") || c.includes("shoulder")) {
    sources.push({
      label: "Musculoskeletal ratings",
      citation: "38 C.F.R. § 4.71a",
      url: "https://www.ecfr.gov/current/title-38/chapter-I/part-4/subpart-B/subject-group-ECFRd3005f7d828ea7b/section-4.71a"
    });
    sources.push({
      label: "Functional loss / joints",
      citation: "38 C.F.R. §§ 4.40, 4.45, 4.46, 4.59",
      url: "https://www.ecfr.gov/current/title-38/chapter-I/part-4"
    });
  }

  if (c.includes("radiculopathy") || c.includes("sciatica") || c.includes("numbness") || c.includes("tingling") || c.includes("nerve")) {
    sources.push({
      label: "Neurological ratings",
      citation: "38 C.F.R. § 4.124a",
      url: "https://www.ecfr.gov/current/title-38/chapter-I/part-4/subpart-B/subject-group-ECFRab3ca55f4548afe/section-4.124a"
    });
  }

  if (c.includes("mental health") || c.includes("ptsd") || c.includes("anxiety") || c.includes("depression") || c.includes("panic")) {
    sources.push({
      label: "Mental disorders",
      citation: "38 C.F.R. § 4.130",
      url: "https://www.ecfr.gov/current/title-38/chapter-I/part-4"
    });
  }

  if (c.includes("sleep apnea") || c.includes("osa") || c.includes("cpap")) {
    sources.push({
      label: "Respiratory ratings",
      citation: "38 C.F.R. § 4.97",
      url: "https://www.ecfr.gov/current/title-38/chapter-I/part-4"
    });
  }

  if (c.includes("tinnitus") || c.includes("hearing")) {
    sources.push({
      label: "Hearing impairment",
      citation: "38 C.F.R. § 4.85",
      url: "https://www.ecfr.gov/current/title-38/chapter-I/part-4"
    });
    sources.push({
      label: "Ear ratings",
      citation: "38 C.F.R. § 4.87",
      url: "https://www.ecfr.gov/current/title-38/chapter-I/part-4"
    });
  }

  if (c.includes("secondary") || ct.includes("secondary") || ct.includes("aggravation")) {
    sources.push({
      label: "Aggravation / analogous / general rules",
      citation: "38 C.F.R. §§ 4.20, 4.21, 4.22",
      url: "https://www.ecfr.gov/current/title-38/chapter-I/part-4/subpart-A"
    });
  }

  return sources;
}

function analyzeClaim(data) {
  const rawCondition = String(data.condition || "").trim();
  const text = rawCondition.toLowerCase();

  const explicitServiceEvent = !!data.explicitServiceEvent;
  const explicitDiagnosis = !!data.explicitDiagnosis;
  const explicitNexus = !!data.explicitNexus;
  const selectedSeverity = data.severity || "moderate";

  function hasAny(words) {
    return words.some(word => text.includes(word));
  }

  let condition = "General Condition";
  if (hasAny(["lower back", "back pain", "lumbar", "spine", "radiculopathy", "sciatica"])) {
    condition = "Lumbar / Back Condition";
  } else if (hasAny(["migraine", "migraines", "headache", "headaches", "prostrating"])) {
    condition = "Migraines / Headaches";
  } else if (hasAny(["ptsd", "anxiety", "depression", "panic", "mental health", "insomnia", "nightmares"])) {
    condition = "Mental Health Condition";
  } else if (hasAny(["knee", "knees"])) {
    condition = "Knee Condition";
  } else if (hasAny(["shoulder"])) {
    condition = "Shoulder Condition";
  } else if (hasAny(["sleep apnea", "osa", "cpap"])) {
    condition = "Sleep Apnea";
  } else if (hasAny(["tinnitus", "hearing loss", "ringing in ears"])) {
    condition = "Tinnitus / Hearing Loss";
  } else if (hasAny(["gerd", "reflux", "acid reflux", "stomach", "gi", "ibs"])) {
    condition = "GI / GERD Condition";
  }

  const textServiceEvent = hasAny([
    "in service", "while in service", "active duty", "deployment", "deployed",
    "training", "field exercise", "combat", "mos", "ruck", "lifted", "injury",
    "hurt", "service treatment record", "line of duty", "during service"
  ]);

  const textDiagnosis = hasAny([
    "diagnosed", "diagnosis", "doctor", "provider", "pcp", "orthopedic",
    "mri", "x-ray", "xray", "ct scan", "medical record", "treatment", "therapy", "cpap"
  ]);

  const textNexus = hasAny([
    "nexus", "medical opinion", "linked to", "secondary to", "caused by",
    "due to", "result of", "aggravated by"
  ]);

  let claim_type = "Unclear";
  if (hasAny(["secondary to", "due to", "caused by", "result of", "aggravated by"])) {
    claim_type = "Secondary / Aggravation Theory";
  } else if (explicitServiceEvent || textServiceEvent) {
    claim_type = "Likely Direct";
  }

  const severeSignals = hasAny([
    "severe", "daily", "constant", "flare", "flare-up", "flare up",
    "miss work", "can't work", "cannot work", "prostrating", "panic attacks",
    "suicidal", "radiculopathy", "numbness", "tingling", "limited motion",
    "can't bend", "cannot bend", "cpap", "bed rest"
  ]);

  const moderateSignals = hasAny([
    "moderate", "weekly", "monthly", "recurring", "pain", "stiffness",
    "spasms", "anxiety", "sleep issues", "headaches", "reflux"
  ]);

  const hasServiceEvent = explicitServiceEvent || textServiceEvent;
  const hasDiagnosis = explicitDiagnosis || textDiagnosis;
  const hasNexus = explicitNexus || textNexus;

  let severity = selectedSeverity;
  if (severeSignals) severity = "severe";
  else if (moderateSignals && severity !== "severe") severity = "moderate";

  let service_connection = "Weak";
  let confidence = "Low";

  if (hasServiceEvent && hasDiagnosis && hasNexus) {
    service_connection = "Strong";
    confidence = "High";
  } else if (hasServiceEvent && hasDiagnosis) {
    service_connection = "Possible";
    confidence = "Medium";
  } else if (hasDiagnosis || hasServiceEvent) {
    service_connection = "Weak to Possible";
    confidence = "Low";
  }

  let estimated_rating = "0–10%";

  if (condition === "Lumbar / Back Condition") {
    const backSevere = hasAny(["radiculopathy", "numbness", "tingling", "can't bend", "cannot bend", "limited motion"]);
    if (severity === "severe" || backSevere) estimated_rating = "20–40%";
    else if (severity === "moderate") estimated_rating = "10–20%";
    else estimated_rating = "0–10%";
  } else if (condition === "Migraines / Headaches") {
    const migraineSevere = hasAny(["prostrating", "lie down", "dark room", "vomit", "nausea", "miss work"]);
    if (severity === "severe" || migraineSevere) estimated_rating = "30–50%";
    else if (severity === "moderate") estimated_rating = "10–30%";
    else estimated_rating = "0–10%";
  } else if (condition === "Mental Health Condition") {
    const mhSevere = hasAny(["panic attacks", "isolation", "can't work", "cannot work", "suicidal", "nightmares", "hypervigilance"]);
    if (severity === "severe" || mhSevere) estimated_rating = "50–70%";
    else if (severity === "moderate") estimated_rating = "30–50%";
    else estimated_rating = "0–10%";
  } else if (condition === "Sleep Apnea") {
    estimated_rating = text.includes("cpap") ? "50%" : "0–30%";
  } else if (condition === "Tinnitus / Hearing Loss") {
    estimated_rating = "10%";
  } else {
    if (severity === "severe") estimated_rating = "30–50%";
    else if (severity === "moderate") estimated_rating = "10–30%";
    else estimated_rating = "0–10%";
  }

  const helping_factors = [];
  const hurting_factors = [];
  const missing = [];
  const next_steps = [];

  if (hasServiceEvent) helping_factors.push("Narrative suggests some service-related onset or event support");
  else {
    hurting_factors.push("Narrative does not clearly establish when or how this began in service");
    missing.push("Clear in-service event, onset, or service evidence");
  }

  if (hasDiagnosis) helping_factors.push("Narrative suggests diagnosis and/or current treatment support");
  else {
    hurting_factors.push("No clear diagnosis or treatment evidence is coming through");
    missing.push("Current diagnosis from a medical provider");
  }

  if (hasNexus) helping_factors.push("Narrative suggests a nexus or secondary-link theory");
  else {
    hurting_factors.push("No clear nexus or medical link is coming through");
    missing.push("Nexus letter or medical opinion linking the condition");
  }

  if (!hasServiceEvent) {
    next_steps.push("Gather service treatment records, incident records, buddy statements, or a personal statement showing when this started");
  }
  if (!hasDiagnosis) {
    next_steps.push("Get a current diagnosis and make sure it is clearly documented in your medical records");
  }
  if (!hasNexus) {
    next_steps.push("Get a nexus letter connecting the condition to service or to a service-connected condition");
  }

  if (condition === "Lumbar / Back Condition") {
    next_steps.push("Document range-of-motion limits, flare-ups, numbness, tingling, radiculopathy, and how bending/lifting affect daily life");
  } else if (condition === "Migraines / Headaches") {
    next_steps.push("Track frequency, duration, prostrating attacks, nausea, light sensitivity, and missed work");
  } else if (condition === "Mental Health Condition") {
    next_steps.push("Document work impairment, social isolation, panic, sleep problems, concentration issues, and treatment history");
  } else if (condition === "Sleep Apnea") {
    next_steps.push("Document sleep study results, diagnosis, and CPAP prescription if applicable");
  }

  next_steps.push("Prepare for the C&P exam and describe your worst days, frequency, flare-ups, and work/life impact without minimizing symptoms");

  const biggest_lever = !hasNexus
    ? "A nexus letter is the biggest thing that could strengthen this claim."
    : !hasDiagnosis
    ? "A clear current diagnosis is the biggest missing piece."
    : "Strong detail about severity, flare-ups, and functional loss will most affect the outcome.";

  const whyParts = [
    hasServiceEvent ? "There are signs of service-connection support." : "Service-connection support looks limited.",
    hasDiagnosis ? "There are signs of current diagnosis or treatment." : "Diagnosis support looks weak.",
    hasNexus ? "There are signs of a nexus or secondary theory." : "Nexus support looks weak.",
    `The narrative suggests ${severity} severity.`,
    `This looks most like a ${claim_type.toLowerCase()} claim.`
  ];

  const cp_advice = "At the C&P exam, explain your worst days, how often symptoms happen, what they stop you from doing, and do not minimize pain, flare-ups, or functional loss.";

  return {
    condition,
    claim_type,
    service_connection,
    estimated_rating,
    confidence,
    why: whyParts.join(" "),
    claim_strength: (function() {
      if (!explicitDiagnosis) return "Weak (High Risk of Denial)";
      if (explicitDiagnosis && !explicitNexus) return "Moderate (Borderline Approval)";
      if (explicitDiagnosis && explicitNexus) return "Strong (Likely Approval)";
      return "Moderate";
    })(),

    decision_outlook: (function() {
      if (!explicitDiagnosis) return "This claim would likely be denied due to lack of a confirmed diagnosis.";
      if (!explicitNexus) return "This claim may be delayed or rated lower due to missing nexus evidence.";
      return "This claim is positioned well for approval if documentation is consistent.";
    })(),

    top_issues: (function() {
      const issues = [];
      if (!explicitDiagnosis) issues.push("No confirmed current diagnosis (required for approval)");
      if (!explicitServiceEvent) issues.push("No clear in-service event or documentation");
      if (!explicitNexus) issues.push("No medical nexus linking condition to service");
      return issues.slice(0,3);
    })(),

    fastest_improvement: (function() {
      if (!explicitDiagnosis) return "Get a confirmed medical diagnosis documented in your records.";
      if (!explicitNexus) return "Obtain a basic medical opinion linking your condition to service.";
      return "Strengthen documentation of severity and functional impact.";
    })(),
    helping_factors,
    hurting_factors,
    biggest_lever,
    missing,
    next_steps,
    cp_advice,
    sources: getClaimSources(condition, claim_type)
  };
}


app.post("/analyze", async (req, res) => {
  try {
    const body = req.body || {};

    let condition = String(body.condition || "").trim();
    if (!condition) {
      condition = "General condition";
    }

    const explicitServiceEvent = !!body.in_service_event;
    const explicitDiagnosis = !!body.current_diagnosis;
    const explicitNexus = !!body.nexus_letter;

    const result = analyzeClaim({
      condition,
      explicitServiceEvent,
      explicitDiagnosis,
      explicitNexus,
      severity: body.severity || "moderate"
    });

    return res.json({
      success: true,
      result
    });
  } catch (err) {
    console.log("ANALYZE ROUTE ERROR:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Analyze failed"
    });
  }
});


app.post("/track", (req, res) => {
  try {
    const payload = {
      event: req.body?.event || "unknown",
      data: req.body?.data || {},
      time: new Date().toISOString(),
      ip:
        req.headers["x-forwarded-for"] ||
        req.socket?.remoteAddress ||
        "",
      ua: req.headers["user-agent"] || ""
    };

    console.log("TRACK EVENT:", JSON.stringify(payload));
    return res.json({ success: true });
  } catch (err) {
    console.log("TRACK ERROR:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});


app.get("/arena/top", async (req, res) => {
  try {
    const { data: posts, error } = await supabase
      .from("arena_posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const { data: answers, error: answersError } = await supabase
      .from("arena_answers")
      .select("*");

    if (answersError) throw answersError;

    const { data: bets, error: betsError } = await supabase
      .from("arena_bets")
      .select("*");

    if (betsError) throw betsError;

    const byPostAnswers = {};
    for (const a of answers || []) {
      if (!byPostAnswers[a.post_id]) byPostAnswers[a.post_id] = [];
      byPostAnswers[a.post_id].push(a);
    }

    const byPostBets = {};
    for (const b of bets || []) {
      if (!byPostBets[b.post_id]) byPostBets[b.post_id] = [];
      byPostBets[b.post_id].push(b);
    }

    const scored = (posts || []).map((post) => {
      const ans = byPostAnswers[post.id] || [];
      const postBets = byPostBets[post.id] || [];
      const ageHours = (Date.now() - new Date(post.created_at).getTime()) / 3600000;

      let score = 0;
      score += ans.length * 2;
      score += (post.views || 0) * 0.2;
      score += postBets.length * 3;
      score += Math.max(0, 24 - ageHours);

      return {
        ...post,
        answers: ans,
        bets: postBets.length,
        score
      };
    });

    scored.sort((a, b) => b.score - a.score);

    return res.json({
      success: true,
      post: scored[0] || null
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
});




app.post("/arena/view/:id", async (req, res) => {
  try {
    const postId = req.params.id;

    const { data: post, error: fetchError } = await supabase
      .from("arena_posts")
      .select("id, views")
      .eq("id", postId)
      .single();

    if (fetchError) throw fetchError;

    const nextViews = (post?.views || 0) + 1;

    const { error: updateError } = await supabase
      .from("arena_posts")
      .update({ views: nextViews })
      .eq("id", postId);

    if (updateError) throw updateError;

    return res.json({ success: true, views: nextViews });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});



app.post("/arena/bet", async (req, res) => {
  try {
    const { post_id, direction = "up", amount = 1, user_id = null } = req.body || {};

    if (!post_id) {
      return res.status(400).json({ success: false, error: "post_id is required" });
    }

    const { data, error } = await supabase
      .from("arena_bets")
      .insert([{
        post_id,
        direction,
        amount,
        user_id
      }])
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, bet: data });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});




app.get("/arena/top-va", async (req, res) => {
  try {
    const { data: posts, error } = await supabase
      .from("arena_posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const { data: answers, error: answersError } = await supabase
      .from("arena_answers")
      .select("*");

    if (answersError) throw answersError;

    const { data: bets, error: betsError } = await supabase
      .from("arena_bets")
      .select("*");

    if (betsError) throw betsError;

    const byPostAnswers = {};
    for (const a of answers || []) {
      if (!byPostAnswers[a.post_id]) byPostAnswers[a.post_id] = [];
      byPostAnswers[a.post_id].push(a);
    }

    const byPostBets = {};
    for (const b of bets || []) {
      if (!byPostBets[b.post_id]) byPostBets[b.post_id] = [];
      byPostBets[b.post_id].push(b);
    }

    function isVAPost(post) {
      const t = ((post.title || "") + " " + (post.body || "")).toLowerCase();
      const keywords = [
        "va", "claim", "service", "deployment", "military", "ptsd",
        "tinnitus", "migraines", "headaches", "back pain", "sleep apnea",
        "anxiety", "depression", "disability", "rating", "dbq"
      ];
      return keywords.some(k => t.includes(k));
    }

    function hasStrongVAAnswer(post) {
  const a = (byPostAnswers[post.id] || [])[0];
  const r = (a?.reasoning || "").toLowerCase();

  return (
    r.includes("va rating") ||
    r.includes("likely va rating") ||
    r.includes("service connection") ||
    r.includes("diagnostic code") ||
    r.includes("confidence")
  );
}

    const scored = (posts || [])
      .filter(post => isVAPost(post) && hasStrongVAAnswer(post))
      .map((post) => {
        const ans = byPostAnswers[post.id] || [];
        const postBets = byPostBets[post.id] || [];
        const ageHours = (Date.now() - new Date(post.created_at).getTime()) / 3600000;

        let score = 0;
        score += ans.length * 2;
        score += (post.views || 0) * 0.2;
        score += postBets.reduce((sum, b) => sum + (b.amount || 0), 0);
        score += Math.max(0, 24 - ageHours);

        return {
          ...post,
          answers: ans,
          bets: postBets.length,
          total_stake: postBets.reduce((sum, b) => sum + (b.amount || 0), 0),
          score
        };
      });

    scored.sort((a, b) => b.score - a.score);

    return res.json({
      success: true,
      post: scored[0] || null
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

app.listen(PORT, function () {
  console.log("Build Logger API running on port " + PORT);
});



app.post("/va/analyze-base64", async (req, res) => {
  try {
    const { issue } = req.body;

    console.log("=== /va/analyze hit ===", issue);

    return res.json({
      success: true,
      result: {
        condition: issue,
        estimatedRating: "10–30%",
        confidence: "Low",
        strength: "Weak (High Risk of Denial)",
        why: "Limited supporting evidence.",
        missing: [
          "Confirmed diagnosis",
          "Service connection",
          "Nexus letter"
        ],
        nextSteps: [
          "Get diagnosis",
          "Gather records",
          "Obtain nexus letter"
        ]
      }
    });

  } catch (err) {
    console.log("❌ ANALYZE ERROR:", err);
    res.status(500).json({ success: false });
  }
});
