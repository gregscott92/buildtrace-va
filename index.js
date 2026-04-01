require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { runFivePassPipeline } = require("./lib/ai-pipeline");
const { finalizePost, choosePersona } = require("./lib/persona");

const OUTPUT_DIR = "outputs";
const INPUT_FILE = "input.txt";
const QUEUE_DIR = "queue";
const ACCOUNTS_DIR = "accounts";
const ACCOUNTS_FILE = path.join(ACCOUNTS_DIR, "accounts.json");
const queueFile = path.join(QUEUE_DIR, "posts.json");
const driftFile = path.join(QUEUE_DIR, "drift.json");

// =======================
// HELPERS
// =======================

function ensureFolder(folder) {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

function writeTextFile(filePath, content) {
  fs.writeFileSync(filePath, content ?? "", "utf-8");
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, "utf-8");
}

function safeTrim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function createHash(value) {
  return crypto.createHash("sha256").update(safeTrim(value)).digest("hex");
}

function parseBooleanEnv(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function extractSection(text, section) {
  const regex = new RegExp(
    `===\\s*${section}\\s*===([\\s\\S]*?)(?=^===\\s*.+\\s*===|$)`,
    "im"
  );
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}

function extractSocialPost(output, label, nextLabel = null) {
  const safeOutput = output || "";
  const startToken = `${label}:`;
  const startIndex = safeOutput.indexOf(startToken);

  if (startIndex === -1) {
    return "";
  }

  const contentStart = startIndex + startToken.length;

  if (!nextLabel) {
    return safeOutput.slice(contentStart).trim();
  }

  const endToken = `${nextLabel}:`;
  const endIndex = safeOutput.indexOf(endToken, contentStart);

  if (endIndex === -1) {
    return safeOutput.slice(contentStart).trim();
  }

  return safeOutput.slice(contentStart, endIndex).trim();
}

// =======================
// ACCOUNT SYSTEM
// =======================

function ensureAccountsFile() {
  ensureFolder(ACCOUNTS_DIR);

  if (!fs.existsSync(ACCOUNTS_FILE)) {
    const starter = {
      default_x_account_label: "main",
      x_accounts: [
        {
          label: "main",
          display_name: "Greg Main X",
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
    };

    writeJsonFile(ACCOUNTS_FILE, starter);
  }
}

function readAccounts() {
  ensureAccountsFile();

  try {
    const raw = readTextFile(ACCOUNTS_FILE).trim();

    if (!raw) {
      return {
        default_x_account_label: "main",
        x_accounts: [],
      };
    }

    const parsed = JSON.parse(raw);

    return {
      default_x_account_label: parsed.default_x_account_label || "main",
      x_accounts: Array.isArray(parsed.x_accounts) ? parsed.x_accounts : [],
    };
  } catch (error) {
    console.error("Accounts file is invalid JSON.");
    return {
      default_x_account_label: "main",
      x_accounts: [],
    };
  }
}

function getDefaultXAccount() {
  const accounts = readAccounts();
  const defaultLabel = accounts.default_x_account_label;

  return (
    accounts.x_accounts.find(
      (item) => item.label === defaultLabel && item.active !== false
    ) ||
    accounts.x_accounts.find((item) => item.active !== false) ||
    null
  );
}

function getXAccountByLabel(label) {
  const accounts = readAccounts();

  return (
    accounts.x_accounts.find(
      (item) => item.label === label && item.active !== false
    ) || null
  );
}

function resolveSelectedXAccountLabel() {
  const requestedLabel = safeTrim(process.env.SELECTED_X_ACCOUNT_LABEL);

  if (requestedLabel) {
    const requestedAccount = getXAccountByLabel(requestedLabel);

    if (!requestedAccount) {
      throw new Error(
        `Requested X account label "${requestedLabel}" was not found or is inactive in ${ACCOUNTS_FILE}`
      );
    }

    return requestedAccount.label;
  }

  const defaultAccount = getDefaultXAccount();

  if (!defaultAccount) {
    throw new Error(`No active X accounts found in ${ACCOUNTS_FILE}`);
  }

  return defaultAccount.label;
}

function listActiveXAccountLabels() {
  const accounts = readAccounts();
  return accounts.x_accounts
    .filter((item) => item.active !== false)
    .map((item) => item.label);
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

function validateSelectedXAccountCredentials(accountCredentials) {
  if (!accountCredentials) {
    throw new Error("Selected X account credentials could not be resolved.");
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

function writeAccountManifest({
  selectedAccountLabel,
  selectedAccountCredentials,
  credentialStatus,
  forceRequeue,
}) {
  ensureFolder(OUTPUT_DIR);

  const manifest = {
    generated_at: new Date().toISOString(),
    selected_x_account_label: selectedAccountLabel,
    selected_x_handle: selectedAccountCredentials?.handle || "",
    selected_x_display_name: selectedAccountCredentials?.display_name || "",
    active_x_accounts: listActiveXAccountLabels(),
    force_requeue: forceRequeue,
    x_credential_status: credentialStatus,
  };

  writeJsonFile(path.join(OUTPUT_DIR, "account-manifest.json"), manifest);
}

function writePostingReadinessReport({
  selectedAccountLabel,
  selectedAccountCredentials,
  credentialStatus,
}) {
  ensureFolder(OUTPUT_DIR);

  const report = {
    generated_at: new Date().toISOString(),
    selected_x_account_label: selectedAccountLabel,
    selected_x_handle: selectedAccountCredentials?.handle || "",
    x_posting_ready: credentialStatus.isReady,
    missing_env_vars: credentialStatus.missingEnvVars || [],
  };

  writeJsonFile(path.join(OUTPUT_DIR, "posting-readiness.json"), report);
}

// =======================
// QUEUE SYSTEM
// =======================

function ensureQueueFile() {
  ensureFolder(QUEUE_DIR);

  if (!fs.existsSync(queueFile)) {
    writeJsonFile(queueFile, { queue: [] });
  }
}

function readQueue() {
  ensureQueueFile();

  const raw = readTextFile(queueFile).trim();

  if (!raw) {
    return { queue: [] };
  }

  try {
    const parsed = JSON.parse(raw);

    if (!parsed.queue || !Array.isArray(parsed.queue)) {
      return { queue: [] };
    }

    return parsed;
  } catch (error) {
    console.error("Queue file is invalid JSON. Resetting queue in memory.");
    return { queue: [] };
  }
}

function saveQueue(data) {
  writeJsonFile(queueFile, data);
}

function createQueueItem(
  platform,
  content,
  delayMinutes = 0,
  sourceInputHash = null,
  options = {}
) {
  const now = new Date();
  const scheduledFor = new Date(
    now.getTime() + delayMinutes * 60000
  ).toISOString();

  const accountLabel =
    safeTrim(options.accountLabel) || resolveSelectedXAccountLabel();

  return {
    id: crypto.randomUUID(),
    platform,
    account_label: accountLabel,
    content,
    content_hash: createHash(content),
    source_input_hash: sourceInputHash,
    persona: safeTrim(options.persona) || "operator",
    post_mode: safeTrim(options.postMode) || "build_log",
    generated_version: safeTrim(options.generatedVersion) || "v4",
    humanized: options.humanized !== false,
    status: "pending",
    review_status: "none",
    risk_summary: "",
    recommended_action: "",
    created_at: now.toISOString(),
    scheduled_for: scheduledFor,
    archived_at: null,
    investigated_at: null,
    override_posted_at: null,
  };
}

function writeQueueSummary() {
  ensureFolder(OUTPUT_DIR);
  const data = readQueue();

  const counts = {
    total: data.queue.length,
    pending: 0,
    posted: 0,
    archived: 0,
    investigated: 0,
    override: 0,
  };

  const byPlatform = {};
  const byAccount = {};
  const byPersona = {};
  const byPostMode = {};

  for (const item of data.queue) {
    if (item.status === "pending") counts.pending += 1;
    if (item.status === "posted") counts.posted += 1;
    if (item.archived_at) counts.archived += 1;
    if (item.investigated_at) counts.investigated += 1;
    if (item.review_status === "override") counts.override += 1;

    byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
    byAccount[item.account_label] = (byAccount[item.account_label] || 0) + 1;
    byPersona[item.persona || "operator"] =
      (byPersona[item.persona || "operator"] || 0) + 1;
    byPostMode[item.post_mode || "build_log"] =
      (byPostMode[item.post_mode || "build_log"] || 0) + 1;
  }

  const summary = {
    generated_at: new Date().toISOString(),
    counts,
    by_platform: byPlatform,
    by_account: byAccount,
    by_persona: byPersona,
    by_post_mode: byPostMode,
    last_10_items: data.queue.slice(-10).reverse(),
  };

  writeJsonFile(path.join(OUTPUT_DIR, "queue-summary.json"), summary);
}

// =======================
// DRIFT TRACKING
// =======================

function ensureDriftFile() {
  ensureFolder(QUEUE_DIR);

  if (!fs.existsSync(driftFile)) {
    writeJsonFile(driftFile, {
      duplicate_attempts_total: 0,
      duplicate_attempts_by_platform: {},
      duplicate_attempts_by_reason: {},
      events: [],
    });
  }
}

function readDrift() {
  ensureDriftFile();

  const raw = readTextFile(driftFile).trim();

  if (!raw) {
    return {
      duplicate_attempts_total: 0,
      duplicate_attempts_by_platform: {},
      duplicate_attempts_by_reason: {},
      events: [],
    };
  }

  try {
    const parsed = JSON.parse(raw);

    return {
      duplicate_attempts_total: parsed.duplicate_attempts_total || 0,
      duplicate_attempts_by_platform:
        parsed.duplicate_attempts_by_platform || {},
      duplicate_attempts_by_reason: parsed.duplicate_attempts_by_reason || {},
      events: Array.isArray(parsed.events) ? parsed.events : [],
    };
  } catch (error) {
    console.error("Drift file is invalid JSON. Resetting drift in memory.");
    return {
      duplicate_attempts_total: 0,
      duplicate_attempts_by_platform: {},
      duplicate_attempts_by_reason: {},
      events: [],
    };
  }
}

function saveDrift(data) {
  writeJsonFile(driftFile, data);
}

function recordDuplicateAttempt({
  platform,
  content,
  sourceInputHash,
  existingItem,
  reason,
}) {
  const drift = readDrift();
  const timestamp = new Date().toISOString();
  const contentHash = createHash(content);

  drift.duplicate_attempts_total += 1;
  drift.duplicate_attempts_by_platform[platform] =
    (drift.duplicate_attempts_by_platform[platform] || 0) + 1;

  drift.duplicate_attempts_by_reason[reason] =
    (drift.duplicate_attempts_by_reason[reason] || 0) + 1;

  drift.events.push({
    type: "duplicate_post_attempt",
    reason,
    timestamp,
    platform,
    account_label: existingItem?.account_label || "unknown",
    persona: existingItem?.persona || "operator",
    post_mode: existingItem?.post_mode || "build_log",
    content_hash: contentHash,
    source_input_hash: sourceInputHash,
    content_preview: safeTrim(content).replace(/\r?\n/g, " ").slice(0, 160),
    matched_queue_item_id: existingItem?.id || null,
    matched_queue_item_status: existingItem?.status || null,
  });

  saveDrift(drift);
}

function writeDriftSummary() {
  ensureFolder(OUTPUT_DIR);
  const drift = readDrift();

  const lines = [
    "=== BUILD LOGGER DRIFT REPORT ===",
    `Updated: ${new Date().toLocaleString()}`,
    "",
    `Duplicate attempts total: ${drift.duplicate_attempts_total}`,
    "",
    "Duplicate attempts by platform:",
  ];

  const platformKeys = Object.keys(drift.duplicate_attempts_by_platform);
  if (platformKeys.length === 0) {
    lines.push("None");
  } else {
    platformKeys.forEach((platform) => {
      lines.push(
        `- ${platform}: ${drift.duplicate_attempts_by_platform[platform]}`
      );
    });
  }

  lines.push("", "Duplicate attempts by reason:");

  const reasonKeys = Object.keys(drift.duplicate_attempts_by_reason);
  if (reasonKeys.length === 0) {
    lines.push("None");
  } else {
    reasonKeys.forEach((reason) => {
      lines.push(`- ${reason}: ${drift.duplicate_attempts_by_reason[reason]}`);
    });
  }

  lines.push("", "Recent drift events:", "");

  drift.events
    .slice(-10)
    .reverse()
    .forEach((event, index) => {
      lines.push(`${index + 1}. Type: ${event.type}`);
      lines.push(`   Reason: ${event.reason}`);
      lines.push(`   Timestamp: ${event.timestamp}`);
      lines.push(`   Platform: ${event.platform}`);
      lines.push(`   Account: ${event.account_label || "n/a"}`);
      lines.push(`   Persona: ${event.persona || "n/a"}`);
      lines.push(`   Post Mode: ${event.post_mode || "n/a"}`);
      lines.push(`   Source Input Hash: ${event.source_input_hash || "n/a"}`);
      lines.push(`   Content Hash: ${event.content_hash}`);
      lines.push(`   Matched Queue ID: ${event.matched_queue_item_id || "n/a"}`);
      lines.push(
        `   Matched Status: ${event.matched_queue_item_status || "n/a"}`
      );
      lines.push(`   Preview: ${event.content_preview || ""}`);
      lines.push("");
    });

  writeTextFile(path.join(OUTPUT_DIR, "drift-report.txt"), lines.join("\n"));
}

// =======================
// QUEUE ADD WITH DRIFT AWARENESS
// =======================

function addToQueue(
  platform,
  content,
  delayMinutes = 0,
  sourceInputHash = null,
  options = {}
) {
  const cleanContent = safeTrim(content);
  const force = options.force === true;
  const accountLabel =
    safeTrim(options.accountLabel) || resolveSelectedXAccountLabel();

  if (!cleanContent) {
    console.log(`Skipping empty ${platform} post.`);
    return null;
  }

  const data = readQueue();
  const contentHash = createHash(cleanContent);

  const exactContentDuplicate = data.queue.find((item) => {
    const samePlatform = item.platform === platform;
    const sameAccount = item.account_label === accountLabel;
    const sameContentHash = item.content_hash === contentHash;
    const activeStatus = item.status === "pending" || item.status === "posted";
    return samePlatform && sameAccount && sameContentHash && activeStatus;
  });

  if (exactContentDuplicate && !force) {
    console.log(
      `Skipping duplicate ${platform} post (exact content match on ${accountLabel}).`
    );
    recordDuplicateAttempt({
      platform,
      content: cleanContent,
      sourceInputHash,
      existingItem: exactContentDuplicate,
      reason: "exact_content_match",
    });
    return null;
  }

  const sameInputDuplicate = data.queue.find((item) => {
    const samePlatform = item.platform === platform;
    const sameAccount = item.account_label === accountLabel;
    const sameInput =
      item.source_input_hash && item.source_input_hash === sourceInputHash;
    const activeStatus = item.status === "pending" || item.status === "posted";
    return samePlatform && sameAccount && sameInput && activeStatus;
  });

  if (sameInputDuplicate && !force) {
    console.log(
      `Skipping duplicate ${platform} post (same input match on ${accountLabel}).`
    );
    recordDuplicateAttempt({
      platform,
      content: cleanContent,
      sourceInputHash,
      existingItem: sameInputDuplicate,
      reason: "same_input_match",
    });
    return null;
  }

  const queueItem = createQueueItem(
    platform,
    cleanContent,
    delayMinutes,
    sourceInputHash,
    {
      accountLabel,
      persona: options.persona,
      postMode: options.postMode,
      generatedVersion: options.generatedVersion,
      humanized: options.humanized,
    }
  );

  if (force) {
    queueItem.review_status = "override";
    queueItem.recommended_action = "Forced into queue by override";
    queueItem.override_posted_at = new Date().toISOString();
  }

  data.queue.push(queueItem);
  saveQueue(data);

  console.log(
    `Queued ${platform} post for ${queueItem.scheduled_for} on ${accountLabel}${force ? " (forced override)" : ""}`
  );

  return queueItem;
}

// =======================
// MAIN EXECUTION
// =======================

async function run() {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("Missing OPENAI_API_KEY in .env");
    }

    if (!fs.existsSync(INPUT_FILE)) {
      throw new Error(`Missing ${INPUT_FILE} in project root`);
    }

    ensureFolder(OUTPUT_DIR);
    ensureQueueFile();
    ensureDriftFile();
    ensureAccountsFile();

    const activeAccounts = listActiveXAccountLabels();
    const selectedAccountLabel = resolveSelectedXAccountLabel();
    const selectedAccountCredentials =
      getXAccountCredentialsByLabel(selectedAccountLabel);
    const credentialStatus =
      validateSelectedXAccountCredentials(selectedAccountCredentials);

    const input = readTextFile(INPUT_FILE).trim();

    if (!input) {
      throw new Error("input.txt is empty");
    }

    const sourceInputHash = createHash(input);
    const forceRequeue = parseBooleanEnv(process.env.FORCE_REQUEUE);

    const pipeline = await runFivePassPipeline(input, {
      linkedinGoal: "thought_leadership",
      twitterGoal: "engagement",
      slackGoal: "build_log",
    });

    const contextOutput = safeTrim(pipeline?.raw?.context);
    const draftOutput = safeTrim(pipeline?.raw?.draft);
    const finalOutput = safeTrim(pipeline?.raw?.tightened);

    if (!contextOutput) {
      throw new Error("PASS 1 failed: empty context output");
    }

    if (!draftOutput) {
      throw new Error("PASS 2 failed: empty draft output");
    }

    if (!finalOutput) {
      throw new Error("PASS 3 failed: empty final output");
    }

    writeTextFile(path.join(OUTPUT_DIR, "context.txt"), contextOutput);
    writeTextFile(path.join(OUTPUT_DIR, "draft.txt"), draftOutput);
    writeTextFile(path.join(OUTPUT_DIR, "final.txt"), finalOutput);

    const summary = safeTrim(pipeline?.outputs?.summary);

    const slackPost =
      safeTrim(pipeline?.outputs?.slack?.finalText) ||
      extractSection(finalOutput, "FINAL SLACK UPDATE") ||
      extractSection(draftOutput, "SLACK UPDATE");

    const linkedinPost =
      safeTrim(pipeline?.outputs?.linkedin?.finalText) ||
      extractSocialPost(finalOutput, "LinkedIn", "Twitter") ||
      extractSocialPost(draftOutput, "LinkedIn", "Twitter");

    const twitterPost =
      safeTrim(pipeline?.outputs?.twitter?.finalText) ||
      extractSocialPost(finalOutput, "Twitter") ||
      extractSocialPost(draftOutput, "Twitter");

    const slackPersona =
      safeTrim(pipeline?.outputs?.slack?.persona) ||
      choosePersona({ platform: "slack", goal: "build_log" });

    const linkedinPersona =
      safeTrim(pipeline?.outputs?.linkedin?.persona) ||
      choosePersona({ platform: "linkedin", goal: "thought_leadership" });

    const twitterPersona =
      safeTrim(pipeline?.outputs?.twitter?.persona) ||
      choosePersona({ platform: "twitter", goal: "engagement" });

    const summaryFinal = finalizePost(summary, {
      persona: "operator",
      postMode: "build_log",
    });

    writeTextFile(path.join(OUTPUT_DIR, "summary.txt"), summaryFinal.finalText);
    writeTextFile(path.join(OUTPUT_DIR, "slack.txt"), slackPost);
    writeTextFile(path.join(OUTPUT_DIR, "linkedin.txt"), linkedinPost);
    writeTextFile(path.join(OUTPUT_DIR, "twitter.txt"), twitterPost);

    writeJsonFile(path.join(OUTPUT_DIR, "persona-map.json"), {
      generated_at: new Date().toISOString(),
      linkedin: {
        persona: linkedinPersona,
        post_mode: "thought_leadership",
      },
      twitter: {
        persona: twitterPersona,
        post_mode: "engagement",
      },
      slack: {
        persona: slackPersona,
        post_mode: "build_log",
      },
      summary: {
        persona: "operator",
        post_mode: "build_log",
      },
    });

    const rawResponseBundle = [
      "=== PASS 1 CONTEXT ===",
      contextOutput,
      "",
      "=== PASS 2 DRAFT ===",
      draftOutput,
      "",
      "=== PASS 3 FINAL ===",
      finalOutput,
      "",
      "=== PASS 4/5 PERSONA MAP ===",
      JSON.stringify(
        {
          linkedin: {
            persona: linkedinPersona,
            post_mode: "thought_leadership",
          },
          twitter: {
            persona: twitterPersona,
            post_mode: "engagement",
          },
          slack: {
            persona: slackPersona,
            post_mode: "build_log",
          },
        },
        null,
        2
      ),
      "",
    ].join("\n");

    writeTextFile(path.join(OUTPUT_DIR, "raw-response.txt"), rawResponseBundle);

    addToQueue("linkedin", linkedinPost, 0, sourceInputHash, {
      force: forceRequeue,
      accountLabel: selectedAccountLabel,
      persona: linkedinPersona,
      postMode: "thought_leadership",
      generatedVersion: "v4",
      humanized: true,
    });

    if (credentialStatus.isReady) {
      addToQueue("twitter", twitterPost, 30, sourceInputHash, {
        force: forceRequeue,
        accountLabel: selectedAccountLabel,
        persona: twitterPersona,
        postMode: "engagement",
        generatedVersion: "v4",
        humanized: true,
      });
    } else {
      console.log(
        `Skipping twitter queue for ${selectedAccountLabel} because credentials are not ready.`
      );
    }

    writeDriftSummary();
    writeQueueSummary();
    writeAccountManifest({
      selectedAccountLabel,
      selectedAccountCredentials,
      credentialStatus,
      forceRequeue,
    });
    writePostingReadinessReport({
      selectedAccountLabel,
      selectedAccountCredentials,
      credentialStatus,
    });

    console.log(
      "Build complete. 5-stage AI pipeline + persona routing + multi-account foundation updated."
    );
    console.log(`Force requeue: ${forceRequeue}`);
    console.log(`Available X accounts: ${activeAccounts.join(", ") || "none"}`);
    console.log(`Selected X account: ${selectedAccountLabel}`);
    console.log(
      `Selected X handle: ${selectedAccountCredentials?.handle || "not set"}`
    );
    console.log(
      `Selected X credentials ready: ${credentialStatus.isReady ? "yes" : "no"}`
    );

    if (!credentialStatus.isReady) {
      console.log(
        `Missing X credential env vars: ${credentialStatus.missingEnvVars.join(", ")}`
      );
    }

    console.log(`Accounts file: ${ACCOUNTS_FILE}`);
    console.log(
      `Account manifest: ${path.join(OUTPUT_DIR, "account-manifest.json")}`
    );
    console.log(
      `Posting readiness: ${path.join(OUTPUT_DIR, "posting-readiness.json")}`
    );
    console.log(
      `Queue summary: ${path.join(OUTPUT_DIR, "queue-summary.json")}`
    );
    console.log(`Persona map: ${path.join(OUTPUT_DIR, "persona-map.json")}`);
    console.log(`Context file: ${path.join(OUTPUT_DIR, "context.txt")}`);
    console.log(`Draft file: ${path.join(OUTPUT_DIR, "draft.txt")}`);
    console.log(`Final file: ${path.join(OUTPUT_DIR, "final.txt")}`);
    console.log(`Summary file: ${path.join(OUTPUT_DIR, "summary.txt")}`);
    console.log(`Slack file: ${path.join(OUTPUT_DIR, "slack.txt")}`);
    console.log(`LinkedIn file: ${path.join(OUTPUT_DIR, "linkedin.txt")}`);
    console.log(`Twitter file: ${path.join(OUTPUT_DIR, "twitter.txt")}`);
    console.log(`Queue file: ${queueFile}`);
    console.log(`Drift file: ${driftFile}`);
    console.log(`Drift report: ${path.join(OUTPUT_DIR, "drift-report.txt")}`);
  } catch (error) {
    console.error("Build failed:");
    console.error(error.message);
    process.exit(1);
  }
}

run();