// ============================================
// VentureLens — Groq Multi-Agent + Multi-LLM Rating System
// ============================================

import { scrapeAllSources } from "./scraper.mjs";

// Compact scrape summary — token-efficient, fits in prompt without blowing context
function buildCompactScrapeContext(scraped) {
  const lines = ["=== LIVE MARKET DATA ==="];
  const add = (header, items, fmt) => {
    if (!items?.length) return;
    lines.push(header);
    items.forEach((i) => lines.push(fmt(i)));
  };
  add("[HN SHOW]",    scraped.hackerNews?.posts?.slice(0, 8),    (p) => `• [${p.score}pts] ${p.title}`);
  add("[HN ASK]",     scraped.hackerNewsAsk?.posts?.slice(0, 6), (p) => `• [${p.score}pts] ${p.title}`);
  add("[REDDIT]",     scraped.reddit?.posts?.slice(0, 12),       (p) => `• ${p.subreddit ? `[${p.subreddit}] ` : ""}${p.title}${p.score > 0 ? ` [${p.score}↑]` : ""}${p.description ? `\n  "${p.description.slice(0, 120)}"` : ""}`);
  add("[PRODUCT HUNT]", scraped.productHunt?.posts?.slice(0, 8), (p) => `• ${p.title}${p.upvotes ? ` [${p.upvotes}↑]` : ""}${p.tagline ? ` — ${p.tagline.slice(0, 70)}` : ""}`);
  add("[INDIE HACKERS]", scraped.indieHackers?.posts?.slice(0, 6),(p) => `• ${p.title}${p.mrrHint ? ` [${p.mrrHint}]` : ""}`);
  add("[DEVTO]",      scraped.devTo?.posts?.slice(0, 6),         (p) => `• [${p.score}❤] ${p.title}`);
  add("[BETALIST]",   scraped.betaList?.posts?.slice(0, 6),      (p) => `• ${p.title}${p.description ? ` — ${p.description.slice(0, 70)}` : ""}`);
  add("[APPSUMO]",    scraped.appSumo?.posts?.slice(0, 5),       (p) => `• ${p.title}${p.description ? ` — ${p.description.slice(0, 70)}` : ""}`);
  add("[GITHUB]",     scraped.githubTrending?.repos?.slice(0, 6),(r) => `• ${r.title} [${r.language}, +${r.starsAdded}★/wk]`);
  add("[YC W25]",     scraped.ycombinator?.companies?.slice(0, 6),(c) => `• ${c.title}${c.description ? ` — ${c.description.slice(0, 70)}` : ""}`);
  lines.push("=== END MARKET DATA ===");
  return lines.join("\n");
}

const GROQ_API_URL    = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_API_URL  = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

// ── Model roster ─────────────────────────────────────────────────────────────
// Groq free tier — reliable production-ready models
const GROQ_MODELS = [
  { model: "llama-3.3-70b-versatile",   ctx: 131072 }, // smartest
  { model: "llama-3.1-8b-instant",      ctx: 131072 }, // ultra-fast
  { model: "mixtral-8x7b-32768",        ctx: 32768  }, // reliable fallback
];

// Google Gemini — primary provider (very generous free tier: 15 RPM)
const GEMINI_MODELS = [
  { model: "gemini-2.0-flash",          ctx: 1048576 }, // smartest + fastest
  { model: "gemini-1.5-flash",          ctx: 1048576 }, // stable
  { model: "gemini-2.0-flash-lite",     ctx: 1048576 }, // lite version
];

// OpenRouter free tier — final fallback
const OPENROUTER_MODELS = [
  { model: "google/gemma-2-9b-it:free",               ctx: 8192   },
  { model: "mistralai/mistral-7b-instruct:free",      ctx: 32768  },
  { model: "google/gemini-2.0-flash-exp:free",        ctx: 1048576},
];

// Models for specific roles
const MODELS = {
  primary:   "gemini-2.0-flash",
  secondary: "llama-3.3-70b-versatile",
  fast:      "gemini-1.5-flash",
};

// ── Rate limit config ─────────────────────────────────────────────────────────
const RATE_LIMIT = {
  minDelayMs:        1000,  // Reduced to 1s
  interRoundDelayMs: 2000,  // Reduced to 2s
  maxRetries:        1,     // One retry allowed
  backoffBaseMs:     1000,
  backoffMultiplier: 2,
};

const MAX_CONTEXT_CHARS = 5000; // Increased context
const MAX_SCRAPE_CHARS  = 4000; // Increased scrape data
let lastCallTimestamp = 0;

// ── Build the full ordered attempt queue ─────────────────────────────────────
function buildAttemptQueue(preferredModel) {
  const queue = [];
  const seen  = new Set();

  const add = (provider, model) => {
    if (!seen.has(model)) { seen.add(model); queue.push({ provider, model }); }
  };

  // 1. Preferred model first
  const isGem  = GEMINI_MODELS.some((m) => m.model === preferredModel);
  const isGroq = GROQ_MODELS.some((m) => m.model === preferredModel);
  const isOR   = OPENROUTER_MODELS.some((m) => m.model === preferredModel);
  
  if (isGem)       add("gemini",     preferredModel);
  else if (isGroq) add("groq",       preferredModel);
  else if (isOR)   add("openrouter", preferredModel);
  else             add("gemini",     MODELS.primary);

  // 2. All Gemini models (most reliable free tier)
  for (const m of GEMINI_MODELS)     add("gemini",     m.model);
  // 3. All Groq models
  for (const m of GROQ_MODELS)       add("groq",       m.model);
  // 4. All OpenRouter models
  for (const m of OPENROUTER_MODELS) add("openrouter", m.model);

  return queue;
}

export async function callGroq(messages, { temperature = 0.7, maxTokens = 2048, model = MODELS.primary, netlifyContext = null } = {}) {
  const groqKey   = process.env.GROQ_API_KEY;
  const orKey     = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Local failure tracking — ensures every agent call starts with a full queue of potential models.
  const failedModels  = new Set();
  const deadProviders = new Set();

  // Enforce minimum delay between calls
  const elapsed = Date.now() - lastCallTimestamp;
  if (elapsed < RATE_LIMIT.minDelayMs) await delay(RATE_LIMIT.minDelayMs - elapsed);

  const queue = buildAttemptQueue(model);
  let lastError;

  for (const { provider, model: currentModel } of queue) {
    // Skip models/providers already known to be broken this SPECIFIC call
    if (failedModels.has(currentModel))    { console.log(`[Skip] ${currentModel} - already failed`); continue; }
    if (deadProviders.has(provider))       { console.log(`[Skip] ${provider} - provider dead`); continue; }

    console.log(`[Trying] ${provider} / ${currentModel}`);
    
    const isGroq   = provider === "groq";
    const isGemini = provider === "gemini";
    let   apiKey, apiUrl;

    if (isGroq) {
      apiKey = groqKey;
      apiUrl = GROQ_API_URL;
    } else if (isGemini) {
      apiKey = geminiKey;
      apiUrl = GEMINI_API_URL;
    } else {
      apiKey = orKey;
      apiUrl = "https://openrouter.ai/api/v1/chat/completions";
    }

    if (!apiKey) { console.log(`[Skip] ${provider} - no API key configured`); continue; } // provider key not configured

    for (let attempt = 0; attempt <= RATE_LIMIT.maxRetries; attempt++) {
      try {
        // Dynamic timeout management for Netlify
        // Netlify Functions have a hard 30s limit. We must ensure we don't exceed it.
        let timeoutMs = 28000; // Default 28s (up from 22s — debate-round has 90s total)
        if (netlifyContext?.getRemainingTimeInMillis) {
          const remaining = netlifyContext.getRemainingTimeInMillis();
          // We need at least 3s buffer for post-processing/returning
          timeoutMs = Math.min(timeoutMs, remaining - 3000);
          
          if (timeoutMs < 2000) {
            console.error(`[VentureLens] Not enough time left in lambda (${remaining}ms). Stopping model attempts.`);
            throw new Error(`Netlify function timeout approaching (${remaining}ms remaining). Tried ${failedModels.size} models so far.`);
          }
        }

        lastCallTimestamp = Date.now();
        console.log(`[VentureLens] Round attempt: ${provider} / ${currentModel} (Attempt ${attempt + 1})`);

        const headers = {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type":  "application/json",
        };
        // OpenRouter needs attribution headers
        if (!isGroq && !isGemini) {
          headers["HTTP-Referer"] = "https://venturelens.app";
          headers["X-Title"]      = "VentureLens";
        }

        const response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: currentModel, messages, temperature, max_tokens: maxTokens }),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
          const errText = await response.text();
          const isHtml = errText.trim().toLowerCase().startsWith("<!doctype") || errText.trim().toLowerCase().startsWith("<html");
          
          // === 429 Rate Limit: skip the MODEL, not the provider ===
          // Groq & Gemini have per-model rate pools, so the next model may have quota
          if (response.status === 429) {
            console.warn(`[${provider}] ⚠️ Rate limited (429) on ${currentModel}. Skipping model, trying next in ${provider}...`);
            failedModels.add(currentModel);
            lastError = new Error(`${provider} rate limited (429) on ${currentModel}`);
            // Brief cooldown before trying next model in same provider
            await delay(3000);
            break;
          }

          // === 402 Payment Required: Kill the provider (account issue) ===
          if (response.status === 402) {
            console.warn(`[${provider}] 🛑 Payment required (402) on ${currentModel}. Killing ENTIRE ${provider} provider.`);
            deadProviders.add(provider);
            failedModels.add(currentModel);
            lastError = new Error(`${provider} requires payment (402): ${errText.slice(0, 150)}`);
            break;
          }

          // === 401/403 Auth errors ===
          if (response.status === 401 || response.status === 403) {
            // OpenRouter 401s are often per-model upstream errors
            if (!isGroq && !isGemini && response.status === 401) {
              console.warn(`[${provider}] Model-specific auth error on ${currentModel}. Skipping model.`);
              failedModels.add(currentModel);
              break;
            }
            console.error(`[${provider}] Fatal auth error (${response.status}). Killing provider.`);
            deadProviders.add(provider);
            break;
          }

          // === Transient 5xx / HTML errors / 408 — retry if allowed ===
          const isTransient = response.status === 408 || response.status >= 500 || isHtml;
          if (isTransient && attempt < RATE_LIMIT.maxRetries) {
            const wait = RATE_LIMIT.backoffBaseMs * Math.pow(RATE_LIMIT.backoffMultiplier, attempt);
            console.warn(`[${provider}] Transient error (${response.status}) on ${currentModel}. Retrying in ${wait}ms...`);
            await delay(wait);
            continue;
          }

          // === All other errors (404, 400, etc.) — skip model ===
          lastError = new Error(`API error (${response.status}) on ${currentModel}: ${isHtml ? "HTML error" : errText.slice(0, 200)}`);
          console.warn(`[${provider}] ${currentModel} → HTTP ${response.status}, skipping model.`);
          failedModels.add(currentModel);
          break;
        }

        const data = await response.json();
        console.log(`[${provider}] ✓ ${currentModel}`);
        return data.choices[0].message.content;

      } catch (err) {
        lastError = err;
        const isTimeout = err.name === "TimeoutError" || err.message.includes("timeout");
        
        if (attempt < RATE_LIMIT.maxRetries && !isTimeout) {
          const wait = RATE_LIMIT.backoffBaseMs * Math.pow(RATE_LIMIT.backoffMultiplier, attempt);
          console.warn(`[${provider}] Network error on ${currentModel} (attempt ${attempt + 1}): ${err.message}. Retrying in ${wait}ms...`);
          await delay(wait);
        } else {
          console.warn(`[${provider}] ${currentModel} failed (${isTimeout ? "timeout" : err.message}). Skipping to next model...`);
          failedModels.add(currentModel);
          break; // Move to next model in queue
        }
      }
    }
  }

  // Provide detailed error message showing what was tried
  const triedModels    = Array.from(failedModels).join(", ");
  const triedProviders = Array.from(deadProviders).join(", ");
  
  let errorMsg = `All models exhausted. Tried ${failedModels.size} models${triedModels ? `: ${triedModels}` : ""}. Dead providers: ${triedProviders || "none"}. Last error: ${lastError?.message || "unknown"}`;
  
  const openRouterFailed = Array.from(failedModels).some(m => m.includes("/") || m.includes(":free"));
  const groqFailed       = Array.from(failedModels).some(m => m.includes("llama") || m.includes("mixtral") || m.includes("gemma2"));
  const geminiFailed     = Array.from(failedModels).some(m => m.includes("gemini"));
  
  if (geminiFailed && groqFailed && openRouterFailed) {
    errorMsg += "\n\nℹ️ All three providers (Groq, OpenRouter, Gemini) failed. Check your API keys and rate limits.";
  } else if (groqFailed && openRouterFailed) {
    errorMsg += "\n\nℹ️ Groq and OpenRouter failed — Gemini should have stepped in. Check GEMINI_API_KEY.";
  } else if (openRouterFailed && !groqFailed) {
    errorMsg += "\n\nℹ️ OpenRouter API issue. Check your OPENROUTER_API_KEY at https://openrouter.ai/";
  } else if (groqFailed && !openRouterFailed) {
    errorMsg += "\n\nℹ️ Groq API issue. Check your GROQ_API_KEY or you may have hit rate limits.";
  }
  
  throw new Error(errorMsg);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// Phase 1: Debate Agents (Consolidated for Speed & Stability)
// ============================================
export const AGENTS = {
  scout: {
    name: "Scout",
    role: "Trend Discovery Agent",
    color: "#00d4ff",
    icon: "🔍",
    systemPrompt: `You are SCOUT, an elite startup intelligence agent. You EXTRACT validated opportunities from real market data.

HOW TO EXTRACT IDEAS:
1. **Reddit Pain Points** → Find "need a tool", "I'd pay for" — VALIDATED demands.
2. **Product Hunt Gaps** → Find categories with high engagement but weak competitors.
3. **Indie Hackers MRR** → Replicate proven businesses with a niche twist.
4. **HN Discussion** → High-comment posts = high developer interest.
5. **GitHub Trending** → Trending dev tools = "wrap this as a SaaS".

STRICT CRITERIA:
- Launch UNDER $500.
- 100% remote-manageable from Morocco.
- Targets global markets.
- Clear path to MRR.

Provide 5 ideas: Name, Concept, Evidence (Cite SPECIFIC post/product), Tech Stack, Unfair Advantage.`,
  },

  evaluator: {
    name: "Evaluator",
    role: "Analysis & Risk Agent",
    color: "#7c3aed",
    icon: "⚖️",
    systemPrompt: `You are EVALUATOR. You combine the roles of Market Analyst and Brutal Critic.

For each idea from Scout, evaluate:
1. **Market & Revenue**: TAM estimate, pricing strategy ($10k-$100k MRR potential).
2. **Competition**: MOAT and competitive landscape.
3. **FATAL FLAWS**: What could kill this in month 1? BE BRUTAL.
4. **Assumptions**: What unverified claims is this idea relying on?
5. **Risk Score (1-10)**: 1=Safe, 10=Dangerous.

Identify risk scores for EACH idea in this format: [RISK_SCORES: Idea1=8, Idea2=4, ...]`,
  },

  strategist: {
    name: "Strategist",
    role: "Execution & Morocco Agent",
    color: "#10b981",
    icon: "🎯",
    systemPrompt: `You are STRATEGIST. You provide a tactical launch plan integrated with Morocco-specific advice.

For each surviving idea:
1. **Tech Stack**: EXACT tools (e.g. Next.js + Supabase + Stripe Atlas).
2. **4-Week Plan**: Week 1-4 milestones to MVP launch.
3. **First 5 Customers**: EXACT subreddits/channels and "DM script" angle.
4. **Morocco Setup**: Payment solutions (Stripe Atlas/Wise), legal, and banking (CFG/L'bankalik).
5. **Warning**: The ONE thing that could go wrong from a Morocco perspective.

BE TACTICAL.`,
  },

  judge: {
    name: "Judge",
    role: "Final Classification Agent",
    color: "#f59e0b",
    icon: "⚖️",
    systemPrompt: `You are JUDGE, the final arbiter. Review all inputs — trends, evaluation, and strategy — and produce the final classification.

Your classification tiers:
- **S-TIER**: Exceptional. Strong evidence, low risk, perfect Morocco fit.
- **A-TIER**: Strong opportunity.
- **B-TIER**: Decent but significant challenges.
- **C-TIER**: Weak or too risky.

Provide classification as a JSON array:
\`\`\`json
[
  {
    "rank": 1,
    "name": "Startup Name",
    "tier": "S",
    "score": 9.2,
    "concept": "Description",
    "evidence": "Evidence",
    "techStack": "Tech stack",
    "executionStrategy": "Strategy",
    "unfairAdvantage": "Advantage",
    "estimatedMRR": "$5K-$15K",
    "launchCost": "$200",
    "timeToRevenue": "4-6 weeks",
    "riskLevel": "low",
    "tags": ["AI", "B2B"],
    "keyRisk": "Main risk",
    "criticalAction": "First action",
    "moroccoNotes": {
       "payment": "Stripe/Wise",
       "legal": "LLC/UK",
       "warning": "OC/Tax"
    }
  }
]
\`\`\`
Output ONLY valid JSON array.`,
  },
};

// Phase 2 is deprecated in favor of consolidated agents.
export const JUDGING_PANEL = {};
export const MOROCCO_AGENT = {};

// ============================================
// Run single debate round
// ============================================
export async function runRound(agent, userMessage, previousContext = "", options = {}) {
  const messages = [{ role: "system", content: agent.systemPrompt }];

  if (previousContext) {
    // Aggressive truncation — keep only the TAIL of context (most recent = most relevant)
    let ctx = previousContext;
    if (ctx.length > MAX_CONTEXT_CHARS) {
      ctx = "[Earlier rounds summarized — focusing on most recent context]\n..." + ctx.slice(-MAX_CONTEXT_CHARS);
    }
    messages.push({
      role: "user",
      content: `Context from previous rounds (summarized):\n\n${ctx}`,
    });
    messages.push({
      role: "assistant",
      content: "Understood. Proceeding.",
    });
  }

  messages.push({ role: "user", content: userMessage });

  return callGroq(messages, {
    temperature: options.temperature ?? 0.7,
    maxTokens:   options.maxTokens   ?? 800,  // Default 800 — sufficient for structured output
    model:       options.model       || MODELS.primary,
    netlifyContext: options.netlifyContext,
  });
}

// ============================================
// Run Judging Panel (3 separate LLM instances)
// ============================================
export async function runJudgingPanel(ideas, debateContext, netlifyContext = null) {
  const ideaNames = ideas.map((i) => i.name).join(", ");
  const prompt = `Rate the following startup ideas: ${ideaNames}\n\nHere are the ideas with their details:\n${JSON.stringify(ideas, null, 2)}\n\nRate ALL ideas on the 4 criteria (capitalEfficiency, executionFromMorocco, scalability, innovationScore) from 1-10. Output ONLY valid JSON.`;

  const results = {};

  // Run each judge sequentially (respecting rate limits)
  for (const [key, judge] of Object.entries(JUDGING_PANEL)) {
    let result;
    try {
      result = await runRound(judge, prompt, debateContext, {
        temperature: judge.temperature,
        model: judge.model,
        maxTokens: 1024,
        netlifyContext,
      });
    } catch (err) {
      console.error(`[VentureLens] Judging Panel Error for ${judge.name}:`, err.message);
      result = "ERROR: Model failed to respond.";
    }

    results[key] = {
      raw: result,
      ratings: result.includes("ERROR") ? [] : parseJsonOutput(result),
      agent: { name: judge.name, role: judge.role, color: judge.color, icon: judge.icon },
      timestamp: new Date().toISOString(),
    };
  }

  // Compute averaged ratings
  const averagedRatings = computeAverageRatings(ideas, results);

  return { judges: results, averagedRatings };
}

// ============================================
// Generate Morocco Implementation Notes
// ============================================
export async function generateMoroccoNotes(ideas, debateContext, options = {}) {
  console.log("[VentureLens] Generating Morocco Implementation Notes...");

  const prompt = `Generate detailed Morocco Implementation Notes for these startup ideas:\n${JSON.stringify(ideas.map((i) => ({ name: i.name, concept: i.concept })), null, 2)}\n\nFor EACH idea, provide specific, actionable guidance on payment solutions, legal structure, banking, local advantages, remote execution, and critical warnings. Output ONLY valid JSON.`;

  let result;
  try {
    result = await runRound(MOROCCO_AGENT, prompt, debateContext, {
      temperature: 0.4,
      model: MODELS.primary,
      maxTokens: 2048,
      netlifyContext: options.netlifyContext,
    });
  } catch (err) {
    console.error("[VentureLens] Morocco Notes Error:", err.message);
    result = "[]";
  }

  return {
    raw: result,
    notes: parseJsonOutput(result),
    agent: { name: MOROCCO_AGENT.name, role: MOROCCO_AGENT.role, color: MOROCCO_AGENT.color, icon: MOROCCO_AGENT.icon },
    timestamp: new Date().toISOString(),
  };
}

// ============================================
// Full Debate Pipeline (Phase 1 + 2 + 3)
// ============================================
export async function runFullDebate(options = {}) {
  const debateLog = [];
  let context = "";

  // === SCRAPE REAL DATA FIRST (with 6h cache) ===
  console.log("[VentureLens] Loading market intelligence...");
  let scrapedContext = "";
  try {
    const scrapedData = await scrapeAllSources();
    scrapedContext = buildCompactScrapeContext(scrapedData);
    console.log(`[VentureLens] Market intelligence ready (${scrapedContext.length} chars)`);
  } catch (err) {
    console.warn("[VentureLens] Scraping failed, proceeding with AI-only:", err.message);
  }

  // === PHASE 1: 4-Agent Debate (Consolidated) ===
  const runAgentRound = async (roundNum, agentKey, prompt, agentContext, opts = {}) => {
    const agent = AGENTS[agentKey];
    console.log(`[VentureLens] Phase 1 — Round ${roundNum}: ${agent.name}...`);
    try {
      const result = await runRound(agent, prompt, agentContext, { ...opts, netlifyContext: options.netlifyContext });
      debateLog.push({ round: roundNum, agent: agentKey, content: result, timestamp: new Date().toISOString() });
      context += `\n\n=== ${agent.name.toUpperCase()} (Round ${roundNum}) ===\n${result}`;
      return result;
    } catch (err) {
      console.error(`[VentureLens] Round ${roundNum} (${agentKey}) failed:`, err.message);
      const errorContent = `[${agent.name} skipped — model error]`;
      debateLog.push({ round: roundNum, agent: agentKey, content: err.message, timestamp: new Date().toISOString(), isError: true });
      context += `\n\n=== ${agent.name.toUpperCase()} (SKIPPED) ===\n${errorContent}`;
      return null;
    }
  };

  // Build compact scrape context
  const compactScrape = scrapedContext.length > MAX_SCRAPE_CHARS
    ? scrapedContext.slice(0, MAX_SCRAPE_CHARS) + "\n[...data truncated]"
    : scrapedContext;

  // Round 1: Scout
  const scoutPrompt = compactScrape
    ? `${compactScrape}\n\nFrom this market data, extract 5 micro-startup opportunities. Cite specific titles as evidence. Each idea: Name, Concept, Evidence, Tech Stack, Unfair Advantage.`
    : "Find 5 micro-startup ideas for a Morocco-based data engineer (under $500 launch). Focus on AI wrappers, micro-SaaS, and productized data services.";
  await runAgentRound(1, "scout", scoutPrompt, "", { maxTokens: 1500 });

  await delay(RATE_LIMIT.interRoundDelayMs);

  // Round 2: Evaluator (Analyst + Critic)
  await runAgentRound(2, "evaluator",
    "Analyze each idea: validate TAM, pricing, and MOAT. THEN, find fatal flaws in each. Assign risk scores: [RISK_SCORES: Idea1=8, Idea2=4, ...]",
    context,
    { maxTokens: 1500 }
  );

  await delay(RATE_LIMIT.interRoundDelayMs);

  // Round 3: Strategist (Execution + Morocco)
  await runAgentRound(3, "strategist",
    "Provide a 4-week launch plan for each. Include exact tech stack AND Morocco-specific payment/legal/banking solutions.",
    context,
    { maxTokens: 1500 }
  );

  await delay(RATE_LIMIT.interRoundDelayMs);

  // Round 4: Judge (Final Classification)
  const judgeResult = await runAgentRound(4, "judge",
    "Classify all ideas as JSON. Output ONLY the JSON array, no preamble.",
    context,
    { maxTokens: 2500, temperature: 0.2 }
  );

  // Parse results
  let classifiedIdeas = [];
  if (judgeResult) {
    classifiedIdeas = parseJsonOutput(judgeResult);
  }
  
  if (!classifiedIdeas || classifiedIdeas.length === 0) {
    if (debateLog.some(r => r.round < 4 && !r.isError)) {
       classifiedIdeas = [{ rank: 1, name: "Analysis Interrupted", tier: "C", score: 0, concept: "The analysis encountered multiple model failures and could not complete the full classification." }];
    } else {
       throw new Error("Analysis failed: All initial agents failed to respond.");
    }
  }

  // Sort and re-rank
  classifiedIdeas = classifiedIdeas.map((idea, i) => ({
    ...idea,
    compositeScore: parseFloat(idea.score || 0),
    rank: i + 1
  }));
  classifiedIdeas.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

  return {
    id: `session_${Date.now()}`,
    timestamp: new Date().toISOString(),
    ideas: classifiedIdeas,
    debate: debateLog,
    phases: { debate: 1, evaluation: 1, implementation: 1, judging: 1, totalRounds: 4 },
    status: "complete",
  };
}

// ============================================
// Best of Day Compilation
// ============================================
export function compileBestOfDay(allIdeasToday, date) {
  if (!allIdeasToday || allIdeasToday.length === 0) {
    return { date, ideas: [], totalRuns: 0, generatedAt: new Date().toISOString() };
  }

  // De-duplicate by name (keep higher scoring version)
  const ideaMap = new Map();
  for (const idea of allIdeasToday) {
    const key = (idea.name || "").toLowerCase().trim();
    const existing = ideaMap.get(key);
    if (!existing || (idea.compositeScore || 0) > (existing.compositeScore || 0)) {
      ideaMap.set(key, idea);
    }
  }

  // Sort by composite score
  const ranked = Array.from(ideaMap.values())
    .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))
    .slice(0, 10) // Top 10
    .map((idea, i) => ({ ...idea, dayRank: i + 1 }));

  return {
    date,
    ideas: ranked,
    totalIdeasAnalyzed: allIdeasToday.length,
    uniqueIdeas: ideaMap.size,
    topScore: ranked[0]?.compositeScore || 0,
    generatedAt: new Date().toISOString(),
  };
}

// ============================================
// JSON Parsing Helpers
// ============================================
function parseJsonOutput(content) {
  if (!content) return [];
  try {
    let jsonStr = content;
    // Extract from markdown code block
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();
    // Find JSON array
    const arrayMatch = jsonStr.match(/\[[\s\S]*\]/);
    if (arrayMatch) jsonStr = arrayMatch[0];
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("[VentureLens] JSON parse error:", e.message);
    return [];
  }
}

function computeAverageRatings(ideas, judgeResults) {
  const criteria = ["capitalEfficiency", "executionFromMorocco", "scalability", "innovationScore"];
  return ideas.map((idea, i) => {
    const scores = {};
    const judgeScores = {};

    for (const [judgeKey, result] of Object.entries(judgeResults)) {
      const rating = result.ratings?.[i];
      if (rating) {
        judgeScores[judgeKey] = {};
        for (const c of criteria) {
          judgeScores[judgeKey][c] = rating[c] || 5;
        }
      }
    }

    // Compute averages
    const averages = {};
    for (const c of criteria) {
      const vals = Object.values(judgeScores).map((s) => s[c] || 5);
      averages[c] = vals.length > 0 ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : 5;
    }

    const totalScore = parseFloat(
      ((averages.capitalEfficiency + averages.executionFromMorocco + averages.scalability + averages.innovationScore) / 4).toFixed(1)
    );

    return { judges: judgeScores, averages, totalScore };
  });
}

function mergeRatings(ideas, allRatings) {
  const criteria = ["capitalEfficiency", "executionFromMorocco", "scalability", "innovationScore"];

  return ideas.map((idea, i) => {
    const judges = {};

    for (const [judgeKey, ratings] of Object.entries(allRatings)) {
      // Try to match by index or by name
      let rating = ratings?.[i];
      if (!rating && ratings) {
        rating = ratings.find((r) => r?.name && idea?.name && r.name.toLowerCase().includes(idea.name.toLowerCase().substring(0, 15)));
      }
      if (rating) {
        judges[judgeKey] = {
          capitalEfficiency: clamp(rating.capitalEfficiency || 5, 1, 10),
          executionFromMorocco: clamp(rating.executionFromMorocco || 5, 1, 10),
          scalability: clamp(rating.scalability || 5, 1, 10),
          innovationScore: clamp(rating.innovationScore || 5, 1, 10),
          rationale: rating.rationale || "",
        };
      }
    }

    // Compute averages
    const averages = {};
    for (const c of criteria) {
      const vals = Object.values(judges).map((j) => j[c]).filter(Boolean);
      averages[c] = vals.length > 0 ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)) : 5;
    }

    const totalScore = parseFloat(
      ((averages.capitalEfficiency + averages.executionFromMorocco + averages.scalability + averages.innovationScore) / 4).toFixed(1)
    );

    return { judges, averages, totalScore };
  });
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ============================================
// Master Curator (Hall of Fame)
// ============================================
export const CURATOR_AGENT = {
  name: "Master Curator",
  role: "Hall of Fame Judge",
  color: "#eab308",
  icon: "🏆",
  systemPrompt: `You are the MASTER CURATOR, an elite VC portfolio manager.
Your job is to decide if a new startup idea is good enough to be added to the "All-Time Top Ideas" Hall of Fame.
You will be given the CURRENT Hall of Fame list, and a list of NEW CANDIDATE ideas.
For EACH candidate idea, you must evaluate if it should be added.
Criteria for adding:
1. It must be highly innovative and distinct from ideas already in the list (no duplicates or slight variations).
2. It must have a high composite score (usually 7.0+).
3. It must clearly present an unfair advantage or unique angle for a Morocco-based founder.

Output ONLY a JSON array with one object per candidate idea:
\`\`\`json
[
  {
    "name": "Candidate Idea Name",
    "admitToHallOfFame": true,
    "rationale": "Why it was admitted or rejected in one sentence"
  }
]
\`\`\`
`,
};

export async function curateTopIdeas(candidates, currentTopIdeas) {
  if (!candidates || candidates.length === 0) return { topIdeas: currentTopIdeas || [], decisions: [] };
  
  const topList = currentTopIdeas || [];
  
  // Only evaluate ideas that scored highly
  const highScoringCandidates = candidates.filter(i => (i.compositeScore || 0) >= 7.0);
  if (highScoringCandidates.length === 0) return { topIdeas: topList, decisions: [] };

  const prompt = `Current Hall of Fame Ideas:\n${JSON.stringify(topList.map(i => ({ name: i.name, concept: i.concept, score: i.compositeScore })), null, 2)}\n\nNew Candidates to Evaluate:\n${JSON.stringify(highScoringCandidates.map(i => ({ name: i.name, concept: i.concept, score: i.compositeScore })), null, 2)}\n\nEvaluate each candidate and return the JSON array. Output ONLY valid JSON.`;

  try {
    const result = await runRound(CURATOR_AGENT, prompt, "", { temperature: 0.3, maxTokens: 1500 });
    const decisions = parseJsonOutput(result);

    const newTopIdeas = [...topList];
    
    // Add accepted ideas
    for (const desc of decisions) {
      if (desc.admitToHallOfFame) {
        const fullIdea = highScoringCandidates.find(c => c.name === desc.name);
        if (fullIdea) {
          fullIdea.curatorRationale = desc.rationale;
          fullIdea.addedAt = new Date().toISOString();
          newTopIdeas.push(fullIdea);
        }
      }
    }

    // Sort the hall of fame by score descending and deduplicate by name
    const uniqueTopIdeas = [];
    const usedNames = new Set();
    newTopIdeas
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .forEach(idea => {
        const nameLower = idea.name.toLowerCase().trim();
        if (!usedNames.has(nameLower)) {
          usedNames.add(nameLower);
          uniqueTopIdeas.push(idea);
        }
      });

    return { 
      topIdeas: uniqueTopIdeas.slice(0, 50), // keep max 50 in hall of fame
      decisions 
    };
  } catch (error) {
    console.error("[VentureLens] Curator error:", error);
    return { topIdeas: topList, decisions: [] }; 
  }
}
