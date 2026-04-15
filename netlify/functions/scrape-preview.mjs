import { scrapeAllSources, scrapeCustomSource } from "./lib/scraper.mjs";
import { verifyAuth } from "./lib/storage.mjs";
import { checkRateLimit } from "./lib/rate-limit.mjs";
import { getProfile, getDefaultWeights } from "./lib/user-profile.mjs";
import { getUserCache, setUserCache, rankItemsForUser } from "./lib/relevance.mjs";
import { formatForUser, formatFallback } from "./lib/llm-formatter.mjs";
import { upsertSourceQuality } from "./lib/source-quality.mjs";
import { INTEREST_DOMAINS } from "./lib/constants.mjs";
import { optimizeScrapeResults } from "./lib/scraper-optimizer.mjs";

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // Single-source test mode — unchanged
    if (body.testUrl) {
      const result = await scrapeCustomSource({ url: body.testUrl, type: body.type || "rss", label: body.label || body.testUrl });
      return { statusCode: 200, headers, body: JSON.stringify({ posts: result.posts, source: result.source, error: result.error }) };
    }

    // ── 1. Auth (optional) ────────────────────────────────────────────────────
    let userId = null;
    try {
      const decoded = verifyAuth(event);
      userId = decoded.id ?? decoded.sub ?? null;
    } catch {
      // unauthenticated — continue with userId = null
    }

    const ip =
      event.headers["x-forwarded-for"] ||
      event.headers["client-ip"] ||
      "0.0.0.0";

    // ── 2. Rate limiting ──────────────────────────────────────────────────────
    const rateLimitResult = await checkRateLimit(userId, ip);
    if (!rateLimitResult.allowed) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({
          error: "rate_limit_exceeded",
          retryAfterSeconds: rateLimitResult.retryAfterSeconds,
        }),
      };
    }

    // ── 3. Domain filter validation ───────────────────────────────────────────
    const domains = Array.isArray(body.domains) ? body.domains : undefined;
    if (domains !== undefined) {
      const invalidValues = domains.filter((d) => !INTEREST_DOMAINS.includes(d));
      if (invalidValues.length > 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "invalid_domain", invalidValues }),
        };
      }
    }

    // ── 4. Load profile ───────────────────────────────────────────────────────
    let userProfile = null;
    if (userId) {
      const profile = await getProfile(userId);
      if (profile) {
        userProfile = profile;
      } else {
        const defaultWeights = getDefaultWeights();
        userProfile = { preferenceWeights: defaultWeights };
      }
    }

    // ── 5. Check user cache (need scrapedAt as globalCacheVersion) ────────────
    // We call scrapeAllSources() first to get the current global cache version.
    // scrapeAllSources() returns cached data if available, so this is cheap.
    let scraped = await scrapeAllSources();
    const globalCacheVersion = scraped.scrapedAt;

    let items = null;
    let usedCache = false;

    if (userId) {
      const cached = await getUserCache(userId, globalCacheVersion);
      if (cached !== null) {
        items = cached;
        usedCache = true;
      }
    }

    // ── 6. Scrape + score (on cache miss) ─────────────────────────────────────
    if (!usedCache) {
      // Optimize (quality-score) the scraped data
      const optimized = await optimizeScrapeResults(scraped);

      // Flatten all items from the optimized result
      const flatItems = flattenScrapedData(optimized);

      // Rank by user relevance if profile exists
      if (userProfile) {
        items = rankItemsForUser(flatItems, userProfile);
      } else {
        items = flatItems;
      }

      // Persist to user cache if authenticated
      if (userId) {
        await setUserCache(userId, globalCacheVersion, items);
      }

      // Record source quality metrics
      if (scraped.sourceMetrics && typeof scraped.sourceMetrics === "object") {
        const metricsEntries = Object.entries(scraped.sourceMetrics);
        await Promise.allSettled(
          metricsEntries.map(([sourceName, metrics]) =>
            upsertSourceQuality(sourceName, metrics)
          )
        );
      }
    }

    // ── 7. Domain filter (post-scoring) ───────────────────────────────────────
    let filteredItems = items;
    if (domains && domains.length > 0) {
      const filterByThreshold = (threshold) =>
        items.filter((item) => {
          const matchedDomains = item.matchedDomains ?? [];
          const relevance = item.relevanceScore ?? 0;
          return (
            relevance >= threshold &&
            matchedDomains.some((d) => domains.includes(d))
          );
        });

      filteredItems = filterByThreshold(30);
      if (filteredItems.length < 5) {
        filteredItems = filterByThreshold(10);
      }
    }

    // ── 8. Format ─────────────────────────────────────────────────────────────
    let llmContext;
    const personalized = userProfile !== null;
    if (userProfile) {
      llmContext = formatForUser(filteredItems, userProfile);
    } else {
      llmContext = formatFallback(scraped);
    }

    // ── 9. Response ───────────────────────────────────────────────────────────
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        items: filteredItems,
        scrapedAt: scraped.scrapedAt,
        durationMs: scraped.durationMs,
        sourceCounts: buildSourceCounts(scraped),
        llmContext,
        personalized,
      }),
    };
  } catch (err) {
    console.error("[scrape-preview] error:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function buildSourceCounts(d) {
  const counts = {
    hackerNews:          d.hackerNews?.posts?.length          || 0,
    hackerNewsAsk:       d.hackerNewsAsk?.posts?.length       || 0,
    reddit:              d.reddit?.posts?.length              || 0,
    productHunt:         d.productHunt?.posts?.length         || 0,
    indieHackers:        d.indieHackers?.posts?.length        || 0,
    githubTrending:      d.githubTrending?.repos?.length      || 0,
    googleTrends:        d.googleTrends?.trends?.length       || 0,
    ycombinator:         d.ycombinator?.companies?.length     || 0,
    devTo:               d.devTo?.posts?.length               || 0,
    betaList:            d.betaList?.posts?.length            || 0,
    lobsters:            d.lobsters?.posts?.length            || 0,
    appSumo:             d.appSumo?.posts?.length             || 0,
    acquire:             d.acquire?.posts?.length             || 0,
    starterStory:        d.starterStory?.posts?.length        || 0,
    explodingTopics:     d.explodingTopics?.posts?.length     || 0,
    failory:             d.failory?.posts?.length             || 0,
    bootstrappedFounder: d.bootstrappedFounder?.posts?.length || 0,
  };
  for (const c of d.custom || []) {
    if (c.posts?.length > 0) counts[`custom_${c.sourceLabel}`] = c.posts.length;
  }
  return counts;
}

function flattenScrapedData(data) {
  const items = [];
  const push = (source, sourceLabel, sourceColor, arr, mapper) => {
    for (const item of arr || []) {
      const mapped = mapper(item);
      if (!mapped.title) continue;
      items.push({ source, sourceLabel, sourceColor, ...mapped });
    }
  };

  push("hackerNews",    "HN Show",           "#f97316", data.hackerNews?.posts,    (p) => ({ id: `hn-${p.url}`,    title: p.title, description: "", url: p.url, score: p.score, meta: `${p.score} pts · ${p.comments} cmts`, _qualityScore: p._qualityScore }));
  push("hackerNewsAsk", "HN Ask",            "#fb923c", data.hackerNewsAsk?.posts, (p) => ({ id: `hn-ask-${p.url}`, title: p.title, description: "", url: p.url, score: p.score, meta: `${p.score} pts · ${p.comments} cmts`, _qualityScore: p._qualityScore }));
  push("reddit",        "Reddit",            "#ff4500", data.reddit?.posts,        (p) => ({ id: `reddit-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: p.score || 0, meta: p.subreddit || "reddit", subreddit: p.subreddit, _qualityScore: p._qualityScore }));
  push("productHunt",   "Product Hunt",      "#da552f", data.productHunt?.posts,   (p) => ({ id: `ph-${p.url || p.title}`, title: p.title, description: p.tagline || p.description || "", url: p.url, score: p.upvotes || 0, meta: p.upvotes ? `${p.upvotes} upvotes` : "", tags: p.tags || [], _qualityScore: p._qualityScore }));
  push("indieHackers",  "Indie Hackers",     "#0ea5e9", data.indieHackers?.posts,  (p) => ({ id: `ih-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: 0, meta: p.mrrHint ? `💰 ${p.mrrHint}` : "", hasMRR: p.hasMRR || false, _qualityScore: p._qualityScore }));
  push("acquire",       "Acquire.com",       "#10b981", data.acquire?.posts,       (p) => ({ id: `acq-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: 0, meta: p.mrrHint ? `💰 ${p.mrrHint}` : "For sale", hasMRR: p.hasMRR || false, _qualityScore: p._qualityScore }));
  push("starterStory",  "Starter Story",     "#8b5cf6", data.starterStory?.posts,  (p) => ({ id: `ss-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: 0, meta: "Proven model", _qualityScore: p._qualityScore }));
  push("explodingTopics","Exploding Topics", "#ec4899", data.explodingTopics?.posts,(p) => ({ id: `et-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: 0, meta: "Trending", _qualityScore: p._qualityScore }));
  push("failory",       "Failory",           "#ef4444", data.failory?.posts,       (p) => ({ id: `fail-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: 0, meta: "Post-mortem", _qualityScore: p._qualityScore }));
  push("bootstrappedFounder","Bootstrapped", "#f59e0b", data.bootstrappedFounder?.posts,(p) => ({ id: `bf-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: 0, meta: "Solo founder", _qualityScore: p._qualityScore }));
  push("devTo",         "DEV.to",            "#3b49df", data.devTo?.posts,         (p) => ({ id: `devto-${p.url}`, title: p.title, description: p.description || "", url: p.url, score: p.score || 0, meta: `${p.score}❤ · ${p.comments} cmts`, tags: p.tags || [], _qualityScore: p._qualityScore }));
  push("betaList",      "BetaList",          "#7c3aed", data.betaList?.posts,      (p) => ({ id: `beta-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: 0, meta: "New launch", _qualityScore: p._qualityScore }));
  push("lobsters",      "Lobsters",          "#ac130d", data.lobsters?.posts,      (p) => ({ id: `lob-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: p.score || 0, meta: `${p.score} pts`, tags: p.tags || [], _qualityScore: p._qualityScore }));
  push("appSumo",       "AppSumo",           "#f59e0b", data.appSumo?.posts,       (p) => ({ id: `as-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url, score: 0, meta: "B2B deal", _qualityScore: p._qualityScore }));
  push("githubTrending","GitHub",            "#8b5cf6", data.githubTrending?.repos,(r) => ({ id: `gh-${r.url}`, title: r.title, description: r.description || "", url: r.url, score: r.starsAdded || 0, meta: `+${r.starsAdded}★/wk · ${r.language}`, _qualityScore: r._qualityScore }));
  push("ycombinator",   "YC W25",            "#f59e0b", data.ycombinator?.companies,(c) => ({ id: `yc-${c.url || c.title}`, title: c.title, description: c.description || "", url: c.url, score: 0, meta: c.batch || "W25", tags: c.tags || [], _qualityScore: c._qualityScore }));
  push("googleTrends",  "Google Trends",     "#10b981", data.googleTrends?.trends, (t) => ({ id: `gt-${t.title}`, title: t.title, description: t.description || "", url: t.url || "", score: 0, meta: "Daily trending", _qualityScore: t._qualityScore }));

  for (const custom of data.custom || []) {
    push(`custom_${custom.sourceLabel}`, custom.sourceLabel || "Custom", "#64748b", custom.posts,
      (p) => ({ id: `custom-${custom.sourceLabel}-${p.url || p.title}`, title: p.title, description: p.description || "", url: p.url || "", score: p.score || 0, meta: "Custom source", _qualityScore: p._qualityScore }));
  }

  // Deduplicate by normalised title
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
