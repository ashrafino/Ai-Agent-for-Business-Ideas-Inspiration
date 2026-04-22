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
// Groq free tier — only the 3 best models (429 is per-account, no point trying 7)
const GROQ_MODELS = [
  { model: "llama-3.3-70b-versatile",   ctx: 131072 }, // smartest
  { model: "llama-3.1-8b-instant",      ctx: 131072 }, // ultra-fast, different rate pool
  { model: "gemma2-9b-it",              ctx: 8192   }, // Google model, different rate pool
];

// OpenRouter free tier — ONLY verified working :free models
const OPENROUTER_MODELS = [
  { model: "google/gemma-2-9b-it:free",               ctx: 8192   },
  { model: "mistralai/mistral-7b-instruct:free",      ctx: 32768  },
  { model: "google/gemini-2.0-flash-exp:free",        ctx: 1048576},
  { model: "meta-llama/llama-3.1-8b-instruct:free",   ctx: 131072 },
];

// Google Gemini — direct API, reliable high-quality fallback (placed BEFORE OpenRouter)
// Uses the OpenAI-compatible endpoint: v1beta/openai
const GEMINI_MODELS = [
  { model: "gemini-2.0-flash",          ctx: 1048576 }, // fast, 1M ctx, free quota: 15 RPM
  { model: "gemini-2.0-flash-lite",     ctx: 1048576 }, // faster, very generous free tier
  { model: "gemini-1.5-flash",          ctx: 1048576 }, // proven stable, 15 RPM
  { model: "gemini-1.5-pro",            ctx: 2097152 }, // most capable, 2 RPM free
];

// Models for diversity across judging panel
const MODELS = {
  primary:   "llama-3.3-70b-versatile",
  secondary: "llama-3.1-70b-versatile",
  fast:      "llama-3.1-8b-instant",
};

// ── Rate limit config ─────────────────────────────────────────────────────────
const RATE_LIMIT = {
  minDelayMs:        2000,  // 2s between calls within a single round
  interRoundDelayMs: 4000,  // 4s between rounds to let quotas refill
  maxRetries:        0,     // Zero retries — fail INSTANTLY and move to next model/provider
  backoffBaseMs:     800,
  backoffMultiplier: 1.5,
};

const MAX_CONTEXT_CHARS = 4000; // Increased to allow more memory between agents
const MAX_SCRAPE_CHARS  = 3000; // Increased to allow more data for Scout
let lastCallTimestamp = 0;

// ── Build the full ordered attempt queue ─────────────────────────────────────
function buildAttemptQueue(preferredModel) {
  const queue = [];
  const seen  = new Set();

  const add = (provider, model) => {
    if (!seen.has(model)) { seen.add(model); queue.push({ provider, model }); }
  };

  // Determine provider for preferred model
  const isPreferredGroq = GROQ_MODELS.some((m) => m.model === preferredModel);
  const isPreferredOR   = OPENROUTER_MODELS.some((m) => m.model === preferredModel);
  const isPreferredGem  = GEMINI_MODELS.some((m) => m.model === preferredModel);
  
  if (isPreferredGroq)     add("groq",       preferredModel);
  else if (isPreferredOR)  add("openrouter", preferredModel);
  else if (isPreferredGem) add("gemini",     preferredModel);
  else                     add("groq",       preferredModel);

  // Queue order: Groq (primary) → Gemini (reliable second fallback) → OpenRouter (free but flaky)
  for (const m of GROQ_MODELS)       add("groq",       m.model);
  for (const m of GEMINI_MODELS)     add("gemini",     m.model); // Gemini before OpenRouter
  for (const m of OPENROUTER_MODELS) add("openrouter", m.model);

  console.log(`[Queue] Built attempt queue with ${queue.length} models: ${queue.map(q => q.model).join(", ")}`);
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
// Phase 1: Debate Agents
// ============================================
export const AGENTS = {
  scout: {
    name: "Scout",
    role: "Trend Discovery Agent",
    color: "#00d4ff",
    icon: "🔍",
    systemPrompt: `You are SCOUT, an elite startup intelligence agent. You do NOT generate hypothetical ideas — you EXTRACT validated opportunities from real market data.

You will be given REAL scraped data from Hacker News, Reddit, Product Hunt, Indie Hackers, and GitHub Trending. Your job is to mine this data for the 5 strongest micro-startup opportunities.

HOW TO EXTRACT IDEAS FROM THE DATA:
1. **Reddit Pain Points** → Find posts where people say "need a tool", "paying for", "wish there was", "I'd pay for" — these are VALIDATED demands
2. **Product Hunt Gaps** → Find categories with launches that have weak competition or high engagement — opportunity is WHERE the market is but tools are lacking
3. **Indie Hackers MRR** → If a similar business is making $2k-$10k MRR, that PROVES the market works — build a better/niche version
4. **HN Discussion Topics** → High-comment posts on a tool/problem = high developer interest = B2B opportunity
5. **GitHub Trending** → Trending dev tools = "wrap this as a SaaS" opportunity

STRICT CRITERIA (non-negotiable):
- Launch cost UNDER $500 (Micro-SaaS, AI wrappers, productized services, API businesses)
- NO physical inventory, NO dropshipping, NO generic SMMA
- 100% remote-manageable from Morocco
- Targets global/US/EU markets for geo-arbitrage
- Clear path to recurring revenue (MRR) or high-ticket B2B
- Leverages AI, data engineering, or automation

For EACH of the 5 ideas, provide:
1. **Startup Name** — specific, memorable, niche
2. **Concept** — exact problem solved (be hyper-specific, e.g. "AI-powered GDPR compliance doc generator for EU SaaS" not "AI writing tool")
3. **Evidence** — CITE THE SPECIFIC post, launch, or data point from the scraped feed that validates this (quote the Reddit title, the PH product name, or the IH MRR figure)
4. **Why under $500** — exact tech stack (Claude API + Vercel + Supabase free tier, etc.)
5. **Unfair Advantage** — why a solo data engineer in Morocco wins this specific niche

IMPORTANT: If the scraped data shows a specific pain point or product, reference it directly by name. Do not invent demand that isn't visible in the data.`,
  },


  analyst: {
    name: "Analyst",
    role: "Market Analysis Agent",
    color: "#7c3aed",
    icon: "📊",
    systemPrompt: `You are ANALYST, a rigorous VC market analyst. You evaluate startup ideas through a cold, data-driven lens.

For each idea presented, evaluate:
1. **Market Size**: TAM/SAM/SOM estimate. Is the niche big enough for $10K-$100K MRR?
2. **Competition**: Who else is doing this? What's the competitive moat?
3. **Revenue Model**: Exact pricing strategy. What would customers pay? Monthly/annual/usage-based?
4. **Technical Feasibility**: Can a solo founder with data engineering skills build an MVP in 2-4 weeks?
5. **Customer Acquisition**: Where do target customers hang out? What's the CAC estimate?
6. **Morocco Advantage Score (1-10)**: How well does this leverage the Morocco/geo-arbitrage position?

Be specific with numbers. Don't say "large market" — say "estimated $2.3B global compliance software market growing at 14% CAGR."`,
  },

  critic: {
    name: "Critic",
    role: "Risk Assessment Agent",
    color: "#ef4444",
    icon: "⚡",
    systemPrompt: `You are CRITIC, a brutally honest startup risk assessor. Your job is to DESTROY weak ideas before they waste anyone's time and money.

For each idea, identify:
1. **Fatal Flaws**: What could kill this business in month 1?
2. **Hidden Assumptions**: What unverified assumptions does this idea rely on?
3. **Competition Blind Spots**: Competitors the Scout/Analyst may have missed
4. **Payment/Legal Risks**: Issues specific to a Morocco-based founder (payment processing, legal, banking)
5. **Scalability Ceiling**: At what point does this business hit a wall?
6. **Risk Score (1-10)**: 1 = very safe, 10 = extremely risky

BE MERCILESS. If an idea is a "bad AI wrapper" or has no clear moat, say so. If you don't find at least one fatal flaw, you aren't looking hard enough. Your goal is to prevent the founder from wasting 6 months on a zombie startup.`,
  },

  strategist: {
    name: "Strategist",
    role: "Execution Planning Agent",
    color: "#10b981",
    icon: "🎯",
    systemPrompt: `You are STRATEGIST, a tactical startup execution planner specializing in remote-first, Morocco-based founders.

For each surviving idea, provide:
1. **"Low-Cap" Tech Stack**: EXACT tools. E.g. "Next.js 14 (App Router) + Vercel + Supabase (Auth/DB/Edge Functions) + Resend for Email + Stripe via Atlas."
2. **Week 1-4 Launch Plan**: Specific milestones. Week 1: Scaffolding + Auth. Week 2: Core feature (mention specific GitHub repo to wrap). Week 3: Landing page + SEO. Week 4: Product Hunt Launch.
3. **First 5 Customers Strategy**: Exact subreddits, Discord communities, or X lists to target. Be specific about the "DM script" or value proposition.
4. **Morocco-Specific Setup**: How to handle payments TODAY. Use Stripe Atlas ($500) and Wise. Mention using the $10k/year "International Dotation" on your CIH/Attijari card for initial API/hosting costs.
5. **Monthly Operating Costs**: Itemized list. E.g. "OpenAI API: $20, Vercel: $0, Supabase: $0, Resend: $0. Total: $20/mo."

BE TACTICAL. If an idea uses AI, specify which model (GPT-4o vs Claude 3.5) and why.`,
  },

  judge: {
    name: "Judge",
    role: "Initial Classification Agent",
    color: "#f59e0b",
    icon: "⚖️",
    systemPrompt: `You are JUDGE, the initial arbiter. After reviewing all agent inputs — trends, analysis, criticism, and strategy — produce the initial classification.

Your classification tiers:
- **S-TIER**: Exceptional opportunity. Strong market evidence, low risk, perfect Morocco fit.
- **A-TIER**: Strong opportunity with minor concerns.
- **B-TIER**: Decent opportunity but significant challenges.
- **C-TIER**: Weak opportunity. Too risky, too competitive, or poor fit.

For each idea, provide your classification as a JSON array with this exact structure:
\`\`\`json
[
  {
    "rank": 1,
    "name": "Startup Name",
    "tier": "S",
    "score": 9.2,
    "concept": "One-paragraph description",
    "evidence": "Market evidence and trends",
    "techStack": "Complete tech stack recommendation",
    "executionStrategy": "How to launch from Morocco",
    "unfairAdvantage": "Why this fits a tech/data background",
    "estimatedMRR": "$5K-$15K",
    "launchCost": "$200",
    "timeToRevenue": "4-6 weeks",
    "riskLevel": "low",
    "tags": ["AI", "B2B", "SaaS"],
    "keyRisk": "Main risk to watch",
    "criticalAction": "First thing to do"
  }
]
\`\`\`

Output ONLY the JSON array. No preamble, no explanation. Just valid JSON.`,
  },
};

// ============================================
// Phase 2: Multi-LLM Judging Panel (3 Judges)
// ============================================
export const JUDGING_PANEL = {
  alpha: {
    name: "Judge Alpha",
    role: "Conservative VC Evaluator",
    color: "#f97316",
    icon: "🏛️",
    model: MODELS.primary,
    temperature: 0.3,
    systemPrompt: `You are JUDGE ALPHA, a conservative venture capitalist with 20 years of experience. You are skeptical by nature and only give high scores to ideas with PROVEN market demand.

You must rate each startup idea on exactly 4 criteria, each from 1 to 10:

1. **Capital Efficiency** (1 = Needs millions in VC / 10 = Can start with $0, pure sweat equity)
2. **Execution from Morocco** (1 = Impossible due to legal/banking hurdles / 10 = Fully remote, Stripe-ready, no barriers)
3. **Scalability** (1 = Linear growth only, needs proportional effort / 10 = Exponential growth potential, global reach)
4. **Innovation Score** (1 = Pure copycat of existing products / 10 = Clear first-mover advantage in niche)

Output ONLY a valid JSON array. For each idea:
\`\`\`json
[
  {
    "name": "Startup Name",
    "capitalEfficiency": 8,
    "executionFromMorocco": 7,
    "scalability": 9,
    "innovationScore": 6,
    "rationale": "One sentence explaining your most important scoring decision"
  }
]
\`\`\`
Output ONLY the JSON. No text before or after.`,
  },

  beta: {
    name: "Judge Beta",
    role: "Technical CTO Evaluator",
    color: "#06b6d4",
    icon: "🔧",
    model: MODELS.secondary,
    temperature: 0.5,
    systemPrompt: `You are JUDGE BETA, a technical CTO and engineering leader. You evaluate ideas from a technical feasibility and architecture standpoint.

You must rate each startup idea on exactly 4 criteria, each from 1 to 10:

1. **Capital Efficiency** (1 = Requires expensive infrastructure / 10 = Can run on free tiers and open-source)
2. **Execution from Morocco** (1 = Needs on-site presence or specific jurisdiction / 10 = Pure digital, timezone-agnostic)
3. **Scalability** (1 = Architecture doesn't scale, manual processes / 10 = Cloud-native, auto-scaling, API-first)
4. **Innovation Score** (1 = Commodity tech, no differentiation / 10 = Novel technical approach, hard to replicate)

Output ONLY a valid JSON array. For each idea:
\`\`\`json
[
  {
    "name": "Startup Name",
    "capitalEfficiency": 8,
    "executionFromMorocco": 7,
    "scalability": 9,
    "innovationScore": 6,
    "rationale": "One sentence explaining your most important scoring decision"
  }
]
\`\`\`
Output ONLY the JSON. No text before or after.`,
  },

  gamma: {
    name: "Judge Gamma",
    role: "Market Strategist Evaluator",
    color: "#a855f7",
    icon: "🌍",
    model: MODELS.fast,
    temperature: 0.6,
    systemPrompt: `You are JUDGE GAMMA, a market strategist specializing in emerging markets, geo-arbitrage, and the MENA tech ecosystem.

You must rate each startup idea on exactly 4 criteria, each from 1 to 10:

1. **Capital Efficiency** (1 = High customer acquisition costs / 10 = Organic growth, viral potential, zero-cost distribution)
2. **Execution from Morocco** (1 = Target market requires local presence / 10 = Morocco is a strategic advantage, not a limitation)
3. **Scalability** (1 = Capped addressable market / 10 = Global TAM, network effects, compounding growth)
4. **Innovation Score** (1 = Saturated market with dominant players / 10 = Blue ocean, untapped demand, timing is perfect)

Output ONLY a valid JSON array. For each idea:
\`\`\`json
[
  {
    "name": "Startup Name",
    "capitalEfficiency": 8,
    "executionFromMorocco": 7,
    "scalability": 9,
    "innovationScore": 6,
    "rationale": "One sentence explaining your most important scoring decision"
  }
]
\`\`\`
Output ONLY the JSON. No text before or after.`,
  },
};

// ============================================
// Morocco Implementation Notes Agent
// ============================================
const MOROCCO_AGENT = {
  name: "Morocco Advisor",
  role: "MENA Implementation Specialist",
  color: "#059669",
  icon: "🇲🇦",
  systemPrompt: `You are an expert on doing business from Morocco in the global tech economy (2024-2025 update). You specialize in helping Moroccan founders bypass local banking, legal, and logistical constraints.

For EACH startup idea, provide a detailed "Morocco Implementation Note" as a JSON array:
\`\`\`json
[
  {
    "name": "Startup Name",
    "paymentSolutions": "2024 UPDATE: Stripe Atlas LLC setup ($500) remains the gold standard. Mention Wise Business (using US/UK details) vs local alternatives. Mention Payoneer integration for cashing out to CIH/Attijari. Specifically address how to bypass the 100k MAD dotation limit.",
    "legalStructure": "Recommended legal structure: US Delaware LLC (via Stripe Atlas) vs UK LTD (via 1stFormations). Mention Morocco 'Auto-Entrepreneur' for local tax compliance while billing the foreign LLC as a service provider.",
    "bankingSolutions": "How to move money: foreign LLC -> Wise/Payoneer -> Moroccan Bank (CFG or L'bankalik are more tech-friendly). Mention current Dirham/USD exchange considerations and Office des Changes (OC) 2024 circulars on digital services.",
    "localAdvantages": "Geo-arbitrage (earn USD, spend MAD). Timezone overlap with EU (GMT+1). trilingual advantage (FR/AR/EN) for global support. Emerging tech hubs (Casablanca Technopark, Screendy).",
    "remoteExecution": "How to manage 100% remotely. Internet tips (Maroc Telecom Fiber vs Orange 5G). Coworking spots (The Loft, Kowork).",
    "criticalWarning": "The ONE thing that could go wrong from a Morocco perspective (e.g. frozen funds due to OC, banking delays, or PayPal Morocco limitations) and how to mitigate it."
  }
]
\`\`\`
Output ONLY the JSON. Be extremely specific and actionable.`,
};

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

  // === PHASE 1: 5-Agent Debate ===
  // Context is built incrementally but aggressively summarized at each step
  // to keep tokens under control on free tier models.
  const runAgentRound = async (roundNum, agentKey, prompt, agentContext, opts = {}) => {
    const agent = AGENTS[agentKey];
    console.log(`[VentureLens] Phase 1 — Round ${roundNum}: ${agent.name}...`);
    try {
      const result = await runRound(agent, prompt, agentContext, { ...opts, netlifyContext: options.netlifyContext });
      debateLog.push({ round: roundNum, agent: agentKey, content: result, timestamp: new Date().toISOString() });
      // Append a compact summary line, not the full output, to keep context lean
      const summaryLine = result.length > 600 ? result.slice(0, 600) + "..." : result;
      context += `\n\n=== ${agent.name.toUpperCase()} (Round ${roundNum}) ===\n${summaryLine}`;
      return result;
    } catch (err) {
      console.error(`[VentureLens] Round ${roundNum} (${agentKey}) failed:`, err.message);
      const errorContent = `[${agent.name} skipped — model error]`;
      debateLog.push({ round: roundNum, agent: agentKey, content: err.message, timestamp: new Date().toISOString(), isError: true });
      context += `\n\n=== ${agent.name.toUpperCase()} (SKIPPED) ===\n${errorContent}`;
      return null;
    }
  };

  // Build compact scrape context (truncated) — injected ONLY into Round 1
  const compactScrape = scrapedContext.length > MAX_SCRAPE_CHARS
    ? scrapedContext.slice(0, MAX_SCRAPE_CHARS) + "\n[...data truncated for token efficiency]"
    : scrapedContext;

  // Round 1: Scout — inject scrape context here ONLY
  const scoutPrompt = compactScrape
    ? `${compactScrape}\n\nFrom this market data, extract 5 micro-startup opportunities. Cite specific post titles or product names as evidence. Each idea should have: Name, Concept, Evidence, Why under $500, Unfair Advantage.`
    : "Find 5 micro-startup ideas for a Morocco-based data engineer (under $500 launch). Focus on AI wrappers, micro-SaaS, productized data services with proven demand.";
  await runAgentRound(1, "scout", scoutPrompt, "", { maxTokens: 800 });

  // === Inter-round cooldown: let free-tier quotas refill ===
  console.log(`[VentureLens] ⏳ Cooling down ${RATE_LIMIT.interRoundDelayMs}ms before Round 2...`);
  await delay(RATE_LIMIT.interRoundDelayMs);

  // Round 2: Analyst — context only (no scrape re-injection)
  await runAgentRound(2, "analyst",
    "Analyze the 5 Scout ideas: validate TAM, pricing, competition. Be concise, give specific numbers.",
    context,
    { maxTokens: 600 }
  );

  console.log(`[VentureLens] ⏳ Cooling down ${RATE_LIMIT.interRoundDelayMs}ms before Round 3...`);
  await delay(RATE_LIMIT.interRoundDelayMs);

  // Round 3: Critic — context only
  await runAgentRound(3, "critic",
    "Find fatal flaws in each idea. Be brutally honest. Assign a risk score (1-10) for each.",
    context,
    { maxTokens: 500 }
  );

  console.log(`[VentureLens] ⏳ Cooling down ${RATE_LIMIT.interRoundDelayMs}ms before Round 4...`);
  await delay(RATE_LIMIT.interRoundDelayMs);

  // Round 4: Strategist — context only
  await runAgentRound(4, "strategist",
    "Provide a 4-week launch plan for each idea. Include exact tech stack and monthly costs. Be brief.",
    context,
    { maxTokens: 600 }
  );

  console.log(`[VentureLens] ⏳ Cooling down ${RATE_LIMIT.interRoundDelayMs}ms before Round 5...`);
  await delay(RATE_LIMIT.interRoundDelayMs);

  // Round 5: Initial Judge — JSON only
  const judgeResult = await runAgentRound(5, "judge",
    "Classify all 5 ideas as JSON. Output ONLY the JSON array, no other text.",
    context,
    { maxTokens: 900, temperature: 0.2 }
  );

  // Parse initial ideas (fallback if judge failed)
  let classifiedIdeas = [];
  if (judgeResult) {
    classifiedIdeas = parseJsonOutput(judgeResult);
  }
  
  if (!classifiedIdeas || classifiedIdeas.length === 0) {
    // If we have no ideas because the judge or earlier agents failed, we must create placeholders or abort gracefully
    if (debateLog.some(r => r.round < 5 && !r.isError)) {
       // We have some content, but judge failed. Try a naive extraction from context? 
       // For now, let's just use a failure placeholder so the UI doesn't crash.
       classifiedIdeas = [{ rank: 1, name: "Analysis Interrupted", tier: "C", score: 0, concept: "The analysis encountered multiple model failures and could not complete the full classification. Check the debate logs for partial insights." }];
    } else {
       throw new Error("Analysis failed: All initial agents failed to respond.");
    }
  }

  // === PHASE 2: Multi-LLM Judging Panel ===
  console.log("[VentureLens] Phase 2 — Running Multi-LLM Judging Panel...");

  const runJudgeRound = async (roundNum, judgeKey, ideas, debateContext) => {
    const judge = JUDGING_PANEL[judgeKey];
    console.log(`[VentureLens] Phase 2 — Round ${roundNum}: ${judge.name}...`);
    // Compact idea summary for judges — only send name + concept, not full idea objects
    const compactIdeas = ideas.map(i => ({ name: i.name, concept: i.concept, tier: i.tier, score: i.score }));
    try {
      const result = await runRound(judge, 
        `Rate these startup ideas on 4 criteria (1-10 each). Ideas:\n${JSON.stringify(compactIdeas)}\nOutput ONLY valid JSON.`,
        debateContext, 
        { temperature: judge.temperature, model: judge.model, maxTokens: 600, netlifyContext: options.netlifyContext }
      );
      debateLog.push({ round: roundNum, agent: judgeKey, content: result, timestamp: new Date().toISOString() });
      return result;
    } catch (err) {
      console.error(`[VentureLens] Judge ${judge.name} failed:`, err.message);
      debateLog.push({ round: roundNum, agent: judgeKey, content: `Error: ${err.message}`, timestamp: new Date().toISOString(), isError: true });
      return null;
    }
  };

  // Round 6: Judge Alpha
  console.log(`[VentureLens] ⏳ Cooling down before judging panel...`);
  await delay(RATE_LIMIT.interRoundDelayMs);
  const alphaResult = await runJudgeRound(6, "alpha", classifiedIdeas, "");

  // Round 7: Judge Beta
  await delay(RATE_LIMIT.interRoundDelayMs);
  const betaResult  = await runJudgeRound(7, "beta",  classifiedIdeas, "");

  // Round 8: Judge Gamma
  await delay(RATE_LIMIT.interRoundDelayMs);
  const gammaResult = await runJudgeRound(8, "gamma", classifiedIdeas, "");

  // Parse and average ratings
  const alphaRatings = alphaResult ? parseJsonOutput(alphaResult) : null;
  const betaRatings = betaResult ? parseJsonOutput(betaResult) : null;
  const gammaRatings = gammaResult ? parseJsonOutput(gammaResult) : null;

  const ratingsMap = mergeRatings(classifiedIdeas, { alpha: alphaRatings, beta: betaRatings, gamma: gammaRatings });

  // Attach ratings to ideas
  classifiedIdeas = classifiedIdeas.map((idea, i) => ({
    ...idea,
    ratings: ratingsMap[i] || null,
  }));

  // === PHASE 3: Morocco Implementation Notes ===
  console.log("[VentureLens] Phase 3 — Generating Morocco Implementation Notes...");
  await delay(RATE_LIMIT.interRoundDelayMs);

  let moroccoNotes = null;
  try {
    // Compact idea list for Morocco — only name + concept to minimize tokens
    const ideasForMorocco = classifiedIdeas.map((i) => ({ name: i.name, concept: i.concept }));
    const moroccoResult = await runRound(MOROCCO_AGENT,
      `Generate Morocco Implementation Notes for these ideas:\n${JSON.stringify(ideasForMorocco)}\nOutput ONLY valid JSON array.`,
      "", // no prior context — saves tokens, Morocco agent has enough in its system prompt
      { temperature: 0.4, model: MODELS.fast, maxTokens: 1200, netlifyContext: options.netlifyContext }
    );
    debateLog.push({ round: 9, agent: "morocco", content: moroccoResult, timestamp: new Date().toISOString() });
    moroccoNotes = parseJsonOutput(moroccoResult);
  } catch (err) {
    console.error("[VentureLens] Morocco Agent failed:", err.message);
    debateLog.push({ round: 9, agent: "morocco", content: `Error: ${err.message}`, timestamp: new Date().toISOString(), isError: true });
  }

  // Attach Morocco notes to ideas
  classifiedIdeas = classifiedIdeas.map((idea, i) => ({
    ...idea,
    moroccoNotes: moroccoNotes?.[i] || null,
  }));

  // Sort by composite score (ratings average + initial score)
  classifiedIdeas = classifiedIdeas.map((idea) => {
    const avg = idea.ratings?.averages;
    const compositeScore = avg
      ? ((avg.capitalEfficiency + avg.executionFromMorocco + avg.scalability + avg.innovationScore) / 4).toFixed(1)
      : idea.score || 0;
    return { ...idea, compositeScore: parseFloat(compositeScore) };
  });
  classifiedIdeas.sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0));

  // Re-rank
  classifiedIdeas = classifiedIdeas.map((idea, i) => ({ ...idea, rank: i + 1 }));

  return {
    id: `session_${Date.now()}`,
    timestamp: new Date().toISOString(),
    ideas: classifiedIdeas,
    debate: debateLog,
    phases: { debate: 5, judging: 3, morocco: 1, totalRounds: 9 },
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
