import { AGENTS, JUDGING_PANEL, runRound } from "./lib/groq.mjs";
import { scrapeAllSources, formatScrapedDataForLLM } from "./lib/scraper.mjs";
import { getCuratedLists, queryIdeas } from "./lib/idea-storage.mjs";
import { verifyAuth } from "./lib/storage.mjs";

// Only Round 1 needs fresh market data to find ideas.
// Subsequent rounds (2-4) analyze those specific ideas.
// Round 5 (Judge) might benefit from seeing market context again to verify claims.
const ROUNDS_WITH_MARKET_DATA = new Set([1, 5]);

/**
 * Build context from database + live scrape
 * Prioritizes database ideas (historical best) + fresh scrape (latest trends)
 */
async function buildEnhancedContext(scraped, isSubRound = false) {
  const lines = [];
  
  // Try to get curated ideas from database
  let dbIdeas = null;
  try {
    dbIdeas = await getCuratedLists();
    console.log("[VentureLens] Loaded curated ideas from database");
  } catch (err) {
    console.warn("[VentureLens] Database not available, using live scrape only:", err.message);
  }
  
  if (dbIdeas) {
    lines.push("=== CURATED STARTUP IDEAS DATABASE (Prioritize These) ===");
    // ONLY Gold tier ideas (validated traction) to keep context high quality and relevant
    if (dbIdeas.goldIdeas?.length > 0) {
      lines.push("\n[🥇 GOLD TIER — Validated Traction]");
      for (const idea of dbIdeas.goldIdeas.slice(0, 8)) {
        lines.push(`• [Q:${Math.round(idea.qualityScore)}] ${idea.title} (${idea.source})`);
        if (idea.description) lines.push(`  ${idea.description.slice(0, 120)}...`);
      }
    }
    
    // Only add pain points if we have room and they are high quality
    if (dbIdeas.painPoints?.length > 0) {
      lines.push("\n[💡 HIGH-QUALITY PAIN POINTS]");
      for (const idea of dbIdeas.painPoints.slice(0, 4)) {
        lines.push(`• [Q:${Math.round(idea.qualityScore)}] ${idea.title} (${idea.source})`);
      }
    }
  }
  
  lines.push("\n=== LIVE MARKET DATA (scraped this session) ===");
  
  // Add live scrape data
  const sources = [
    { label: "HN SHOW", posts: scraped.hackerNews?.posts, fmt: (p) => `• [${p.score}pts] ${p.title}` },
    { label: "HN ASK",  posts: scraped.hackerNewsAsk?.posts, fmt: (p) => `• [${p.score}pts] ${p.title}` },
    { label: "REDDIT",  posts: scraped.reddit?.posts, fmt: (p) => `• [${p.subreddit}] ${p.title}` },
    { label: "PRODUCT HUNT", posts: scraped.productHunt?.posts, fmt: (p) => `• ${p.title}${p.upvotes ? ` [${p.upvotes}↑]` : ""} — ${p.tagline || p.description?.slice(0, 60)}` },
    { label: "INDIE HACKERS", posts: scraped.indieHackers?.posts, fmt: (p) => `• ${p.title}${p.mrrHint ? ` [${p.mrrHint}]` : ""}` },
    { label: "GITHUB TRENDING", posts: scraped.githubTrending?.repos, fmt: (r) => `• ${r.title} [${r.language}]` },
    { label: "YC W25", posts: scraped.ycombinator?.companies, fmt: (c) => `• ${c.title} — ${c.description?.slice(0, 60)}` },
  ];

  // More aggressive limits for sub-rounds to keep them focused
  const limit = isSubRound ? 2 : 6;

  for (const src of sources) {
    if (src.posts?.length > 0) {
      lines.push(`\n[${src.label}]`);
      for (const p of src.posts.slice(0, limit)) {
        lines.push(src.fmt(p));
      }
    }
  }

  lines.push("\n=== END MARKET DATA ===");
  return lines.join("\n");
}

// Agent/round mapping for all 9 rounds
const ROUND_CONFIG = {
  1: {
    agent: AGENTS.scout,
    prompt: (ctx) => `${ctx}\n\nUsing the curated database ideas AND live market data above, extract 5 micro-startup opportunities:\n\n1. From GOLD TIER database: Identify patterns and gaps in validated ideas\n2. From PAIN POINTS: Find clear problems people are willing to pay to solve\n3. From VALIDATED ideas: Look for proven traction patterns to replicate\n4. From TRENDING: Spot emerging opportunities with momentum\n5. From LIVE DATA: Find fresh opportunities from today's scrape\n\nPrioritize ideas from the database (they're pre-filtered for quality). Cite SPECIFIC titles, quality scores, and sources as evidence. NO invented demand.`,
    options: { maxTokens: 2500 },
  },
  2: {
    agent: AGENTS.analyst,
    prompt: (_ctx) => `Analyze each of the 5 startup ideas from Scout (in the context above). Validate TAM, pricing, and competition with specific numbers.`,
    options: { maxTokens: 1500 },
  },
  3: {
    agent: AGENTS.critic,
    prompt: (_ctx) => `Challenge every assumption in Scout's ideas and Analyst's evaluation. Be direct. At the end, provide risk scores for EACH idea: [RISK_SCORES: Idea1=8, Idea2=4, ...]`,
    options: { maxTokens: 1200 },
  },
  4: {
    agent: AGENTS.strategist,
    prompt: (_ctx) => `Provide execution plans for each idea from the context above. Include Morocco-specific payment and legal solutions. Be tactical with exact tools and timelines.`,
    options: { maxTokens: 1500 },
  },
  5: {
    agent: AGENTS.judge,
    prompt: () => `Review ALL previous rounds. Produce your classification as a JSON array of 5 startup ideas. Output ONLY valid JSON, no preamble.`,
    options: { maxTokens: 1800 },
  },
  6: {
    agent: { ...JUDGING_PANEL.alpha, systemPrompt: JUDGING_PANEL.alpha.systemPrompt },
    prompt: () => `Rate ALL startup ideas on the 4 criteria (capitalEfficiency, executionFromMorocco, scalability, innovationScore) 1-10. Output ONLY valid JSON array.`,
    options: { temperature: JUDGING_PANEL.alpha.temperature, model: JUDGING_PANEL.alpha.model, maxTokens: 1500 },
  },
  7: {
    agent: { ...JUDGING_PANEL.beta, systemPrompt: JUDGING_PANEL.beta.systemPrompt },
    prompt: () => `Rate ALL startup ideas on the 4 criteria (capitalEfficiency, executionFromMorocco, scalability, innovationScore) 1-10. Output ONLY valid JSON array.`,
    options: { temperature: JUDGING_PANEL.beta.temperature, model: JUDGING_PANEL.beta.model, maxTokens: 1500 },
  },
  8: {
    agent: { ...JUDGING_PANEL.gamma, systemPrompt: JUDGING_PANEL.gamma.systemPrompt },
    prompt: () => `Rate ALL startup ideas on the 4 criteria (capitalEfficiency, executionFromMorocco, scalability, innovationScore) 1-10. Output ONLY valid JSON array.`,
    options: { temperature: JUDGING_PANEL.gamma.temperature, model: JUDGING_PANEL.gamma.model, maxTokens: 1500 },
  },
  9: {
    agent: {
      name: "Morocco Advisor",
      role: "MENA Implementation Specialist",
      color: "#059669",
      icon: "MA",
      systemPrompt: `You are an expert on doing business from Morocco in the global tech economy. For EACH startup idea, provide a "Morocco Implementation Note" as a JSON array with fields: name, paymentSolutions, legalStructure, bankingSolutions, localAdvantages, remoteExecution, criticalWarning. Output ONLY valid JSON.`,
    },
    prompt: () => `Generate Morocco Implementation Notes for all startup ideas discussed. Be concise and specific. Output ONLY valid JSON.`,
    options: { temperature: 0.4, maxTokens: 2000 },
  },
};

export const handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    // 🔒 Enforce Authentication
    const user = verifyAuth(event);
    
    // 🔑 Admin-only gate
    if (user.email !== "achrafbach1@gmail.com") {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: "Only the admin can run analysis." }),
      };
    }

    const { round, context: debateHistory } = JSON.parse(event.body);
    console.log(`[VentureLens] Admin debate round ${round} for ${user.email}`);

    const config = ROUND_CONFIG[round];

    if (!config) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Invalid round: ${round}` }) };
    }

    // Scrape real data for debate rounds 1-5 (uses 6h Blobs cache — fast after first call)
    let scrapedContext = "";
    let sourceCounts = null;

    if (ROUNDS_WITH_MARKET_DATA.has(round)) {
      try {
        console.log(`[VentureLens] Round ${round}: loading market intelligence...`);
        const isSubRound = round > 1; // Only the first round does a fresh scrape
        const scrapedData = await scrapeAllSources({ isSubRound });
        scrapedContext = await buildEnhancedContext(scrapedData, isSubRound);
        sourceCounts = {
          hackerNews:     scrapedData.hackerNews?.posts?.length     || 0,
          hackerNewsAsk:  scrapedData.hackerNewsAsk?.posts?.length  || 0,
          reddit:         scrapedData.reddit?.posts?.length         || 0,
          productHunt:    scrapedData.productHunt?.posts?.length    || 0,
          indieHackers:   scrapedData.indieHackers?.posts?.length   || 0,
          githubTrending: scrapedData.githubTrending?.repos?.length || 0,
          ycombinator:    scrapedData.ycombinator?.companies?.length|| 0,
        };
        const total = Object.values(sourceCounts).reduce((a, b) => a + b, 0);
        console.log(`[VentureLens] Round ${round}: ${total} items loaded`, sourceCounts);
      } catch (err) {
        console.warn(`[VentureLens] Round ${round}: scrape failed (AI-only fallback):`, err.message);
        scrapedContext = "";
      }
    }

    // Build the final prompt — market data prefix + agent-specific instruction
    const finalPrompt = config.prompt(scrapedContext);

    const result = await runRound(config.agent, finalPrompt, debateHistory || "", {
      ...config.options,
      netlifyContext: context, // Pass for dynamic timeout management
    });

    // ── NEW: Early Exit Logic (after Critic round) ───────────────────────────
    let earlyExit = false;
    let exitReason = "";

    if (round === 3) {
      // Look for [RISK_SCORES: Idea1=10, Idea2=10, ...] pattern
      const match = result.match(/\[RISK_SCORES:\s*(.*?)\]/i);
      if (match) {
        const scores = match[1].split(",").map(s => {
          const parts = s.split("=");
          return parts.length > 1 ? parseInt(parts[1].trim()) : 0;
        });
        
        // If ALL ideas have risk score >= 9, exit early
        if (scores.length > 0 && scores.every(s => s >= 9)) {
          earlyExit = true;
          exitReason = "CRITIC STOP: All startup ideas identified in this session are considered too risky or fundamentally flawed to proceed with execution planning. Recommend starting a new analysis with fresh data.";
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        round,
        agent: { name: config.agent.name, role: config.agent.role, color: config.agent.color },
        content: result,
        sources: sourceCounts,
        earlyExit,
        exitReason,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    const isAuthError = error.message.includes("authorization") || error.message.includes("token");
    console.warn("[VentureLens] Debate round error:", error.message);
    return {
      statusCode: isAuthError ? 401 : 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
