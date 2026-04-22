/**
 * Advanced Scraper Optimization Module
 * 
 * Uses NLP techniques, keyword scoring, and content analysis to ensure
 * high-quality startup ideas are consistently fed to the AI analysis pipeline.
 */

import { getSourceQuality, getCredibilityMultiplier } from "./source-quality.mjs";

// ── Scoring Weights ───────────────────────────────────────────────────────────
const WEIGHTS = {
  // Signal strength multipliers
  VALIDATION_SIGNAL: 3.0,    // Revenue, MRR, customers mentioned
  PAIN_POINT_SIGNAL: 2.5,    // Clear problem statements
  STARTUP_RELEVANCE: 2.0,    // SaaS, micro-SaaS, bootstrapped keywords
  ENGAGEMENT: 1.5,           // Upvotes, comments, social proof
  RECENCY: 1.2,              // Recent posts get slight boost
  MAKER_CREDIBILITY: 1.3,    // Known makers, verified accounts
  
  // Penalty multipliers (more aggressive to filter out "unrelevant" data)
  SPAM_PENALTY: 0.05,        // Promotional, clickbait content
  VAGUE_PENALTY: 0.4,        // Too generic, no specifics
  OFF_TOPIC_PENALTY: 0.2,    // Not startup/business related
};

// ── Enhanced Keyword Categories ──────────────────────────────────────────────
const KEYWORD_CATEGORIES = {
  // VALIDATION SIGNALS (highest value - proven traction)
  validation: {
    keywords: [
      // Revenue indicators
      "\\$[\\d,]+\\s*(?:mrr|arr|revenue|monthly|yearly)",
      "\\d+k?\\s*(?:mrr|arr|revenue)",
      "profitable", "profit", "revenue", "paying customers",
      "\\d+\\s*(?:customers|users|subscribers|clients)",
      
      // Traction indicators
      "launched", "live", "shipped", "released", "went live",
      "\\d+\\s*(?:signups|downloads|installs)",
      "product market fit", "pmf", "traction",
      "growing", "scaling", "\\d+%\\s*growth",
      
      // Funding/validation
      "bootstrapped", "self-funded", "profitable from day one",
      "acquired", "exit", "sold for", "raised",
    ],
    weight: 10,
    minMatches: 1,
  },
  
  // PAIN POINTS (high value - clear problems to solve)
  painPoints: {
    keywords: [
      // Explicit needs
      "need a tool", "looking for", "wish there was",
      "is there a", "does anyone know", "how do you",
      "what do you use", "recommend", "alternative to",
      "better than", "frustrated with", "tired of",
      
      // Problem statements
      "problem", "issue", "challenge", "struggle",
      "difficult", "hard to", "impossible to",
      "waste time", "manual process", "tedious",
      "expensive", "costs too much", "overpriced",
      "complicated", "confusing", "not intuitive",
      
      // Workflow gaps
      "missing feature", "would pay for", "willing to pay",
      "automate", "streamline", "simplify",
      "save time", "reduce cost", "improve",
    ],
    weight: 8,
    minMatches: 1,
  },
  
  // STARTUP KEYWORDS (medium-high value)
  startupRelevance: {
    keywords: [
      // Business models
      "saas", "micro-?saas", "b2b", "b2c", "subscription",
      "freemium", "pay-?as-?you-?go", "usage-?based",
      
      // Startup types
      "startup", "side project", "indie hacker", "solo founder",
      "bootstrapped", "lean startup", "mvp", "minimum viable",
      "no-?code", "low-?code", "api", "platform",
      
      // Digital products
      "web app", "mobile app", "chrome extension", "plugin",
      "software", "tool", "service", "automation",
      "ai tool", "ai-?powered", "machine learning",
      
      // Startup activities
      "launch", "build", "ship", "validate", "iterate",
      "pivot", "scale", "grow", "monetize",
    ],
    weight: 6,
    minMatches: 1,
  },
  
  // MARKET SIGNALS (medium value)
  marketSignals: {
    keywords: [
      // Market size
      "market", "industry", "sector", "niche",
      "target audience", "customer segment",
      "\\$\\d+[bm]\\s*market", "growing market",
      
      // Competition
      "competitor", "alternative", "similar to",
      "like \\w+ but", "\\w+ for \\w+",
      
      // Trends
      "trending", "popular", "demand", "opportunity",
      "gap in market", "underserved", "overlooked",
      "remote work", "ai", "automation", "productivity",
    ],
    weight: 4,
    minMatches: 1,
  },
  
  // TECHNICAL SIGNALS (medium value)
  technicalSignals: {
    keywords: [
      // Tech stack (shows execution capability)
      "built with", "using", "powered by", "stack",
      "react", "vue", "next\\.?js", "node", "python",
      "api", "integration", "webhook", "sdk",
      
      // Development stage
      "beta", "alpha", "early access", "waitlist",
      "open source", "github", "repository",
      "documentation", "api docs",
    ],
    weight: 3,
    minMatches: 1,
  },
  
  // OFF-TOPIC INDICATORS (unrelevant to micro-SaaS/startup business)
  offTopic: {
    keywords: [
      "tutorial", "how to build", "learning", "course", "bootcamp",
      "coding challenge", "interview prep", "leetcode", "dsa",
      "personal blog", "life update", "opinion piece", "politics",
      "entertainment", "movie", "gaming", "esports", "streaming",
      "hardware review", "gadget", "smartphone", "gaming laptop",
      "wallpaper", "setup", "desk tour", "mechanical keyboard",
      "recipe", "travel", "photography", "art", "music",
    ],
    weight: -15,
    minMatches: 1,
  },

  // SPAM/LOW-QUALITY INDICATORS (negative signals)
  spam: {
    keywords: [
      // Promotional spam
      "click here", "buy now", "limited time", "act now",
      "amazing deal", "incredible offer", "don't miss",
      "guaranteed", "100% free", "risk-?free",
      
      // Clickbait
      "you won't believe", "shocking", "mind-?blowing",
      "this one trick", "doctors hate", "secret",
      
      // Vague/generic
      "game-?changer", "revolutionary", "disruptive",
      "next big thing", "unicorn", "10x",
      
      // Crypto/scam indicators
      "crypto", "nft", "web3", "blockchain", "airdrop",
      "get rich", "passive income", "make money fast",
      "trading signal", "forex", "binary options",
    ],
    weight: -10,
    minMatches: 1, // Reduced from 2 for stricter filtering
  },
};

// ── NLP-Style Text Analysis ──────────────────────────────────────────────────
export function analyzeContent(text, metadata = {}) {
  const normalized = normalizeText(text);
  
  const analysis = {
    // Keyword category scores
    validationScore: scoreCategory(normalized, KEYWORD_CATEGORIES.validation),
    painPointScore: scoreCategory(normalized, KEYWORD_CATEGORIES.painPoints),
    startupRelevanceScore: scoreCategory(normalized, KEYWORD_CATEGORIES.startupRelevance),
    marketSignalScore: scoreCategory(normalized, KEYWORD_CATEGORIES.marketSignals),
    technicalScore: scoreCategory(normalized, KEYWORD_CATEGORIES.technicalSignals),
    spamScore: scoreCategory(normalized, KEYWORD_CATEGORIES.spam),
    offTopicScore: scoreCategory(normalized, KEYWORD_CATEGORIES.offTopic),
    
    // Content quality metrics
    specificity: calculateSpecificity(normalized),
    readability: calculateReadability(text),
    sentimentPolarity: analyzeSentiment(normalized),
    
    // Metadata signals
    engagementScore: calculateEngagementScore(metadata),
    recencyScore: calculateRecencyScore(metadata),
    credibilityScore: calculateCredibilityScore(metadata),
  };
  
  // Calculate composite quality score
  analysis.qualityScore = calculateQualityScore(analysis);
  analysis.shouldInclude = analysis.qualityScore > 40; // Lowered from 50 to ensure more relevant data reaches AI
  analysis.priority = categorizePriority(analysis.qualityScore);
  
  return analysis;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s$%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCategory(text, category) {
  let matches = 0;
  let matchedKeywords = [];
  
  for (const keyword of category.keywords) {
    const regex = new RegExp(keyword, "gi");
    const keywordMatches = (text.match(regex) || []).length;
    if (keywordMatches > 0) {
      matches += keywordMatches;
      matchedKeywords.push(keyword);
    }
  }
  
  // Only apply weight if minimum matches threshold is met
  if (matches >= category.minMatches) {
    return matches * category.weight;
  }
  
  return 0;
}

// ── Content Quality Metrics ──────────────────────────────────────────────────
function calculateSpecificity(text) {
  // Higher score for specific numbers, URLs, names
  let score = 0;
  
  // Numbers indicate specificity (metrics, prices, etc.)
  const numbers = text.match(/\d+/g) || [];
  score += Math.min(numbers.length * 2, 20);
  
  // URLs indicate real products
  const urls = text.match(/https?:\/\/|www\./g) || [];
  score += urls.length * 3;
  
  // Proper nouns (capitalized words) indicate specific entities
  const properNouns = text.match(/\b[A-Z][a-z]+\b/g) || [];
  score += Math.min(properNouns.length, 15);
  
  // Technical terms indicate depth
  const technicalTerms = [
    "api", "sdk", "integration", "webhook", "oauth",
    "database", "backend", "frontend", "deployment",
  ];
  for (const term of technicalTerms) {
    if (text.includes(term)) score += 2;
  }
  
  return Math.min(score, 50);
}

function calculateReadability(text) {
  // Simple readability score based on sentence structure
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length === 0) return 0;
  
  const avgSentenceLength = text.length / sentences.length;
  
  // Optimal sentence length: 15-25 words (roughly 75-150 chars)
  let score = 50;
  if (avgSentenceLength < 50) score -= 10; // Too short, likely spam
  if (avgSentenceLength > 200) score -= 15; // Too long, hard to parse
  
  // Penalize ALL CAPS
  const capsRatio = (text.match(/[A-Z]/g) || []).length / text.length;
  if (capsRatio > 0.3) score -= 20;
  
  return Math.max(score, 0);
}

function analyzeSentiment(text) {
  // Simple sentiment analysis for problem/solution language
  const positiveWords = [
    "solve", "solution", "improve", "better", "easy", "simple",
    "fast", "efficient", "helpful", "useful", "great", "love",
  ];
  const negativeWords = [
    "problem", "issue", "difficult", "hard", "frustrating", "annoying",
    "slow", "expensive", "complicated", "confusing", "hate", "terrible",
  ];
  
  let sentiment = 0;
  for (const word of positiveWords) {
    if (text.includes(word)) sentiment += 1;
  }
  for (const word of negativeWords) {
    if (text.includes(word)) sentiment -= 1;
  }
  
  // Negative sentiment is actually GOOD for pain points!
  return sentiment;
}

// ── Metadata Scoring ─────────────────────────────────────────────────────────
function calculateEngagementScore(metadata) {
  let score = 0;
  
  // Upvotes/score
  const upvotes = metadata.upvotes || metadata.score || metadata.votes || 0;
  score += Math.log10(upvotes + 1) * 10;
  
  // Comments indicate discussion
  const comments = metadata.comments || metadata.commentsCount || 0;
  score += Math.log10(comments + 1) * 8;
  
  // Shares/retweets
  const shares = metadata.shares || metadata.retweets || 0;
  score += Math.log10(shares + 1) * 5;
  
  return Math.min(score, 50);
}

function calculateRecencyScore(metadata) {
  const now = Date.now();
  const createdAt = metadata.createdAt || metadata.pubDate || metadata.featuredAt;
  
  if (!createdAt) return 25; // Neutral if no date
  
  const ageMs = now - new Date(createdAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  
  // Decay function: 50 points for today, 25 for 7 days, 10 for 30 days
  if (ageDays < 1) return 50;
  if (ageDays < 7) return 40 - (ageDays * 2);
  if (ageDays < 30) return 25 - (ageDays * 0.5);
  return 10;
}

function calculateCredibilityScore(metadata) {
  let score = 25; // Base score
  
  // Known platforms get boost
  const trustedSources = [
    "hackernews", "producthunt", "indiehackers", "ycombinator",
    "github", "devto", "lobsters",
  ];
  const source = (metadata.source || "").toLowerCase();
  if (trustedSources.some(s => source.includes(s))) {
    score += 15;
  }
  
  // Verified makers/authors
  if (metadata.verified || metadata.makers?.length > 0) {
    score += 10;
  }
  
  // Featured/curated content
  if (metadata.featured || metadata.featuredAt) {
    score += 10;
  }
  
  return score;
}

// ── Composite Quality Score ──────────────────────────────────────────────────
function calculateQualityScore(analysis) {
  let score = 0;
  
  // Weighted sum of all signals
  score += analysis.validationScore * WEIGHTS.VALIDATION_SIGNAL;
  score += analysis.painPointScore * WEIGHTS.PAIN_POINT_SIGNAL;
  score += analysis.startupRelevanceScore * WEIGHTS.STARTUP_RELEVANCE;
  score += analysis.marketSignalScore;
  score += analysis.technicalScore;
  score += analysis.spamScore;      // Already negative
  score += analysis.offTopicScore;  // Already negative
  
  // Quality metrics
  score += analysis.specificity * 0.5;
  score += analysis.readability * 0.3;
  
  // Metadata signals
  score += analysis.engagementScore * WEIGHTS.ENGAGEMENT;
  score += analysis.recencyScore * WEIGHTS.RECENCY;
  score += analysis.credibilityScore * WEIGHTS.MAKER_CREDIBILITY;
  
  // Sentiment bonus for pain points (negative sentiment = good)
  if (analysis.sentimentPolarity < 0) {
    score += Math.abs(analysis.sentimentPolarity) * 2;
  }
  
  return Math.max(score, 0);
}

function categorizePriority(qualityScore) {
  if (qualityScore >= 140) return "GOLD"; // Must include - validated traction
  if (qualityScore >= 70) return "HIGH";  // Strong signals
  if (qualityScore >= 40) return "MEDIUM"; // Relevant but needs validation
  return "LOW"; // Filter out
}

// ── Batch Processing ─────────────────────────────────────────────────────────
export async function optimizeScrapeResults(scraped) {
  console.log("[Optimizer] Starting intelligent content filtering...");
  const startTime = Date.now();
  
  const optimized = {
    ...scraped,
    optimizationApplied: true,
    optimizationTimestamp: new Date().toISOString(),
  };
  
  // Process each source
  if (scraped.hackerNews?.posts) {
    optimized.hackerNews.posts = await filterAndRankPosts(scraped.hackerNews.posts, "hackernews");
  }
  if (scraped.hackerNewsAsk?.posts) {
    optimized.hackerNewsAsk.posts = await filterAndRankPosts(scraped.hackerNewsAsk.posts, "hackernews-ask");
  }
  if (scraped.reddit?.posts) {
    optimized.reddit.posts = await filterAndRankPosts(scraped.reddit.posts, "reddit");
  }
  if (scraped.productHunt?.posts) {
    optimized.productHunt.posts = await filterAndRankPosts(scraped.productHunt.posts, "producthunt");
  }
  if (scraped.indieHackers?.posts) {
    optimized.indieHackers.posts = await filterAndRankPosts(scraped.indieHackers.posts, "indiehackers");
  }
  if (scraped.devTo?.posts) {
    optimized.devTo.posts = await filterAndRankPosts(scraped.devTo.posts, "devto");
  }
  if (scraped.betaList?.posts) {
    optimized.betaList.posts = await filterAndRankPosts(scraped.betaList.posts, "betalist");
  }
  if (scraped.lobsters?.posts) {
    optimized.lobsters.posts = await filterAndRankPosts(scraped.lobsters.posts, "lobsters");
  }
  if (scraped.appSumo?.posts) {
    optimized.appSumo.posts = await filterAndRankPosts(scraped.appSumo.posts, "appsumo");
  }
  if (scraped.starterStory?.posts) {
    optimized.starterStory.posts = await filterAndRankPosts(scraped.starterStory.posts, "starterstory");
  }
  
  // GitHub repos
  if (scraped.githubTrending?.repos) {
    optimized.githubTrending.repos = await filterAndRankPosts(scraped.githubTrending.repos, "github");
  }
  
  // YC companies
  if (scraped.ycombinator?.companies) {
    optimized.ycombinator.companies = await filterAndRankPosts(scraped.ycombinator.companies, "yc");
  }
  
  // Custom sources
  if (scraped.custom) {
    optimized.custom = await Promise.all(scraped.custom.map(async customSource => ({
      ...customSource,
      posts: await filterAndRankPosts(customSource.posts || [], "custom"),
    })));
  }
  
  const duration = Date.now() - startTime;
  const beforeCount = countTotal(scraped);
  const afterCount = countTotal(optimized);
  
  console.log(`[Optimizer] Complete: ${beforeCount} → ${afterCount} items (${duration}ms)`);
  console.log(`[Optimizer] Filtered out ${beforeCount - afterCount} low-quality items`);
  
  return optimized;
}

async function filterAndRankPosts(posts, source) {
  if (!Array.isArray(posts) || posts.length === 0) return posts;

  // Load source quality record once for the whole batch
  const sourceRecord = await getSourceQuality(source);
  const credibilityMultiplier = sourceRecord ? getCredibilityMultiplier(sourceRecord) : 1.0;

  // Analyze each post
  const analyzed = posts.map(post => {
    const itemSource = post.source || source;
    const text = `${post.title || ""} ${post.description || ""} ${post.tagline || ""}`;
    const analysis = analyzeContent(text, {
      ...post,
      source: itemSource,
    });

    return {
      ...post,
      _analysis: analysis,
      _qualityScore: analysis.qualityScore * credibilityMultiplier,
      _priority: analysis.priority,
    };
  });
  
  // Filter out low-quality content
  const filtered = analyzed.filter(post => post._analysis.shouldInclude);
  
  // Sort by quality score (highest first)
  filtered.sort((a, b) => b._qualityScore - a._qualityScore);
  
  // Log quality distribution
  const gold = filtered.filter(p => p._priority === "GOLD").length;
  const high = filtered.filter(p => p._priority === "HIGH").length;
  const medium = filtered.filter(p => p._priority === "MEDIUM").length;
  
  if (filtered.length > 0) {
    console.log(`[Optimizer] ${source}: ${filtered.length} posts (🥇${gold} 🥈${high} 🥉${medium})`);
  }
  
  return filtered;
}

function countTotal(scraped) {
  return (
    (scraped.hackerNews?.posts?.length || 0) +
    (scraped.hackerNewsAsk?.posts?.length || 0) +
    (scraped.reddit?.posts?.length || 0) +
    (scraped.productHunt?.posts?.length || 0) +
    (scraped.indieHackers?.posts?.length || 0) +
    (scraped.githubTrending?.repos?.length || 0) +
    (scraped.googleTrends?.trends?.length || 0) +
    (scraped.ycombinator?.companies?.length || 0) +
    (scraped.devTo?.posts?.length || 0) +
    (scraped.betaList?.posts?.length || 0) +
    (scraped.lobsters?.posts?.length || 0) +
    (scraped.appSumo?.posts?.length || 0) +
    (scraped.starterStory?.posts?.length || 0) +
    (scraped.custom?.reduce((a, c) => a + (c.posts?.length || 0), 0) || 0)
  );
}

// ── Export for LLM with Priority Ranking ─────────────────────────────────────
export function formatOptimizedForLLM(optimized) {
  const lines = [
    "=== CURATED MARKET INTELLIGENCE (AI-OPTIMIZED) ===",
    `Scraped: ${optimized.scrapedAt}`,
    `Quality Filter Applied: ${optimized.optimizationApplied ? "YES" : "NO"}`,
    "",
  ];
  
  const addPrioritized = (header, items, fmt) => {
    if (!items?.length) return;
    
    // Separate by priority
    const gold = items.filter(i => i._priority === "GOLD");
    const high = items.filter(i => i._priority === "HIGH");
    const medium = items.filter(i => i._priority === "MEDIUM");
    
    if (gold.length > 0) {
      lines.push(`${header} — 🥇 GOLD TIER (Validated Traction)`);
      gold.slice(0, 5).forEach(i => lines.push(fmt(i)));
      lines.push("");
    }
    
    if (high.length > 0) {
      lines.push(`${header} — 🥈 HIGH PRIORITY`);
      high.slice(0, 3).forEach(i => lines.push(fmt(i)));
      lines.push("");
    }
    
    if (medium.length > 0 && gold.length === 0 && high.length === 0) {
      lines.push(`${header} — 🥉 MEDIUM PRIORITY`);
      medium.slice(0, 2).forEach(i => lines.push(fmt(i)));
      lines.push("");
    }
  };
  
  addPrioritized(
    "[HN SHOW]",
    optimized.hackerNews?.posts,
    (p) => `• [${p.score}pts, Q:${Math.round(p._qualityScore)}] ${p.title}`
  );
  
  addPrioritized(
    "[HN ASK — Pain Points]",
    optimized.hackerNewsAsk?.posts,
    (p) => `• [${p.score}pts, Q:${Math.round(p._qualityScore)}] ${p.title}`
  );
  
  addPrioritized(
    "[REDDIT]",
    optimized.reddit?.posts,
    (p) => `• [${p.subreddit}, ${p.score}↑, Q:${Math.round(p._qualityScore)}] ${p.title}`
  );
  
  addPrioritized(
    "[PRODUCT HUNT]",
    optimized.productHunt?.posts,
    (p) => `• [${p.upvotes}↑, Q:${Math.round(p._qualityScore)}] ${p.title}${p.tagline ? ` — ${p.tagline.slice(0, 60)}` : ""}`
  );
  
  addPrioritized(
    "[INDIE HACKERS]",
    optimized.indieHackers?.posts,
    (p) => `• [Q:${Math.round(p._qualityScore)}] ${p.title}${p.mrrHint ? ` [${p.mrrHint}]` : ""}`
  );
  
  lines.push("=== END CURATED DATA ===");
  return lines.join("\n");
}
