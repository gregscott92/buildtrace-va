const fs = require("fs");
const path = require("path");

const queueDir = "queue";
const outputDir = "outputs";
const queueFile = path.join(queueDir, "posts.json");
const driftFile = path.join(queueDir, "drift.json");
const dashboardHtmlFile = "dashboard.html";
const dashboardDataFile = "dashboard-data.json";

function ensureFolder(folder) {
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

function ensureQueueFile() {
  ensureFolder(queueDir);
  ensureFolder(outputDir);

  if (!fs.existsSync(queueFile)) {
    fs.writeFileSync(
      queueFile,
      JSON.stringify({ queue: [] }, null, 2),
      "utf-8"
    );
  }
}

function ensureDriftFile() {
  ensureFolder(queueDir);

  if (!fs.existsSync(driftFile)) {
    fs.writeFileSync(
      driftFile,
      JSON.stringify(
        {
          duplicate_attempts_total: 0,
          duplicate_attempts_by_platform: {},
          duplicate_attempts_by_reason: {},
          events: []
        },
        null,
        2
      ),
      "utf-8"
    );
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    const raw = fs.readFileSync(filePath, "utf-8").trim();

    if (!raw) {
      return fallback;
    }

    return JSON.parse(raw);
  } catch (error) {
    console.error(`Invalid JSON in ${filePath}. Using fallback.`);
    return fallback;
  }
}

function readQueue() {
  ensureQueueFile();
  const parsed = readJsonSafe(queueFile, { queue: [] });
  return Array.isArray(parsed.queue) ? parsed : { queue: [] };
}

function readDrift() {
  ensureDriftFile();

  const parsed = readJsonSafe(driftFile, {
    duplicate_attempts_total: 0,
    duplicate_attempts_by_platform: {},
    duplicate_attempts_by_reason: {},
    events: []
  });

  return {
    duplicate_attempts_total: parsed.duplicate_attempts_total || 0,
    duplicate_attempts_by_platform: parsed.duplicate_attempts_by_platform || {},
    duplicate_attempts_by_reason: parsed.duplicate_attempts_by_reason || {},
    events: Array.isArray(parsed.events) ? parsed.events : []
  };
}

function saveQueue(data) {
  fs.writeFileSync(queueFile, JSON.stringify(data, null, 2), "utf-8");
}

function formatLocal(dateString) {
  if (!dateString) return "n/a";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function getMinutesUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(dateString);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - Date.now()) / 60000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(value, length = 92) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function getPlatformLabel(post) {
  return String(post?.platform || "unknown").toUpperCase();
}

function getAccountLabel(post) {
  return (
    post?.account_label ||
    post?.page_name ||
    post?.profile_name ||
    post?.account_id ||
    "Default Account"
  );
}

function getPersonaLabel(post) {
  return post?.persona || "operator";
}

function getPostModeLabel(post) {
  return post?.post_mode || "build_log";
}

function getChannelLabel(post) {
  return `${getPlatformLabel(post)} • ${getAccountLabel(post)}`;
}

function summarizeAffectedChannels(items) {
  const labels = [...new Set(items.map(getChannelLabel))];
  if (labels.length === 0) return "No channel detected";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 1} more`;
}

function buildChannelDirectory(queue) {
  const directory = {};

  queue.forEach((item) => {
    const key = getChannelLabel(item);

    if (!directory[key]) {
      directory[key] = {
        platform: getPlatformLabel(item),
        account: getAccountLabel(item),
        total: 0,
        pending: 0,
        posted: 0,
        failed: 0
      };
    }

    directory[key].total += 1;
    if (item.status === "pending") directory[key].pending += 1;
    if (item.status === "posted") directory[key].posted += 1;
    if (item.status === "failed") directory[key].failed += 1;
  });

  return Object.values(directory).sort((a, b) => b.total - a.total).slice(0, 6);
}

function buildPersonaDirectory(queue) {
  const directory = {};

  queue.forEach((item) => {
    const persona = getPersonaLabel(item);
    const postMode = getPostModeLabel(item);
    const key = `${persona} • ${postMode}`;

    if (!directory[key]) {
      directory[key] = {
        persona,
        post_mode: postMode,
        total: 0,
        pending: 0,
        posted: 0
      };
    }

    directory[key].total += 1;
    if (item.status === "pending") directory[key].pending += 1;
    if (item.status === "posted") directory[key].posted += 1;
  });

  return Object.values(directory).sort((a, b) => b.total - a.total).slice(0, 6);
}

function buildInsights(queue, drift) {
  const now = new Date();

  const posted = queue.filter((p) => p.status === "posted");
  const pending = queue.filter((p) => p.status === "pending");
  const failed = queue.filter((p) => p.status === "failed");

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
      impact: `${readyNow.length} post(s) can publish immediately.`,
      nextMove: "Run scheduler now.",
      command: "node scheduler.js"
    });
  }

  if (failed.length > 0) {
    actions.push({
      priority: "high",
      title: "Failures need review",
      channel: summarizeAffectedChannels(failed),
      impact: `${failed.length} failed post(s) need intervention.`,
      nextMove: "Inspect queue errors and decide retry/remove.",
      command: "type queue\\posts.json"
    });
  }

  if (drift.duplicate_attempts_total > 0) {
    actions.push({
      priority: "medium",
      title: "Duplicate drift detected",
      channel: "Cross-channel behavior",
      impact: `${drift.duplicate_attempts_total} duplicate attempts were caught.`,
      nextMove: "Review repeated trigger behavior.",
      command: "type queue\\drift.json"
    });
  }

  if (suspiciousPosts.length > 0) {
    actions.push({
      priority: "high",
      title: "Timing drift detected",
      channel: summarizeAffectedChannels(suspiciousPosts),
      impact: `${suspiciousPosts.length} post(s) were published before schedule.`,
      nextMove: "Validate scheduler timing logic.",
      command: "type queue\\posts.json"
    });
  }

  if (dueSoon.length > 0) {
    actions.push({
      priority: "medium",
      title: "Posts due soon",
      channel: summarizeAffectedChannels(dueSoon),
      impact: `${dueSoon.length} post(s) are due inside the next 60 minutes.`,
      nextMove: "Leave scheduler active and watch the next publish window.",
      command: "node scheduler.js"
    });
  }

  if (pending.length === 0 && posted.length > 0) {
    actions.push({
      priority: "low",
      title: "Queue is clear",
      channel: "All channels",
      impact: "No pending posts remain.",
      nextMove: "Generate the next batch.",
      command: "node index.js"
    });
  }

  if (actions.length === 0) {
    actions.push({
      priority: "low",
      title: "Stable state",
      channel: "All channels",
      impact: "System is operating normally.",
      nextMove: "Keep scheduler alive.",
      command: "node scheduler.js"
    });
  }

  return {
    suspiciousPosts,
    readyNow,
    futurePending,
    dueSoon,
    actions
  };
}

function getMissionStatus(summary, insights) {
  if (summary.failed_posts > 0 || insights.suspiciousPosts.length > 0) {
    return {
      label: "Intervene",
      tone: "red"
    };
  }

  if (
    summary.pending_posts > 0 ||
    summary.duplicate_attempts_total > 0 ||
    insights.dueSoon.length > 0
  ) {
    return {
      label: "Watch",
      tone: "amber"
    };
  }

  return {
    label: "Stable",
    tone: "green"
  };
}

function buildDashboardData(queue, drift) {
  const total = queue.length;
  const pending = queue.filter((p) => p.status === "pending").length;
  const posted = queue.filter((p) => p.status === "posted").length;
  const failed = queue.filter((p) => p.status === "failed").length;

  const byPlatform = queue.reduce((acc, item) => {
    const key = item.platform || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byPersona = queue.reduce((acc, item) => {
    const key = item.persona || "operator";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byPostMode = queue.reduce((acc, item) => {
    const key = item.post_mode || "build_log";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const insights = buildInsights(queue, drift);
  const channelDirectory = buildChannelDirectory(queue);
  const personaDirectory = buildPersonaDirectory(queue);

  const nextPending =
    queue
      .filter((p) => p.status === "pending" && p.scheduled_for)
      .sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for))[0] || null;

  const recentPosted = queue
    .filter((p) => p.status === "posted")
    .slice(-4)
    .reverse();

  const summary = {
    total_posts: total,
    pending_posts: pending,
    posted_posts: posted,
    failed_posts: failed,
    duplicate_attempts_total: drift.duplicate_attempts_total,
    next_scheduled_post_at: nextPending?.scheduled_for || null,
    scheduler_heartbeat_at: new Date().toISOString(),
    active_channels: channelDirectory.length,
    active_personas: Object.keys(byPersona).length
  };

  return {
    generated_at: new Date().toISOString(),
    summary,
    mission_status: getMissionStatus(summary, insights),
    by_platform: byPlatform,
    by_persona: byPersona,
    by_post_mode: byPostMode,
    drift,
    insights,
    channel_directory: channelDirectory,
    persona_directory: personaDirectory,
    recent_posted_items: recentPosted
  };
}

function renderMetric(label, value, tone = "neutral") {
  return `
    <div class="metric ${tone}">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
    </div>
  `;
}

function renderAction(action) {
  return `
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
  `;
}

function renderPosted(post) {
  const platform = getPlatformLabel(post);
  const account = getAccountLabel(post);
  const persona = getPersonaLabel(post);
  const postMode = getPostModeLabel(post);

  return `
    <div class="feed-row">
      <div class="feed-top">
        <span class="tag platform">${escapeHtml(platform)}</span>
        <span class="tag account">${escapeHtml(account)}</span>
        <span class="tag posted">POSTED</span>
      </div>
      <div class="feed-copy">${escapeHtml(truncate(post.content, 105))}</div>
      <div class="feed-time">${escapeHtml(formatLocal(post.posted_at || post.created_at))}</div>
      <div class="feed-time">${escapeHtml(persona)} • ${escapeHtml(postMode)}</div>
    </div>
  `;
}

function renderChannelDirectoryRow(channel) {
  return `
    <div class="directory-row">
      <div class="directory-main">
        <div class="directory-name">${escapeHtml(channel.platform)} • ${escapeHtml(channel.account)}</div>
        <div class="directory-stats">
          Total ${escapeHtml(channel.total)} · Pending ${escapeHtml(channel.pending)} · Posted ${escapeHtml(channel.posted)} · Failed ${escapeHtml(channel.failed)}
        </div>
      </div>
    </div>
  `;
}

function writeDashboard(data, drift) {
  const dashboardData = buildDashboardData(data.queue, drift);

  fs.writeFileSync(
    dashboardDataFile,
    JSON.stringify(dashboardData, null, 2),
    "utf-8"
  );

  const primaryAction = dashboardData.insights.actions[0];
  const actions = dashboardData.insights.actions.slice(0, 3);
  const nextScheduled = dashboardData.summary.next_scheduled_post_at
    ? formatLocal(dashboardData.summary.next_scheduled_post_at)
    : "None queued";

  const statusTone = dashboardData.mission_status.tone;
  const statusLabel = dashboardData.mission_status.label;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Build Logger Command Center</title>
  <style>
    :root{
      --bg:#06101b;
      --panel:rgba(12,22,38,.9);
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
    html, body { height:100%; }
    body{
      margin:0;
      font-family:Inter, Arial, sans-serif;
      color:var(--text);
      background:
        radial-gradient(circle at top left, rgba(102,212,255,.14), transparent 26%),
        radial-gradient(circle at top right, rgba(110,183,255,.08), transparent 18%),
        linear-gradient(180deg, #040b14 0%, #07111c 100%);
      overflow:hidden;
    }

    .shell{
      width:100%;
      height:100vh;
      padding:10px;
      display:grid;
      grid-template-columns:1.08fr 1fr;
      grid-template-rows:0.9fr 1.1fr;
      gap:10px;
    }

    .box{
      min-height:0;
      min-width:0;
      background:var(--panel);
      border:1px solid var(--border);
      border-radius:var(--radius);
      box-shadow:var(--shadow);
      backdrop-filter:blur(14px);
      padding:12px;
      display:flex;
      flex-direction:column;
      overflow:hidden;
    }

    .top-left{
      display:grid;
      grid-template-rows:auto auto 1fr auto;
      gap:10px;
      position:relative;
    }

    .status-bar{
      height:8px;
      border-radius:999px;
      overflow:hidden;
      background:rgba(255,255,255,.05);
      border:1px solid rgba(255,255,255,.06);
    }

    .status-bar-fill{
      height:100%;
      width:100%;
    }

    .status-bar-fill.green{
      background:linear-gradient(90deg, rgba(27,227,159,.95), rgba(102,212,255,.55));
    }

    .status-bar-fill.amber{
      background:linear-gradient(90deg, rgba(255,191,88,.95), rgba(102,212,255,.35));
    }

    .status-bar-fill.red{
      background:linear-gradient(90deg, rgba(255,93,124,.95), rgba(255,191,88,.35));
    }

    .top-right{
      display:flex;
      flex-direction:column;
    }

    .bottom-wrap{
      grid-column:1 / span 2;
      display:grid;
      grid-template-columns:0.9fr 0.92fr 1.22fr;
      gap:10px;
      min-height:0;
    }

    .box-title{
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:8px;
      margin-bottom:8px;
    }

    .box-title h2{
      margin:0;
      font-size:14px;
      letter-spacing:-.02em;
    }

    .eyebrow{
      color:var(--cyan);
      font-size:10px;
      text-transform:uppercase;
      letter-spacing:.16em;
      white-space:nowrap;
    }

    .headline{
      font-size:24px;
      line-height:1.03;
      font-weight:800;
      letter-spacing:-.04em;
      max-width:88%;
    }

    .subcopy{
      color:var(--muted);
      font-size:11px;
      line-height:1.4;
      max-width:90%;
      margin-top:2px;
    }

    .status-chip{
      display:inline-flex;
      align-items:center;
      gap:8px;
      width:max-content;
      padding:6px 10px;
      border-radius:999px;
      font-size:10px;
      text-transform:uppercase;
      letter-spacing:.14em;
      font-weight:800;
      border:1px solid rgba(255,255,255,.08);
      background:rgba(255,255,255,.03);
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
      min-height:0;
    }

    .micro{
      color:var(--cyan);
      font-size:9px;
      text-transform:uppercase;
      letter-spacing:.15em;
    }

    .signal-impact{
      font-size:18px;
      font-weight:700;
      line-height:1.25;
    }

    .signal-next{
      color:var(--text);
      font-size:12px;
      line-height:1.35;
    }

    .signal-channel{
      color:var(--muted);
      font-size:11px;
      line-height:1.3;
    }

    .next-command{
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

    .kpi-grid{
      display:grid;
      grid-template-columns:repeat(4, 1fr);
      grid-auto-rows:minmax(72px, 1fr);
      gap:8px;
      flex:1;
      min-height:0;
    }

    .metric{
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.05);
      border-radius:14px;
      padding:10px;
      display:flex;
      flex-direction:column;
      justify-content:center;
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
      font-size:20px;
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

    .action-list{
      display:grid;
      grid-template-rows:repeat(3, 1fr);
      gap:8px;
      flex:1;
      min-height:0;
    }

    .action-row{
      min-height:0;
      border-radius:14px;
      padding:10px;
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.05);
      display:grid;
      grid-template-rows:auto auto auto auto auto;
      gap:5px;
      overflow:hidden;
    }

    .action-row.high{ border-color:rgba(255,93,124,.2); }
    .action-row.medium{ border-color:rgba(255,191,88,.18); }
    .action-row.low{ border-color:rgba(27,227,159,.14); }

    .action-top{
      display:flex;
      align-items:center;
      gap:7px;
      min-width:0;
    }

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

    .pill, .tag{
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

    .action-impact{
      color:var(--text);
      font-size:11px;
      line-height:1.3;
      max-height:30px;
      overflow:hidden;
    }

    .action-next{
      color:var(--muted);
      font-size:10px;
      line-height:1.25;
      max-height:26px;
      overflow:hidden;
    }

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

    .health-stack{
      display:grid;
      grid-template-rows:1fr 1fr 1fr;
      gap:8px;
      flex:1;
      min-height:0;
    }

    .mini-card{
      min-height:0;
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

    .directory-list{
      display:grid;
      gap:6px;
      margin-top:4px;
    }

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

    .feed-list{
      display:grid;
      grid-template-rows:repeat(4, 1fr);
      gap:8px;
      flex:1;
      min-height:0;
    }

    .feed-row{
      min-height:0;
      border-radius:14px;
      padding:10px;
      background:rgba(255,255,255,.03);
      border:1px solid rgba(255,255,255,.05);
      display:grid;
      grid-template-rows:auto 1fr auto auto;
      gap:6px;
      overflow:hidden;
    }

    .feed-top{
      display:flex;
      gap:6px;
      flex-wrap:wrap;
    }

    .feed-copy{
      color:var(--text);
      font-size:11px;
      line-height:1.3;
      overflow:hidden;
      max-height:30px;
    }

    .feed-time{
      color:var(--muted);
      font-size:10px;
    }

    .tag.platform{ background:rgba(102,212,255,.12); color:var(--cyan); }
    .tag.account{ background:rgba(110,183,255,.12); color:var(--blue); }
    .tag.posted{ background:rgba(27,227,159,.12); color:var(--green); }

    .footer{
      margin-top:6px;
      color:var(--muted);
      font-size:10px;
    }

    @media (max-width: 1280px){
      body{ overflow:auto; }
      .shell{
        height:auto;
        min-height:100vh;
        grid-template-columns:1fr;
        grid-template-rows:auto;
      }
      .bottom-wrap{
        grid-column:auto;
        grid-template-columns:1fr;
      }
      .kpi-grid{
        grid-template-columns:repeat(2, 1fr);
      }
      .box{
        min-height:280px;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="box top-left">
      <div class="status-bar">
        <div class="status-bar-fill ${escapeHtml(statusTone)}"></div>
      </div>

      <div class="box-title">
        <h2>Mission Control</h2>
        <div class="eyebrow">Current Priority</div>
      </div>

      <div>
        <div class="headline">Proof of work should drive the next move.</div>
        <div class="subcopy">
          Daily command view for queue pressure, execution health, and published output across accounts.
        </div>
      </div>

      <div class="status-chip ${escapeHtml(statusTone)}">${escapeHtml(statusLabel)}</div>

      <div class="signal-card">
        <div class="micro">Primary Signal</div>
        <div class="signal-impact">${escapeHtml(primaryAction?.impact || "No critical issue detected.")}</div>
        <div class="micro">Affected Channel</div>
        <div class="signal-channel">${escapeHtml(primaryAction?.channel || "All channels")}</div>
        <div class="micro">Recommended Move</div>
        <div class="signal-next">${escapeHtml(primaryAction?.nextMove || "Keep scheduler alive.")}</div>
      </div>

      <div class="next-command">${escapeHtml(primaryAction?.command || "node scheduler.js")}</div>
    </section>

    <section class="box top-right">
      <div class="box-title">
        <h2>System Snapshot</h2>
        <div class="eyebrow">Live State</div>
      </div>
      <div class="kpi-grid">
        ${renderMetric("Total Posts", dashboardData.summary.total_posts, "info")}
        ${renderMetric("Pending", dashboardData.summary.pending_posts, dashboardData.summary.pending_posts > 0 ? "warn" : "good")}
        ${renderMetric("Posted", dashboardData.summary.posted_posts, "good")}
        ${renderMetric("Failed", dashboardData.summary.failed_posts, dashboardData.summary.failed_posts > 0 ? "bad" : "good")}
        ${renderMetric("Duplicate Drift", dashboardData.summary.duplicate_attempts_total, dashboardData.summary.duplicate_attempts_total > 0 ? "warn" : "good")}
        ${renderMetric("Active Channels", dashboardData.summary.active_channels, "info")}
        ${renderMetric("Active Personas", dashboardData.summary.active_personas, "info")}
        ${renderMetric("Heartbeat", formatLocal(dashboardData.summary.scheduler_heartbeat_at), "info")}
      </div>
    </section>

    <section class="bottom-wrap">
      <section class="box">
        <div class="box-title">
          <h2>Priority Actions</h2>
          <div class="eyebrow">Top 3 Moves</div>
        </div>
        <div class="action-list">
          ${actions.map(renderAction).join("")}
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
                dashboardData.channel_directory.length === 0
                  ? `<div class="directory-row"><div class="directory-name">No channels detected</div></div>`
                  : dashboardData.channel_directory.map(renderChannelDirectoryRow).join("")
              }
            </div>
          </div>

          <div class="mini-card">
            <strong>Persona Mix</strong>
            ${
              dashboardData.persona_directory.length === 0
                ? "No persona data yet."
                : dashboardData.persona_directory
                    .map(
                      (item) =>
                        `${escapeHtml(item.persona)} • ${escapeHtml(item.post_mode)} — Total ${escapeHtml(item.total)} · Pending ${escapeHtml(item.pending)} · Posted ${escapeHtml(item.posted)}`
                    )
                    .join("<br><br>")
            }
          </div>

          <div class="mini-card">
            <strong>Duplicate Drift</strong>
            Platform totals:
            <br><br>
            ${
              Object.keys(dashboardData.drift.duplicate_attempts_by_platform).length === 0
                ? "No duplicate drift recorded."
                : Object.entries(dashboardData.drift.duplicate_attempts_by_platform)
                    .map(([platform, count]) => `${escapeHtml(platform)}: ${escapeHtml(count)}`)
                    .join("<br>")
            }
            <br><br>
            Next window: ${escapeHtml(nextScheduled)}
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
            dashboardData.recent_posted_items.length === 0
              ? `<div class="mini-card"><strong>Published Feed</strong>No posted items yet.</div>`
              : dashboardData.recent_posted_items.map(renderPosted).join("")
          }
        </div>
        <div class="footer">Generated ${escapeHtml(formatLocal(dashboardData.generated_at))}</div>
      </section>
    </section>
  </div>
</body>
</html>
  `;

  fs.writeFileSync(dashboardHtmlFile, html, "utf-8");
}

function processQueue() {
  const data = readQueue();
  const drift = readDrift();
  const now = new Date();

  const nextPost = data.queue.find((post) => {
    if (post.status !== "pending") return false;
    if (!post.scheduled_for) return true;

    const scheduled = new Date(post.scheduled_for);
    if (Number.isNaN(scheduled.getTime())) return true;

    return scheduled <= now;
  });

  if (!nextPost) {
    console.log("No pending posts ready to publish.");
    writeDashboard(data, drift);
    return;
  }

  try {
    console.log(
      `\nPosting queue item ${nextPost.id || "n/a"} to ${getChannelLabel(nextPost)}:`
    );
    console.log(`Persona: ${getPersonaLabel(nextPost)} | Post Mode: ${getPostModeLabel(nextPost)}`);
    console.log(nextPost.content);

    nextPost.status = "posted";
    nextPost.posted_at = new Date().toISOString();
  } catch (error) {
    nextPost.status = "failed";
    nextPost.error = error.message;
  }

  saveQueue(data);
  writeDashboard(data, drift);
}

console.log("Scheduler started...");
processQueue();
setInterval(processQueue, 60000);