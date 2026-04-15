/**
 * VentureLens — Frontend Application v3
 * Markdown rendering + clean UI (no decorative emojis)
 */

// ============================================
// Configuration
// ============================================
const API_BASE = "/api";
const TOTAL_ROUNDS = 9;

// ============================================
// Auth State Management
// ============================================
const Auth = {
  token: localStorage.getItem("vl_token") || null,
  user: JSON.parse(localStorage.getItem("vl_user") || "null"),

  save(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem("vl_token", token);
    localStorage.setItem("vl_user", JSON.stringify(user));
    this.updateUI();
  },

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem("vl_token");
    localStorage.removeItem("vl_user");
    this.updateUI();
    location.reload(); 
  },

  isAuthenticated() {
    return !!this.token;
  },

  updateUI() {
    const overlay = $("#auth-overlay");
    const headerUser = $("#header-user");
    const mainContent = $("#main-content");
    const mainHeader = $("#main-header");
    const footer = $("footer");

    if (this.isAuthenticated()) {
      overlay.style.display = "none";
      headerUser.style.display = "flex";
      $("#display-user-name").textContent = this.user?.name || "User";
      
      // Reveal main app
      mainContent.style.opacity = "1";
      mainContent.style.pointerEvents = "auto";
      mainHeader.style.opacity = "1";
      footer.style.opacity = "1";
    } else {
      overlay.style.display = "flex";
      headerUser.style.display = "none";
      
      // Dim main app
      mainContent.style.opacity = "0.05";
      mainContent.style.pointerEvents = "none";
      mainHeader.style.opacity = "0.3";
      footer.style.opacity = "0.3";
    }
  }
};

/** Central fetch helper with Auth headers */
async function apiFetch(url, options = {}) {
  const headers = {
    ...options.headers,
    "Content-Type": "application/json",
  };

  if (Auth.token) {
    headers["Authorization"] = `Bearer ${Auth.token}`;
  }

  const res = await fetch(url, { ...options, headers });
  
  if (res.status === 401 && Auth.isAuthenticated()) {
    // Token likely expired
    Auth.logout();
    throw new Error("Session expired. Please login again.");
  }
  
  return res;
}

const AGENT_COLORS = {
  scout: "#00d4ff", analyst: "#7c3aed", critic: "#ef4444",
  strategist: "#10b981", judge: "#f59e0b",
  alpha: "#f97316", beta: "#06b6d4", gamma: "#a855f7",
  morocco: "#059669",
};

const AGENT_META = {
  scout: { name: "Scout", role: "Trend Discovery", abbr: "SC" },
  analyst: { name: "Analyst", role: "Market Analysis", abbr: "AN" },
  critic: { name: "Critic", role: "Risk Assessment", abbr: "CR" },
  strategist: { name: "Strategist", role: "Execution Planning", abbr: "ST" },
  judge: { name: "Judge", role: "Classification", abbr: "JD" },
  alpha: { name: "Judge Alpha", role: "Conservative VC", abbr: "JA" },
  beta: { name: "Judge Beta", role: "Technical CTO", abbr: "JB" },
  gamma: { name: "Judge Gamma", role: "Market Strategist", abbr: "JG" },
  morocco: { name: "Morocco Advisor", role: "Implementation Specialist", abbr: "MA" },
};

const ROUND_LABELS = {
  1: "scout", 2: "analyst", 3: "critic", 4: "strategist", 5: "judge",
  6: "alpha", 7: "beta", 8: "gamma", 9: "morocco",
};

const CONTEXT_LABELS = {
  1: "SCOUT'S FINDINGS", 2: "ANALYST'S EVALUATION", 3: "CRITIC'S REVIEW",
  4: "STRATEGIST'S PLAN", 5: "JUDGE'S CLASSIFICATION",
  6: "JUDGE ALPHA'S RATINGS", 7: "JUDGE BETA'S RATINGS",
  8: "JUDGE GAMMA'S RATINGS", 9: "MOROCCO IMPLEMENTATION NOTES",
};

// ============================================
// Markdown Renderer Setup
// ============================================
if (typeof marked !== "undefined") {
  marked.setOptions({
    breaks: true,
    gfm: true,
    headerIds: false,
    mangle: false,
  });
}

function renderMarkdown(text) {
  if (!text) return "";
  if (typeof marked !== "undefined") {
    try {
      return marked.parse(String(text));
    } catch (e) {
      return escapeHtml(text);
    }
  }
  return escapeHtml(text).replace(/\n/g, "<br>");
}

// ============================================
// State
// ============================================
let currentResults = null;
let isDebateRunning = false;
let debateContext = "";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============================================
// Initialization
// ============================================
document.addEventListener("DOMContentLoaded", () => {
  Auth.updateUI();
  bindEvents();
  
  if (Auth.isAuthenticated()) {
    checkDatabaseHealth();   // verify Netlify Blobs is reachable
    loadLatestResults();
    loadHistory();
    loadBestOfDay();
    loadHallOfFame();
    updateNextRunTimer();
    setInterval(updateNextRunTimer, 60000);
  }
});

function bindEvents() {
  // Auth Events
  $("#auth-toggle").addEventListener("click", (e) => {
    e.preventDefault();
    const isSignup = $("#group-name").style.display === "none";
    $("#group-name").style.display = isSignup ? "flex" : "none";
    $("#auth-title").textContent = isSignup ? "Create Account" : "Welcome Back";
    $("#auth-subtitle").textContent = isSignup ? "Join VentureLens for autonomous insights" : "Login to access real-time startup intelligence";
    $("#btn-auth-submit .btn-text").textContent = isSignup ? "Sign Up" : "Sign In";
    $("#auth-toggle").textContent = isSignup ? "Sign In" : "Create one";
    $("#auth-toggle-text").firstChild.textContent = isSignup ? "Already have an account? " : "Don't have an account? ";
    $("#auth-error").style.display = "none";
  });

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const isSignup = $("#group-name").style.display !== "none";
    const email = $("#auth-email").value;
    const password = $("#auth-password").value;
    const name = $("#auth-name").value;
    const errorEl = $("#auth-error");
    const btn = $("#btn-auth-submit");
    const loader = btn.querySelector(".btn-loader");
    const btnText = btn.querySelector(".btn-text");

    errorEl.style.display = "none";
    btnText.style.display = "none";
    loader.style.display = "block";
    btn.disabled = true;

    try {
      const endpoint = isSignup ? "/auth-signup" : "/auth-login";
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Authentication failed");

      Auth.save(data.token, data.user);
      showToast(`Welcome back, ${data.user.name}!`);
      location.reload(); // Refresh to trigger data load
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.style.display = "block";
    } finally {
      loader.style.display = "none";
      btnText.style.display = "block";
      btn.disabled = false;
    }
  });

  $("#btn-logout").addEventListener("click", () => Auth.logout());

  $("#btn-run-analysis").addEventListener("click", startLiveDebate);
  $("#btn-view-debate").addEventListener("click", toggleDebatePanel);
  $("#btn-close-debate").addEventListener("click", () => {
    $("#debate-panel").style.display = "none";
  });

  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      $$(".tab-content").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $(`#panel-${btn.dataset.tab}`).classList.add("active");
      // Lazy-load intelligence feed on first visit
      if (btn.dataset.tab === "intelligence" && intelData.length === 0) {
        loadIntelligenceFeed(false);
      }
    });
  });

  bindIntelEvents();
}

// ============================================
// API Calls
// ============================================
async function fetchLatestResults() {
  try {
    const res = await apiFetch(`${API_BASE}/get-results?type=latest`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Failed to load results:", err);
    return null;
  }
}

async function fetchHistory() {
  try {
    const res = await apiFetch(`${API_BASE}/get-results?type=history`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Failed to load history:", err);
    return [];
  }
}

async function fetchBestOfDay() {
  try {
    const res = await apiFetch(`${API_BASE}/get-results?type=best-of-day`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn("Failed to load best-of-day:", err);
    return null;
  }
}

async function fetchHallOfFame() {
  try {
    const res = await fetch(`${API_BASE}/get-results?type=hall-of-fame`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Hall of Fame returns an array directly (or status:empty)
    if (Array.isArray(data)) return data;
    if (data.status === "empty") return [];
    return data;
  } catch (err) {
    console.warn("Failed to load hall-of-fame:", err);
    return [];
  }
}

async function saveSession(session) {
  // Send compact payload — ideas only, no debate logs (keeps payload small & fast)
  const compact = {
    id:        session.id,
    timestamp: session.timestamp,
    status:    session.status,
    phases:    session.phases,
    ideas:     session.ideas,
    // debate excluded — loaded separately if needed
  };

  // Attempt with 1 retry
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await apiFetch(`${API_BASE}/save-session`, {
        method:  "POST",
        body:    JSON.stringify({ session: compact }),
      });
      if (res.ok) return await res.json();
      const errText = await res.text();
      console.warn(`[Save] Attempt ${attempt} failed (${res.status}):`, errText);
    } catch (err) {
      console.warn(`[Save] Attempt ${attempt} network error:`, err.message);
    }
    if (attempt < 2) await sleep(1500); // wait before retry
  }
  return null;
}

// Fire-and-forget curator — does NOT block the save flow
function triggerCurate(ideas) {
  const highScorers = ideas.filter((i) => (i.compositeScore || 0) >= 7.0);
  if (highScorers.length === 0) return;
  apiFetch(`${API_BASE}/curate`, {
    method:  "POST",
    body:    JSON.stringify({ ideas: highScorers }),
  })
    .then((r) => r.json())
    .then((r) => {
      if (r.newAdmissions > 0) {
        showToast(`⭐ ${r.newAdmissions} idea${r.newAdmissions > 1 ? "s" : ""} added to Top Ideas!`);
        loadHallOfFame();
      }
    })
    .catch((e) => console.warn("[Curate] fire-and-forget error:", e.message));
}

async function checkDatabaseHealth() {
  try {
    const res = await apiFetch(`${API_BASE}/health`);
    const data = await res.json();
    if (data.ok) {
      console.log("[Health] MongoDB Atlas ✅", data);
      showDbStatus("online", `Database online · ${data.historyCount} sessions · ${data.hofCount} top ideas`);
    } else {
      console.warn("[Health] MongoDB not OK:", data.error);
      showDbStatus("warning", "Database connection issue — saved data may not persist");
    }
  } catch (e) {
    console.warn("[Health] Check failed:", e.message);
  }
}

function showDbStatus(state, message) {
  let bar = document.getElementById("db-status-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "db-status-bar";
    bar.style.cssText = `position:fixed;bottom:0;left:0;right:0;z-index:9998;padding:6px 20px;font-size:0.75rem;font-weight:500;display:flex;align-items:center;gap:8px;transition:opacity 0.5s;`;
    document.body.appendChild(bar);
  }
  const colors = { online: ["#10b981", "rgba(16,185,129,0.08)"], warning: ["#f59e0b", "rgba(245,158,11,0.1)"] };
  const [c, bg] = colors[state] || colors.online;
  bar.style.background = bg;
  bar.style.borderTop = `1px solid ${c}30`;
  bar.style.color = c;
  bar.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${c};flex-shrink:0;"></span>${message}`;
  // Auto-hide after 5s if online
  if (state === "online") setTimeout(() => { bar.style.opacity = "0"; setTimeout(() => bar.remove(), 500); }, 5000);
}

async function runDebateRound(round, context) {
  const res = await apiFetch(`${API_BASE}/debate-round`, {
    method: "POST",
    body: JSON.stringify({ round, context }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Round ${round} failed: ${errBody}`);
  }
  return await res.json();
}

// ============================================
// Load & Render
// ============================================
async function loadLatestResults() {
  setStatus("loading", "Loading...");
  const data = await fetchLatestResults();
  if (!data || data.status === "empty") {
    setStatus("idle", "Ready");
    return;
  }
  currentResults = data;
  renderIdeas(data.ideas, "#ideas-grid", "#empty-state");
  renderDebateLog(data.debate);
  updateStats(data);
  setStatus("active", "Online");
  updateLastUpdated(data.timestamp);
  $("#btn-view-debate").disabled = false;
}

async function loadHistory() {
  const history = await fetchHistory();
  if (Array.isArray(history) && history.length > 0) {
    renderHistory(history);
    $("#stat-sessions").textContent = history.length;
  }
}

async function loadHallOfFame() {
  const hof = await fetchHallOfFame();
  renderHallOfFame(hof);
}

async function loadBestOfDay() {
  const bod = await fetchBestOfDay();
  if (bod && bod.ideas && bod.ideas.length > 0) {
    renderIdeas(bod.ideas, "#bod-grid", null);
    $("#bod-runs").textContent = `${bod.totalRuns || 0} runs`;
    $("#bod-analyzed").textContent = `${bod.totalIdeasAnalyzed || 0} ideas analyzed`;
    $("#bod-subtitle").textContent = `Top ${bod.ideas.length} ideas from ${bod.date || "today"} — ${bod.uniqueIdeas || 0} unique ideas`;
  }
}

// ============================================
// Live Debate Flow (9 Rounds)
// ============================================
async function startLiveDebate() {
  if (isDebateRunning) return;
  isDebateRunning = true;

  const btn = $("#btn-run-analysis");
  btn.classList.add("btn-loading");
  btn.disabled = true;

  $("#debate-panel").style.display = "block";
  $("#debate-messages").innerHTML = "";
  $("#debate-panel").scrollIntoView({ behavior: "smooth", block: "start" });

  setStatus("running", "Analysis running...");
  debateContext = "";

  let allDebateLogs = [];
  let classifiedIdeas = [];

  for (let round = 1; round <= TOTAL_ROUNDS; round++) {
    const agentKey = ROUND_LABELS[round];

    updateDebateProgress(round, TOTAL_ROUNDS);
    activateAgent(agentKey);
    showTypingIndicator(agentKey);

    try {
      const result = await runDebateRound(round, debateContext);
      removeTypingIndicator();
      renderDebateMessage(result);

      if (result.earlyExit) {
        showToast("⚠️ Analysis halted: Ideas are too risky.", "warning");
        const stopMsg = {
          agent: { name: "System", role: "Safety Check", color: "#666" },
          content: `### 🛑 EARLY EXIT TRIGGERED\n\n${result.exitReason}`,
          timestamp: new Date().toISOString()
        };
        renderDebateMessage(stopMsg);
        break; // Exit the round loop
      }

      allDebateLogs.push({
        round,
        agent: agentKey,
        content: result.content,
        timestamp: result.timestamp,
      });

      debateContext += `\n\n=== ${CONTEXT_LABELS[round]} ===\n${result.content}`;
      markAgentDone(agentKey);

      if (round === 5) {
        classifiedIdeas = parseJsonOutput(result.content);
      }

      if (round === TOTAL_ROUNDS) {
        const alphaRatings = parseJsonOutput(allDebateLogs.find((l) => l.round === 6)?.content || "");
        const betaRatings = parseJsonOutput(allDebateLogs.find((l) => l.round === 7)?.content || "");
        const gammaRatings = parseJsonOutput(allDebateLogs.find((l) => l.round === 8)?.content || "");
        const moroccoNotes = parseJsonOutput(allDebateLogs.find((l) => l.round === 9)?.content || "");

        classifiedIdeas = classifiedIdeas.map((idea, i) => {
          const ratings = mergeRatingsForIdea(idea, i, alphaRatings, betaRatings, gammaRatings);
          return {
            ...idea,
            ratings,
            compositeScore: ratings?.totalScore || idea.score || 0,
            moroccoNotes: moroccoNotes?.[i] || null,
          };
        });

        classifiedIdeas.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));
        classifiedIdeas = classifiedIdeas.map((idea, i) => ({ ...idea, rank: i + 1 }));

        currentResults = {
          id: `session_${Date.now()}`,
          timestamp: new Date().toISOString(),
          ideas: classifiedIdeas,
          debate: allDebateLogs,
          phases: { debate: 5, judging: 3, morocco: 1, totalRounds: 9 },
          status: "complete",
        };

        renderIdeas(classifiedIdeas, "#ideas-grid", "#empty-state");
        updateStats(currentResults);
        updateLastUpdated(currentResults.timestamp);
        $("#btn-view-debate").disabled = false;
      }

      if (round < TOTAL_ROUNDS) await sleep(500);
    } catch (err) {
      removeTypingIndicator();
      renderErrorMessage(agentKey, err.message);
      break;
    }
  }

  updateDebateProgress(TOTAL_ROUNDS, TOTAL_ROUNDS);
  setStatus("active", "Online");
  isDebateRunning = false;
  btn.classList.remove("btn-loading");
  btn.disabled = false;

  // ── Step 1: Fast save to Netlify Blobs (ideas only, no LLM) ─────────────
  if (currentResults && currentResults.ideas && currentResults.ideas.length > 0) {
    setStatus("running", "Saving to database...");
    try {
      const saved = await saveSession(currentResults);
      if (saved && saved.success) {
        showToast(`✅ Saved! ${saved.ideasSaved} ideas · ${saved.historySessions} sessions total`);
        await Promise.all([loadHistory(), loadBestOfDay()]);
        setStatus("active", "Online");

        // ── Step 2: Fire-and-forget curator (LLM, doesn't block) ───────────
        triggerCurate(currentResults.ideas);

      } else {
        showToast("⚠️ Save failed — database may be unavailable. Check the status bar.");
        setStatus("active", "Online");
      }
    } catch (err) {
      console.warn("Session save error:", err);
      showToast("⚠️ Could not reach database. Your analysis is shown but not saved.");
      setStatus("active", "Online");
    }
  } else {
    setStatus("active", "Online");
  }
}



// ============================================
// Rendering: Ideas
// ============================================
function renderIdeas(ideas, gridSelector, emptySelector) {
  const grid = $(gridSelector);
  const empty = emptySelector ? $(emptySelector) : null;

  if (!ideas || ideas.length === 0) {
    grid.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }

  if (empty) empty.style.display = "none";
  grid.innerHTML = ideas.map((idea, i) => createIdeaCard(idea, i)).join("");

  grid.querySelectorAll(".idea-section-header").forEach((header) => {
    header.addEventListener("click", () => {
      header.classList.toggle("open");
      header.nextElementSibling.classList.toggle("open");
    });
  });

  grid.querySelectorAll(".morocco-header").forEach((header) => {
    header.addEventListener("click", () => {
      header.classList.toggle("open");
      header.nextElementSibling.classList.toggle("open");
    });
  });
}

function createIdeaCard(idea, index) {
  const tier = (idea.tier || "B").toUpperCase();
  const score = idea.compositeScore || idea.score || "—";
  const riskLevel = (idea.riskLevel || "medium").toLowerCase();
  const tags = idea.tags || [];

  return `
    <article class="idea-card tier-${tier}">
      <div class="idea-header">
        <div class="idea-title-area">
          <div class="idea-rank">${idea.dayRank ? `Day Rank #${idea.dayRank}` : `Rank #${idea.rank || index + 1}`}</div>
          <h3 class="idea-title">${escapeHtml(idea.name || "Untitled Idea")}</h3>
        </div>
        <div class="idea-badges">
          <span class="tier-badge tier-${tier}">${tier}</span>
          <span class="score-badge"><span class="score-val">${score}</span>/10</span>
        </div>
      </div>

      <div class="idea-metrics">
        ${idea.estimatedMRR ? `<span class="metric-chip">MRR: ${escapeHtml(idea.estimatedMRR)}</span>` : ""}
        ${idea.launchCost ? `<span class="metric-chip">Launch: ${escapeHtml(idea.launchCost)}</span>` : ""}
        ${idea.timeToRevenue ? `<span class="metric-chip">Revenue: ${escapeHtml(idea.timeToRevenue)}</span>` : ""}
      </div>

      ${tags.length > 0 ? `
        <div class="idea-tags">
          ${tags.map((t) => `<span class="idea-tag">${escapeHtml(t)}</span>`).join("")}
        </div>
      ` : ""}

      <div class="risk-bar">
        <span class="risk-label">Risk</span>
        <div class="risk-track"><div class="risk-fill ${riskLevel}"></div></div>
        <span class="risk-value">${riskLevel}</span>
      </div>

      ${idea.ratings ? createRatingsPanel(idea.ratings) : ""}

      <div class="idea-body">
        ${createIdeaSection("Concept & Evidence", idea.concept, idea.evidence)}
        ${createIdeaSection("Tech Stack", idea.techStack)}
        ${createIdeaSection("Execution Strategy", idea.executionStrategy)}
        ${createIdeaSection("Unfair Advantage", idea.unfairAdvantage)}
        ${idea.keyRisk ? createIdeaSection("Key Risk", idea.keyRisk) : ""}
        ${idea.criticalAction ? createIdeaSection("Critical First Action", idea.criticalAction) : ""}
      </div>

      ${idea.moroccoNotes ? createMoroccoNotes(idea.moroccoNotes) : ""}
    </article>
  `;
}

function createRatingsPanel(ratings) {
  if (!ratings || !ratings.averages) return "";
  const avg = ratings.averages;
  const judges = ratings.judges || {};

  const criteria = [
    { key: "capitalEfficiency", label: "Capital Efficiency" },
    { key: "executionFromMorocco", label: "Execution from Morocco" },
    { key: "scalability", label: "Scalability" },
    { key: "innovationScore", label: "Innovation Score" },
  ];

  const rows = criteria.map((c) => {
    const val = avg[c.key] || 5;
    const pct = val * 10;
    const scoreClass = val >= 7 ? "score-high" : val >= 5 ? "score-mid" : "score-low";
    const aVal = judges.alpha ? judges.alpha[c.key] : "–";
    const bVal = judges.beta ? judges.beta[c.key] : "–";
    const gVal = judges.gamma ? judges.gamma[c.key] : "–";

    return `
      <div class="rating-row">
        <span class="rating-criterion">${c.label}</span>
        <div class="rating-bar-track">
          <div class="rating-bar-fill ${scoreClass}" style="width: ${pct}%"></div>
        </div>
        <span class="rating-score">${val}</span>
        <div class="rating-judges">
          <span class="judge-dot" style="background: #f97316" title="Alpha: ${aVal}">${aVal}</span>
          <span class="judge-dot" style="background: #06b6d4" title="Beta: ${bVal}">${bVal}</span>
          <span class="judge-dot" style="background: #a855f7" title="Gamma: ${gVal}">${gVal}</span>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="ratings-panel">
      <div class="ratings-title">
        Multi-LLM Judging Panel
        <span class="composite-score">${ratings.totalScore || "—"}/10</span>
      </div>
      ${rows}
    </div>
  `;
}

function createMoroccoNotes(notes) {
  if (!notes) return "";
  const fields = [
    { key: "paymentSolutions", label: "Payment Solutions" },
    { key: "legalStructure", label: "Legal Structure" },
    { key: "bankingSolutions", label: "Banking Solutions" },
    { key: "localAdvantages", label: "Local Advantages" },
    { key: "remoteExecution", label: "Remote Execution" },
  ];

  const fieldsHtml = fields
    .filter((f) => notes[f.key])
    .map((f) => `
      <div class="morocco-field">
        <div class="morocco-field-label">${f.label}</div>
        <div class="morocco-field-value markdown-content">${renderMarkdown(notes[f.key])}</div>
      </div>
    `).join("");

  const warningHtml = notes.criticalWarning ? `
    <div class="morocco-warning">
      <div class="morocco-field-label">Critical Warning</div>
      <div class="morocco-field-value markdown-content">${renderMarkdown(notes.criticalWarning)}</div>
    </div>
  ` : "";

  return `
    <div class="morocco-notes">
      <div class="morocco-header">
        <span class="morocco-label">Morocco Implementation Note</span>
        <span class="morocco-chevron">▼</span>
      </div>
      <div class="morocco-content">
        ${fieldsHtml}
        ${warningHtml}
      </div>
    </div>
  `;
}

function createIdeaSection(title, ...contents) {
  const validContents = contents.filter(Boolean);
  if (validContents.length === 0) return "";
  const text = validContents.join("\n\n");
  return `
    <div class="idea-section">
      <div class="idea-section-header">
        ${title}
        <span class="chevron">▼</span>
      </div>
      <div class="idea-section-content markdown-content">${renderMarkdown(text)}</div>
    </div>
  `;
}

// ============================================
// Rendering: Debate Messages (with Markdown)
// ============================================
function renderDebateLog(debate) {
  if (!debate || debate.length === 0) return;
  const container = $("#debate-messages");
  container.innerHTML = debate.map((entry) => createMessageHtml(entry)).join("");
}

function renderDebateMessage(result) {
  const container = $("#debate-messages");
  const agentKey = ROUND_LABELS[result.round] || "scout";
  const html = createMessageHtml({
    round: result.round,
    agent: agentKey,
    content: result.content,
    timestamp: result.timestamp,
  });
  container.insertAdjacentHTML("beforeend", html);
  container.scrollTop = container.scrollHeight;
}

function createMessageHtml(entry) {
  const agent = AGENT_META[entry.agent] || AGENT_META.scout;
  const color = AGENT_COLORS[entry.agent] || "#00d4ff";
  const time = entry.timestamp ? formatTime(entry.timestamp) : "";
  const phase = entry.round <= 5 ? "Debate" : entry.round <= 8 ? "Judging" : "Morocco";

  return `
    <div class="debate-message fade-in" data-round="${entry.round}">
      <div class="message-header">
        <div class="message-avatar" style="background: ${color}15; border: 1px solid ${color}30; color: ${color};">
          ${agent.abbr}
        </div>
        <div class="message-agent-info">
          <span class="message-agent-name" style="color: ${color}">${agent.name}</span>
          <span class="message-agent-role">${agent.role} · ${phase} · Round ${entry.round}/${TOTAL_ROUNDS}</span>
        </div>
        <span class="message-timestamp">${time}</span>
      </div>
      <div class="message-content markdown-content">${renderMarkdown(entry.content)}</div>
    </div>
  `;
}

function renderErrorMessage(agentKey, errorMsg) {
  const container = $("#debate-messages");
  const agent = AGENT_META[agentKey] || AGENT_META.scout;
  const html = `
    <div class="debate-message fade-in">
      <div class="message-header">
        <div class="message-avatar" style="background: ${AGENT_COLORS.critic}15; border: 1px solid ${AGENT_COLORS.critic}30; color: ${AGENT_COLORS.critic};">ERR</div>
        <div class="message-agent-info">
          <span class="message-agent-name" style="color: var(--danger)">${agent.name} — Error</span>
          <span class="message-agent-role">The agent encountered an error</span>
        </div>
      </div>
      <div class="message-content" style="border-left: 3px solid var(--danger);">${escapeHtml(errorMsg)}</div>
    </div>`;
  container.insertAdjacentHTML("beforeend", html);
  container.scrollTop = container.scrollHeight;
}

function showTypingIndicator(agentKey) {
  const container = $("#debate-messages");
  const agent = AGENT_META[agentKey] || AGENT_META.scout;
  const color = AGENT_COLORS[agentKey] || "#00d4ff";
  const html = `
    <div class="debate-message fade-in" id="typing-indicator">
      <div class="message-header">
        <div class="message-avatar" style="background: ${color}15; border: 1px solid ${color}30; color: ${color};">${agent.abbr}</div>
        <div class="message-agent-info">
          <span class="message-agent-name" style="color: ${color}">${agent.name}</span>
          <span class="message-agent-role">${agent.role} — Processing...</span>
        </div>
      </div>
      <div class="typing-indicator">
        <span class="typing-dot" style="background: ${color}"></span>
        <span class="typing-dot" style="background: ${color}"></span>
        <span class="typing-dot" style="background: ${color}"></span>
      </div>
    </div>`;
  container.insertAdjacentHTML("beforeend", html);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById("typing-indicator");
  if (el) el.remove();
}

// ============================================
// Rendering: History
// ============================================
function renderHistory(history) {
  const container = $("#history-list");
  if (!history || history.length === 0) {
    container.innerHTML = '<div class="empty-history">No previous analyses found.</div>';
    return;
  }
  container.innerHTML = history.map((item, i) => {
    const tierColor = { S: "var(--accent)", A: "var(--success)", B: "var(--primary)", C: "var(--text-muted)" }[item.topTier] || "var(--text-muted)";
    return `
      <div class="history-item" data-id="${item.id}">
        <span class="history-dot ${i === 0 ? "latest" : ""}"></span>
        <div class="history-info">
          <div class="history-title">${escapeHtml(item.topIdea || "Analysis Session")}</div>
          <div class="history-meta">${formatDate(item.timestamp)} · ${item.ideaCount || 0} ideas · Score: ${item.topScore || "—"}</div>
        </div>
        <span class="history-tier" style="color: ${tierColor}; background: ${tierColor}15; border: 1px solid ${tierColor}30; border-radius: 6px;">
          ${item.topTier || "?"}-TIER
        </span>
      </div>`;
  }).join("");
}

// ============================================
// Rendering: Hall of Fame
// ============================================
function renderHallOfFame(ideas) {
  const grid = $("#hof-grid");
  const empty = $("#hof-empty");
  const countEl = $("#hof-count");

  if (!ideas || ideas.length === 0) {
    if (empty) empty.style.display = "block";
    if (countEl) countEl.textContent = "0 ideas";
    return;
  }

  if (empty) empty.style.display = "none";
  if (countEl) countEl.textContent = `${ideas.length} idea${ideas.length !== 1 ? "s" : ""}`;

  // Render as idea cards but with HoF enhancements
  grid.innerHTML = ideas.map((idea, i) => createHofCard(idea, i)).join("");

  // Wire up collapsibles (same as regular idea cards)
  grid.querySelectorAll(".idea-section-header").forEach((header) => {
    header.addEventListener("click", () => {
      header.classList.toggle("open");
      header.nextElementSibling.classList.toggle("open");
    });
  });
  grid.querySelectorAll(".morocco-header").forEach((header) => {
    header.addEventListener("click", () => {
      header.classList.toggle("open");
      header.nextElementSibling.classList.toggle("open");
    });
  });
}

function createHofCard(idea, index) {
  const tier = (idea.tier || "A").toUpperCase();
  const score = idea.compositeScore || idea.score || "—";
  const riskLevel = (idea.riskLevel || "medium").toLowerCase();
  const tags = idea.tags || [];
  const addedAt = idea.addedAt ? `Admitted ${formatDate(idea.addedAt)}` : "All-Time Top Idea";

  return `
    <article class="idea-card tier-${tier} hof-card">
      <div class="hof-ribbon">
        <span class="hof-rank">#${index + 1}</span>
        <span class="hof-crown">⭐ Hall of Fame</span>
        <span class="hof-date">${addedAt}</span>
      </div>

      <div class="idea-header">
        <div class="idea-title-area">
          <h3 class="idea-title">${escapeHtml(idea.name || "Untitled Idea")}</h3>
        </div>
        <div class="idea-badges">
          <span class="tier-badge tier-${tier}">${tier}</span>
          <span class="score-badge"><span class="score-val">${score}</span>/10</span>
        </div>
      </div>

      <div class="idea-metrics">
        ${idea.estimatedMRR ? `<span class="metric-chip">MRR: ${escapeHtml(idea.estimatedMRR)}</span>` : ""}
        ${idea.launchCost ? `<span class="metric-chip">Launch: ${escapeHtml(idea.launchCost)}</span>` : ""}
        ${idea.timeToRevenue ? `<span class="metric-chip">Revenue: ${escapeHtml(idea.timeToRevenue)}</span>` : ""}
      </div>

      ${tags.length > 0 ? `
        <div class="idea-tags">
          ${tags.map((t) => `<span class="idea-tag">${escapeHtml(t)}</span>`).join("")}
        </div>
      ` : ""}

      <div class="risk-bar">
        <span class="risk-label">Risk</span>
        <div class="risk-track"><div class="risk-fill ${riskLevel}"></div></div>
        <span class="risk-value">${riskLevel}</span>
      </div>

      ${idea.curatorRationale ? `
        <div class="curator-rationale">
          <span class="curator-icon">🏆</span>
          <span class="curator-label">Curator: </span>
          <span class="curator-text">${escapeHtml(idea.curatorRationale)}</span>
        </div>
      ` : ""}

      ${idea.ratings ? createRatingsPanel(idea.ratings) : ""}

      <div class="idea-body">
        ${createIdeaSection("Concept & Evidence", idea.concept, idea.evidence)}
        ${createIdeaSection("Tech Stack", idea.techStack)}
        ${createIdeaSection("Execution Strategy", idea.executionStrategy)}
        ${createIdeaSection("Unfair Advantage", idea.unfairAdvantage)}
        ${idea.keyRisk ? createIdeaSection("Key Risk", idea.keyRisk) : ""}
        ${idea.criticalAction ? createIdeaSection("Critical First Action", idea.criticalAction) : ""}
      </div>

      ${idea.moroccoNotes ? createMoroccoNotes(idea.moroccoNotes) : ""}
    </article>
  `;
}

// ============================================
// Toast Notifications
// ============================================
function showToast(message, duration = 4000) {
  let toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toast-container";
    document.body.appendChild(toastContainer);
  }
  const toast = document.createElement("div");
  toast.className = "toast fade-in";
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 400);
  }, duration);
}


// ============================================
// UI State
// ============================================
function setStatus(state, text) {
  const dot = $(".status-dot");
  const label = $("#status-text");
  dot.className = "status-dot";
  if (state === "active") dot.classList.add("active");
  if (state === "running") dot.classList.add("running");
  label.textContent = text;
}

function updateLastUpdated(timestamp) {
  if (!timestamp) return;
  $("#last-updated").textContent = `Updated: ${formatDate(timestamp)}`;
}

function updateStats(data) {
  if (!data) return;
  const ideas = data.ideas || [];
  $("#stat-ideas").textContent = ideas.length;
  const topTier = ideas.length > 0 ? `${ideas[0].tier || "?"}-Tier` : "—";
  $("#stat-top-tier").textContent = topTier;
}

function updateDebateProgress(current, total) {
  const pct = (current / total) * 100;
  $("#debate-progress-fill").style.width = `${pct}%`;
  $("#debate-progress-text").textContent = `Round ${current}/${total}`;
}

function activateAgent(agentKey) {
  $$(".agent-chip").forEach((chip) => chip.classList.remove("speaking"));
  const chip = $(`.agent-chip[data-agent="${agentKey}"]`);
  if (chip) chip.classList.add("speaking");
}

function markAgentDone(agentKey) {
  const chip = $(`.agent-chip[data-agent="${agentKey}"]`);
  if (chip) { chip.classList.remove("speaking"); chip.classList.add("done"); }
}

function toggleDebatePanel() {
  const panel = $("#debate-panel");
  if (panel.style.display === "none") {
    panel.style.display = "block";
    if (currentResults?.debate) renderDebateLog(currentResults.debate);
    $$(".agent-chip").forEach((chip) => chip.classList.add("done"));
    updateDebateProgress(TOTAL_ROUNDS, TOTAL_ROUNDS);
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    panel.style.display = "none";
  }
}

function updateNextRunTimer() {
  const now = new Date();
  const nextRun = new Date(now);
  nextRun.setUTCMinutes(0, 0, 0);
  nextRun.setUTCHours(nextRun.getUTCHours() + 1);
  const diffMs = nextRun - now;
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  $("#stat-next-run").textContent = `${minutes}m ${seconds}s`;
}

// ============================================
// Parsers & Helpers
// ============================================
function parseJsonOutput(content) {
  if (!content) return [];
  try {
    let jsonStr = content;
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) jsonStr = arrayMatch[0];
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse JSON output:", e);
    return [];
  }
}

function mergeRatingsForIdea(idea, index, alphaRatings, betaRatings, gammaRatings) {
  const criteria = ["capitalEfficiency", "executionFromMorocco", "scalability", "innovationScore"];
  const allRatings = { alpha: alphaRatings, beta: betaRatings, gamma: gammaRatings };
  const judges = {};

  for (const [judgeKey, ratings] of Object.entries(allRatings)) {
    let rating = ratings?.[index];
    if (!rating && ratings) {
      rating = ratings.find((r) => r?.name && idea?.name && r.name.toLowerCase().includes(idea.name.toLowerCase().substring(0, 15)));
    }
    if (rating) {
      judges[judgeKey] = {};
      for (const c of criteria) judges[judgeKey][c] = clamp(rating[c] || 5, 1, 10);
    }
  }

  const averages = {};
  for (const c of criteria) {
    const vals = Object.values(judges).map((j) => j[c]).filter(Boolean);
    averages[c] = vals.length > 0 ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : 5;
  }

  const totalScore = parseFloat(
    ((averages.capitalEfficiency + averages.executionFromMorocco + averages.scalability + averages.innovationScore) / 4).toFixed(1)
  );

  return { judges, averages, totalScore };
}

function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

function escapeHtml(text) {
  if (!text) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return isoString; }
}

function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return ""; }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============================================
// Raw Intelligence Feed
// ============================================
let intelData = [];        // full flat list from API
let intelFiltered = [];    // after search + source filter
let intelActiveSource = "all";
let intelSearchQuery = "";

async function loadIntelligenceFeed(forceRefresh = false) {
  const feed = $("#intel-feed");
  const btn = $("#btn-refresh-intel");

  // Show shimmer skeletons
  feed.innerHTML = Array(6).fill(0).map(() => `
    <div class="intel-card shimmer">
      <div class="intel-card-header">
        <span class="intel-source-badge" style="width:80px;height:18px;">&nbsp;</span>
      </div>
      <div class="intel-title" style="height:18px;width:80%;">&nbsp;</div>
      <div class="intel-description" style="height:48px;">&nbsp;</div>
    </div>
  `).join("");

  if (btn) { btn.disabled = true; btn.textContent = "Scraping…"; }

  try {
    const res = await fetch(`${API_BASE}/scrape-preview`, {
      method: forceRefresh ? "POST" : "GET",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    intelData = data.items || [];
    renderIntelStats(data.sourceCounts, data.scrapedAt);
    applyIntelFilters();

    // Update header meta
    const totalEl = $("#intel-total");
    if (totalEl) totalEl.textContent = `${intelData.length} items`;
    const ageEl = $("#intel-age");
    if (ageEl && data.scrapedAt) {
      const ageMin = Math.round((Date.now() - new Date(data.scrapedAt).getTime()) / 60000);
      ageEl.textContent = ageMin < 2 ? "Just scraped" : `${ageMin}m ago`;
    }
  } catch (err) {
    feed.innerHTML = `<div class="intel-no-results">Failed to load: ${escapeHtml(err.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Refresh Cache"; }
  }
}

function renderIntelStats(counts, scrapedAt) {
  const row = $("#intel-stats-row");
  if (!row || !counts) return;

  const sources = [
    { key: "hackerNews",          label: "HN Show",        color: "#f97316" },
    { key: "hackerNewsAsk",       label: "HN Ask",         color: "#fb923c" },
    { key: "reddit",              label: "Reddit",         color: "#ff4500" },
    { key: "productHunt",         label: "Product Hunt",   color: "#da552f" },
    { key: "indieHackers",        label: "Indie Hackers",  color: "#0ea5e9" },
    { key: "acquire",             label: "Acquire.com",    color: "#10b981" },
    { key: "starterStory",        label: "Starter Story",  color: "#8b5cf6" },
    { key: "explodingTopics",     label: "Exploding",      color: "#ec4899" },
    { key: "failory",             label: "Failory",        color: "#ef4444" },
    { key: "bootstrappedFounder", label: "Bootstrapped",   color: "#f59e0b" },
    { key: "devTo",               label: "DEV.to",         color: "#3b49df" },
    { key: "betaList",            label: "BetaList",       color: "#7c3aed" },
    { key: "lobsters",            label: "Lobsters",       color: "#ac130d" },
    { key: "appSumo",             label: "AppSumo",        color: "#f59e0b" },
    { key: "githubTrending",      label: "GitHub",         color: "#8b5cf6" },
    { key: "ycombinator",         label: "YC W25",         color: "#f59e0b" },
    { key: "googleTrends",        label: "Trends",         color: "#10b981" },
  ];

  row.innerHTML = sources
    .filter((s) => (counts[s.key] || 0) > 0)
    .map((s) => `
      <div class="intel-source-stat" style="color:${s.color};border-color:${s.color}30;background:${s.color}10"
           data-source="${s.key}" onclick="setIntelSource('${s.key}')">
        <span class="intel-source-dot" style="background:${s.color}"></span>
        ${s.label} <strong>${counts[s.key]}</strong>
      </div>
    `).join("");
}

function applyIntelFilters() {
  const q = intelSearchQuery.toLowerCase();
  intelFiltered = intelData.filter((item) => {
    const matchSource = intelActiveSource === "all" || item.source === intelActiveSource;
    const matchSearch = !q ||
      (item.title || "").toLowerCase().includes(q) ||
      (item.description || "").toLowerCase().includes(q) ||
      (item.meta || "").toLowerCase().includes(q);
    return matchSource && matchSearch;
  });
  renderIntelFeed(intelFiltered);
}

function renderIntelFeed(items) {
  const feed = $("#intel-feed");
  if (!items || items.length === 0) {
    feed.innerHTML = `<div class="intel-no-results">No items match your filter. Try a different source or search term.</div>`;
    return;
  }
  feed.innerHTML = items.map((item, i) => createIntelCard(item, i)).join("");
}

function createIntelCard(item, index) {
  const color = item.sourceColor || "#00d4ff";
  const hasUrl = item.url && item.url.startsWith("http");
  const titleHtml = hasUrl
    ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>`
    : escapeHtml(item.title);

  const tagsHtml = (item.tags || []).length > 0
    ? `<div class="intel-tags">${item.tags.map((t) => `<span class="intel-tag">${escapeHtml(t)}</span>`).join("")}</div>`
    : "";

  const mrrHtml = item.hasMRR
    ? `<span class="intel-mrr-badge">${escapeHtml(item.meta || "MRR")}</span>`
    : "";

  const scoreHtml = item.score > 0
    ? `<span class="intel-score">${item.score > 999 ? (item.score / 1000).toFixed(1) + "k" : item.score} ${item.source === "githubTrending" ? "★" : "↑"}</span>`
    : "";

  return `
    <div class="intel-card" style="--card-source-color: ${color}" data-index="${index}">
      <div class="intel-card-header">
        <span class="intel-source-badge" style="background:${color}15;color:${color};border:1px solid ${color}30">
          <span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
          ${escapeHtml(item.sourceLabel)}
        </span>
        ${scoreHtml}
      </div>
      <div class="intel-title">${titleHtml}</div>
      ${item.description ? `<div class="intel-description">${escapeHtml(item.description)}</div>` : ""}
      <div class="intel-footer">
        <span class="intel-meta">${item.hasMRR ? "" : escapeHtml(item.meta || "")}</span>
        ${mrrHtml}
        ${tagsHtml}
      </div>
    </div>
  `;
}

function setIntelSource(source) {
  intelActiveSource = source;
  $$(".source-filter-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.source === source);
  });
  applyIntelFilters();
}

function bindIntelEvents() {
  const searchEl = $("#intel-search");
  if (searchEl) {
    searchEl.addEventListener("input", (e) => {
      intelSearchQuery = e.target.value;
      applyIntelFilters();
    });
  }

  $$(".source-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => setIntelSource(btn.dataset.source));
  });

  const refreshBtn = $("#btn-refresh-intel");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => loadIntelligenceFeed(true));
  }
}

// ============================================
// Add Source Modal
// ============================================
const CUSTOM_SOURCES_KEY = "customSources";

function openAddSourceModal() {
  renderSavedSources();
  $("#add-source-modal").style.display = "flex";
  setTimeout(() => $("#source-url").focus(), 50);
}

function closeAddSourceModal() {
  $("#add-source-modal").style.display = "none";
  $("#modal-test-result").style.display = "none";
  $("#source-url").value = "";
  $("#source-label").value = "";
  const rssRadio = document.querySelector('input[name="source-type"][value="rss"]');
  if (rssRadio) rssRadio.checked = true;
}

function getCustomSources() {
  return LS.get(CUSTOM_SOURCES_KEY) || [];
}

function renderSavedSources() {
  const container = $("#modal-saved-sources");
  if (!container) return;
  const sources = getCustomSources();
  if (sources.length === 0) { container.innerHTML = ""; return; }

  container.innerHTML = `
    <div class="saved-sources-title">Saved Sources (${sources.length})</div>
    ${sources.map((s, i) => `
      <div class="saved-source-item">
        <span class="saved-source-label" title="${escapeHtml(s.url)}">${escapeHtml(s.label || s.url)}</span>
        <span class="saved-source-type">${s.type}</span>
        <button class="saved-source-remove" data-index="${i}" title="Remove">✕</button>
      </div>
    `).join("")}
  `;

  container.querySelectorAll(".saved-source-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = getCustomSources();
      list.splice(parseInt(btn.dataset.index), 1);
      LS.set(CUSTOM_SOURCES_KEY, list);
      renderSavedSources();
      rebuildCustomFilterButtons();
    });
  });
}

function rebuildCustomFilterButtons() {
  $$(".source-filter-btn[data-custom]").forEach((b) => b.remove());
  const container = $("#intel-source-filters");
  if (!container) return;
  for (const src of getCustomSources()) {
    const key = `custom_${src.label || src.url}`;
    const btn = document.createElement("button");
    btn.className = "source-filter-btn";
    btn.dataset.source = key;
    btn.dataset.custom = "1";
    btn.textContent = src.label || "Custom";
    btn.addEventListener("click", () => setIntelSource(key));
    container.appendChild(btn);
  }
}

async function testSourceUrl() {
  const url = $("#source-url").value.trim();
  const type = document.querySelector('input[name="source-type"]:checked')?.value || "rss";
  const label = $("#source-label").value.trim() || url;
  const resultEl = $("#modal-test-result");

  if (!url) {
    resultEl.textContent = "Please enter a URL.";
    resultEl.className = "modal-test-result error";
    resultEl.style.display = "block";
    return;
  }

  const testBtn = $("#btn-test-source");
  testBtn.disabled = true;
  testBtn.textContent = "Testing…";
  resultEl.style.display = "none";

  try {
    const res = await fetch(`${API_BASE}/scrape-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testUrl: url, type, label }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const count = data.posts?.length || 0;
    resultEl.textContent = count > 0
      ? `✓ Found ${count} items. First: "${(data.posts[0]?.title || "").slice(0, 60)}"`
      : "⚠ Connected but no items found. Try switching to JSON type.";
    resultEl.className = `modal-test-result ${count > 0 ? "success" : "error"}`;
  } catch (err) {
    resultEl.textContent = `✗ Failed: ${err.message}`;
    resultEl.className = "modal-test-result error";
  } finally {
    resultEl.style.display = "block";
    testBtn.disabled = false;
    testBtn.textContent = "Test URL";
  }
}

function saveCustomSource() {
  const url = $("#source-url").value.trim();
  const label = $("#source-label").value.trim() || url;
  const type = document.querySelector('input[name="source-type"]:checked')?.value || "rss";
  if (!url) return;

  const list = getCustomSources();
  if (list.find((s) => s.url === url)) { showToast("Source already added."); return; }

  list.push({ url, label, type });
  LS.set(CUSTOM_SOURCES_KEY, list);
  renderSavedSources();
  rebuildCustomFilterButtons();
  showToast(`✓ "${label}" added. Click "Scrape Now" to fetch it.`);
  $("#source-url").value = "";
  $("#source-label").value = "";
  $("#modal-test-result").style.display = "none";
}

// Modal wiring — runs after DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = $("#btn-close-modal");
  if (closeBtn) closeBtn.addEventListener("click", closeAddSourceModal);

  const overlay = $("#add-source-modal");
  if (overlay) overlay.addEventListener("click", (e) => { if (e.target === overlay) closeAddSourceModal(); });

  const testBtn = $("#btn-test-source");
  if (testBtn) testBtn.addEventListener("click", testSourceUrl);

  const saveBtn = $("#btn-save-source");
  if (saveBtn) saveBtn.addEventListener("click", saveCustomSource);

  const addBtn = $("#btn-add-source");
  if (addBtn) addBtn.addEventListener("click", openAddSourceModal);

  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAddSourceModal(); });

  // Restore custom filter buttons from localStorage
  rebuildCustomFilterButtons();
});
