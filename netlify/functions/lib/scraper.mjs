import { getStore } from "@netlify/blobs";
import { load as loadHtml } from "cheerio";
import { saveScrapeToDB } from "./storage.mjs";

const FETCH_TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_KEY = "scraper-cache-v5";

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];
const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// ── Reddit OAuth token cache (in-memory, per cold start) ─────────────────────
let _redditToken = null;
let _redditTokenExpiry = 0;

async function getRedditToken() {
  if (_redditToken && Date.now() < _redditTokenExpiry) return _redditToken;

  const clientId     = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  const username     = process.env.REDDIT_USERNAME;
  const password     = process.env.REDDIT_PASSWORD;

  if (!clientId || !clientSecret) {
    console.warn("[Scraper] Reddit credentials not set — falling back to RSS");
    return null;
  }

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  // Use password grant when credentials are available — gives higher rate limits
  // and access to user-specific endpoints
  const body = username && password
    ? `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    : "grant_type=client_credentials";

  const grantType = username && password ? "password" : "client_credentials";

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `VentureLens/1.0 (by /u/${username || "VentureLens"})`,
    },
    body,
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.warn(`[Scraper] Reddit OAuth failed (${res.status}, grant=${grantType}): ${errText}`);
    return null;
  }

  const data = await res.json();
  if (data.error) {
    console.warn(`[Scraper] Reddit OAuth error: ${data.error}`);
    return null;
  }

  _redditToken = data.access_token;
  _redditTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log(`[Scraper] Reddit token acquired (grant=${grantType}, expires in ${data.expires_in}s)`);
  return _redditToken;
}

// ── Reddit subreddits to scrape ───────────────────────────────────────────────
const REDDIT_SUBS = [
  { sub: "SaaS",           sort: "top",  t: "week",  label: "r/SaaS" },
  { sub: "microsaas",      sort: "top",  t: "week",  label: "r/microsaas" },
  { sub: "Entrepreneur",   sort: "top",  t: "week",  label: "r/Entrepreneur" },
  { sub: "startups",       sort: "top",  t: "week",  label: "r/startups" },
  { sub: "indiehackers",   sort: "top",  t: "week",  label: "r/indiehackers" },
  { sub: "nocode",         sort: "top",  t: "week",  label: "r/nocode" },
  { sub: "SideProject",    sort: "top",  t: "week",  label: "r/SideProject" },
  { sub: "webdev",         sort: "hot",  t: "week",  label: "r/webdev" },
];

const SOURCES = {
  hackerNews:        "https://hn.algolia.com/api/v1/search?tags=show_hn&numericFilters=points>50&hitsPerPage=30",
  hackerNewsAsk:     "https://hn.algolia.com/api/v1/search?tags=ask_hn&numericFilters=points>30&hitsPerPage=20",
  productHuntRss:    "https://www.producthunt.com/feed",
  indieHackersRss:   "https://www.indiehackers.com/feed",
  trendsRss:         "https://trends.google.com/trends/trendingsearches/daily/rss?geo=US",
  githubTrendingHtml:    "https://github.com/trending?since=weekly",
  githubTrendingHtmlPy:  "https://github.com/trending/python?since=weekly",
  githubTrendingApis: [
    "https://gh-trending-api.vercel.app/repositories?since=weekly",
  ],
  ycCompanies:       "https://www.ycombinator.com/companies?batch=W25",
  devTo:             "https://dev.to/api/articles?top=7&per_page=30",
  betaListRss:       "https://betalist.com/feed",
  lobsters:          "https://lobste.rs/t/programming,web,api,devops.json",
  appSumoRss:        "https://appsumo.com/feed/",
  // New source added for bootstrapped, <$500 scalable digital startups
  starterStoryRss:   "https://www.starterstory.com/rss.xml",
};

// Broadened keywords to catch lean, digital startups without being too restrictive
const STARTUP_KEYWORDS = [
  "saas", "microsaas", "mrr", "bootstrapped", "digital", "solo", "founder",
  "remote", "automation", "api", "software", "subscription", "no-code", 
  "low-code", "extension", "web app", "micro", "indie", "startup", "tool", "app",
  "profitable", "$", "revenue", "launch", "launched", "customers", "b2b"
];

const PAIN_POINT_KEYWORDS = [
  "need", "tool", "pay", "automate", "wish", "alternative", 
  "replace", "manual", "waste", "app for", "how do you",
  "tired of", "spend hours", "expensive", "hate", "frustrating",
  "problem", "looking for"
];

const PH_TAG_HINTS = ["saas", "productivity", "ai", "automation", "developer", "no-code", "api", "extension", "tool", "app"];
const IH_VALIDATION_HINTS = ["launched", "$", "mrr", "customers", "revenue", "profit", "profitable", "bootstrapped", "users"];
const TREND_HINTS = ["software", "app", "tool", "saas", "ai", "api", "platform", "automation", "remote", "tech"];

// ── Main Entry Point ─────────────────────────────────────────────────────────
export async function scrapeAllSources({ isSubRound = false, customSources = [] } = {}) {
  console.log(`[Scraper] Starting scraping (isSubRound=${isSubRound}, custom=${customSources.length})...`);
  const startTime = Date.now();

  const cached = await loadFromCache();
  if (cached && customSources.length === 0) {
    const ageMin = Math.round((Date.now() - new Date(cached.scrapedAt).getTime()) / 60000);
    // For sub-rounds, we are MUCH more aggressive about using the cache
    if (isSubRound || ageMin < 360) {
      console.log(`[Scraper] Serving from cache (${ageMin}min old)`);
      return cached;
    }
  }

  // If we reach here and it's a sub-round, it means cache is missing or very old.
  // We'll do a fresh scrape but log a warning.
  if (isSubRound) console.warn("[Scraper] Sub-round requested but cache missing/stale. Fresh scrape forced.");

  const [hn, hnAsk, reddit, ph, ih, ghTrending, trends, yc, devTo, betaList, lobsters, appSumo, starterStory] =
    await Promise.allSettled([
      scrapeHackerNews(),
      scrapeHackerNewsAsk(),
      scrapeReddit(),
      scrapeProductHunt(),
      scrapeIndieHackers(),
      scrapeGithubTrending(),
      scrapeGoogleTrends(),
      scrapeYCombinator(),
      scrapeDevTo(),
      scrapeBetaList(),
      scrapeLobsters(),
      scrapeAppSumo(),
      scrapeStarterStory(),
    ]);

  // Scrape any custom user-added sources
  const customResults = await Promise.allSettled(
    customSources.map((src) => scrapeCustomSource(src))
  );

  const scraped = {
    hackerNews:      hn.status      === "fulfilled" ? hn.value      : { posts: [], error: hn.reason?.message },
    hackerNewsAsk:   hnAsk.status   === "fulfilled" ? hnAsk.value   : { posts: [], error: hnAsk.reason?.message },
    reddit:          reddit.status  === "fulfilled" ? reddit.value  : { posts: [], error: reddit.reason?.message },
    productHunt:     ph.status      === "fulfilled" ? ph.value      : { posts: [], error: ph.reason?.message },
    indieHackers:    ih.status      === "fulfilled" ? ih.value      : { posts: [], error: ih.reason?.message },
    githubTrending:  ghTrending.status === "fulfilled" ? ghTrending.value : { repos: [], error: ghTrending.reason?.message },
    googleTrends:    trends.status  === "fulfilled" ? trends.value  : { trends: [], error: trends.reason?.message },
    ycombinator:     yc.status      === "fulfilled" ? yc.value      : { companies: [], error: yc.reason?.message },
    devTo:           devTo.status   === "fulfilled" ? devTo.value   : { posts: [], error: devTo.reason?.message },
    betaList:        betaList.status === "fulfilled" ? betaList.value : { posts: [], error: betaList.reason?.message },
    lobsters:        lobsters.status === "fulfilled" ? lobsters.value : { posts: [], error: lobsters.reason?.message },
    appSumo:         appSumo.status === "fulfilled" ? appSumo.value : { posts: [], error: appSumo.reason?.message },
    starterStory:    starterStory.status === "fulfilled" ? starterStory.value : { posts: [], error: starterStory.reason?.message },
    custom: customResults.map((r, i) => ({
      ...(r.status === "fulfilled" ? r.value : { posts: [], error: r.reason?.message }),
      sourceUrl: customSources[i]?.url,
      sourceLabel: customSources[i]?.label || customSources[i]?.url,
    })),
    scrapedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };

  const total = countTotal(scraped);
  console.log(`[Scraper] Complete: ${total} items in ${scraped.durationMs}ms`);
  
  // DUMP TRUCK: Save everything to our MongoDB Data Lake for future reference!
  await saveScrapeToDB(scraped);
  
  if (customSources.length === 0) await saveToCache(scraped);
  return scraped;
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

// ── Cache ─────────────────────────────────────────────────────────────────────
async function loadFromCache() {
  try {
    const store = getStore("venture-lens-scraper-cache");
    const cached = await store.get(CACHE_KEY, { type: "json" });
    if (!cached?.scrapedAt) return null;
    const age = Date.now() - new Date(cached.scrapedAt).getTime();
    if (age > CACHE_TTL_MS) { console.log(`[Scraper] Cache expired`); return null; }
    return cached;
  } catch (_) { return null; }
}

async function saveToCache(data) {
  try {
    const store = getStore("venture-lens-scraper-cache");
    await store.setJSON(CACHE_KEY, data);
    console.log("[Scraper] Cached in Netlify Blobs");
  } catch (err) {
    console.warn("[Scraper] Cache write failed:", err.message);
  }
}

// ── Hacker News ───────────────────────────────────────────────────────────────
async function scrapeHackerNews() {
  const data = await fetchJSON(SOURCES.hackerNews);
  const posts = (data?.hits || [])
    .filter((s) => s?.title && s.points > 50)
    .map((s) => ({
      title: s.title,
      url: s.url || `https://news.ycombinator.com/item?id=${s.objectID}`,
      score: s.points || 0,
      comments: s.num_comments || 0,
      source: "hackernews-show-hn",
    }))
    .slice(0, 25);
  console.log(`[Scraper] HN Show: ${posts.length}`);
  return { posts, source: "Hacker News Show HN" };
}

async function scrapeHackerNewsAsk() {
  const data = await fetchJSON(SOURCES.hackerNewsAsk);
  const posts = (data?.hits || [])
    .filter((s) => s?.title && s.points > 30)
    .filter((s) => containsAny(s.title, [
      "what do you use", "how do you", "tool for", "alternative to",
      "looking for", "recommend", "best way to", "anyone built", "is there a",
    ]))
    .map((s) => ({
      title: s.title,
      url: `https://news.ycombinator.com/item?id=${s.objectID}`,
      score: s.points || 0,
      comments: s.num_comments || 0,
      source: "hackernews-ask-hn",
    }))
    .slice(0, 15);
  console.log(`[Scraper] HN Ask: ${posts.length}`);
  return { posts, source: "Hacker News Ask HN" };
}

// ── Reddit (OAuth JSON API — full post data) ──────────────────────────────────
async function scrapeReddit() {
  const token = await getRedditToken();

  if (token) {
    return scrapeRedditOAuth(token);
  }
  // Fallback to RSS if no credentials
  return scrapeRedditRss();
}

async function scrapeRedditOAuth(token) {
  const username = process.env.REDDIT_USERNAME || "VentureLens";
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": `VentureLens/1.0 (by /u/${username})`,
    Accept: "application/json",
  };

  const results = await Promise.allSettled(
    REDDIT_SUBS.map(({ sub, sort, t }) =>
      fetchJSON(
        `https://oauth.reddit.com/r/${sub}/${sort}?t=${t}&limit=25`,
        { headers }
      )
    )
  );

  const posts = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].status !== "fulfilled") {
      console.warn(`[Scraper] Reddit r/${REDDIT_SUBS[i].sub} failed`);
      continue;
    }
    const children = results[i].value?.data?.children || [];
    for (const child of children) {
      const p = child.data;
      if (!p?.title) continue;
      posts.push({
        title: p.title,
        description: (p.selftext || "").slice(0, 400),
        url: p.url || `https://reddit.com${p.permalink}`,
        score: p.score || 0,
        comments: p.num_comments || 0,
        subreddit: p.subreddit_name_prefixed || `r/${REDDIT_SUBS[i].sub}`,
        flair: p.link_flair_text || "",
        source: "reddit-oauth",
        feedUrl: `https://reddit.com/r/${REDDIT_SUBS[i].sub}`,
      });
    }
  }

  const filtered = dedupeByTitle(posts)
    // Relaxed filtering: we want ALL high-quality posts, not just pain points.
    .filter((p) => p.score > 20 || containsAny(`${p.title} ${p.description}`, STARTUP_KEYWORDS) || containsAny(`${p.title} ${p.description}`, PAIN_POINT_KEYWORDS))
    .sort((a, b) => b.score - a.score)
    .slice(0, 50);

  // ── NEW: Fetch top comments for the best pain points ───────────────────────
  const painPoints = filtered
    .filter((p) => containsAny(`${p.title} ${p.description}`, PAIN_POINT_KEYWORDS))
    .slice(0, 5); // top 5 pain point threads (reduced from 8 for speed)

  if (painPoints.length > 0) {
    console.log(`[Scraper] Fetching comments for ${painPoints.length} Reddit pain point threads...`);
    await Promise.allSettled(
      painPoints.map(async (p) => {
        try {
          // permalink is e.g. "/r/SaaS/comments/abc/title/"
          const commentUrl = `https://oauth.reddit.com${p.url.includes("reddit.com") ? new URL(p.url).pathname : p.url}.json?limit=3&sort=top`;
          const data = await fetchJSON(commentUrl, { headers });
          // Reddit comments JSON is [postData, commentData]
          const comments = data[1]?.data?.children || [];
          const topComments = comments
            .slice(0, 3) // reduced from 5 for speed
            .map((c) => c.data?.body)
            .filter(Boolean)
            .map((text) => text.slice(0, 250)) // reduced from 300
            .join(" | ");
          
          if (topComments) {
            p.description = `${p.description}\n[TOP COMMENTS]: ${topComments}`;
          }
        } catch (err) {
          console.warn(`[Scraper] Failed to fetch comments for ${p.url}:`, err.message);
        }
      })
    );
  }

  console.log(`[Scraper] Reddit OAuth: ${filtered.length} posts from ${REDDIT_SUBS.length} subs`);
  return { posts: filtered, source: "Reddit OAuth API" };
}

async function scrapeRedditRss() {
  const rssUrls = REDDIT_SUBS.slice(0, 4).map(
    ({ sub, sort, t }) => `https://www.reddit.com/r/${sub}/${sort}/.rss?t=${t}`
  );
  const feeds = await Promise.allSettled(
    rssUrls.map((url) => fetchText(url, { headers: { Accept: "application/rss+xml" } }))
  );
  const posts = [];
  for (let i = 0; i < feeds.length; i++) {
    if (feeds[i].status === "fulfilled") {
      posts.push(...parseRss(feeds[i].value, "reddit-rss", rssUrls[i]));
    }
  }
  const filtered = dedupeByTitle(posts)
    // Relaxed filtering for RSS too!
    .filter((p) => containsAny(`${p.title} ${p.description}`, STARTUP_KEYWORDS) || containsAny(`${p.title} ${p.description}`, PAIN_POINT_KEYWORDS))
    .slice(0, 30);
  console.log(`[Scraper] Reddit RSS fallback: ${filtered.length}`);
  return { posts: filtered, source: "Reddit RSS" };
}

// ── Product Hunt ──────────────────────────────────────────────────────────────
async function scrapeProductHunt() {
  const xml = await fetchText(SOURCES.productHuntRss);
  const posts = parseRss(xml, "producthunt")
    .map((p) => ({
      ...p,
      upvotes: parseUpvotes(p.description),
      tags: PH_TAG_HINTS.filter((tag) => `${p.title} ${p.description}`.toLowerCase().includes(tag)),
    }))
    .filter((p) => p.tags.length > 0 || p.upvotes > 0)
    .slice(0, 20);
  console.log(`[Scraper] Product Hunt: ${posts.length}`);
  return { posts, source: "Product Hunt RSS" };
}

// ── Indie Hackers ─────────────────────────────────────────────────────────────
async function scrapeIndieHackers() {
  const xml = await fetchText(SOURCES.indieHackersRss);
  const posts = parseRss(xml, "indiehackers")
    .filter((p) => containsAny(`${p.title} ${p.description}`, IH_VALIDATION_HINTS))
    .map((p) => {
      const text = `${p.title} ${p.description}`;
      return {
        ...p,
        hasMRR: /\$[\d,.]+\s*(mrr|\/mo|per month|monthly)/i.test(text),
        hasUsers: /[\d,.]+\s*(users|customers|subscribers)/i.test(text),
        mrrHint: extractMrrHint(text),
      };
    })
    .slice(0, 20);
  console.log(`[Scraper] Indie Hackers: ${posts.length}`);
  return { posts, source: "Indie Hackers RSS" };
}

function extractMrrHint(text) {
  const m = text.match(/\$[\d,.]+\s*(?:mrr|\/mo|per month|monthly)/i);
  return m ? m[0] : null;
}

// ── DEV.to ────────────────────────────────────────────────────────────────────
async function scrapeDevTo() {
  const articles = await fetchJSON(SOURCES.devTo);
  const posts = (Array.isArray(articles) ? articles : [])
    .filter((a) => containsAny(`${a.title} ${a.description || ""}`, STARTUP_KEYWORDS))
    .map((a) => ({
      title: a.title,
      description: a.description || "",
      url: a.url || `https://dev.to${a.path}`,
      score: a.positive_reactions_count || 0,
      comments: a.comments_count || 0,
      tags: (a.tag_list || []).slice(0, 4),
      source: "devto",
    }))
    .slice(0, 20);
  console.log(`[Scraper] DEV.to: ${posts.length}`);
  return { posts, source: "DEV.to" };
}

// ── BetaList ──────────────────────────────────────────────────────────────────
async function scrapeBetaList() {
  const xml = await fetchText(SOURCES.betaListRss);
  const posts = parseRss(xml, "betalist")
    .slice(0, 20);
  console.log(`[Scraper] BetaList: ${posts.length}`);
  return { posts, source: "BetaList" };
}

// ── Lobsters ──────────────────────────────────────────────────────────────────
async function scrapeLobsters() {
  try {
    const data = await fetchJSON(SOURCES.lobsters);
    const posts = (data?.hottest || data?.newest || [])
      .filter((p) => containsAny(`${p.title} ${(p.tags || []).join(" ")}`, STARTUP_KEYWORDS))
      .map((p) => ({
        title: p.title,
        description: (p.description_plain || "").slice(0, 300),
        url: p.url || `https://lobste.rs${p.short_id_url}`,
        score: p.score || 0,
        comments: p.comment_count || 0,
        tags: (p.tags || []).slice(0, 4),
        source: "lobsters",
      }))
      .slice(0, 15);
    console.log(`[Scraper] Lobsters: ${posts.length}`);
    return { posts, source: "Lobsters" };
  } catch (err) {
    console.warn("[Scraper] Lobsters failed:", err.message);
    return { posts: [], source: "Lobsters" };
  }
}

// ── AppSumo ───────────────────────────────────────────────────────────────────
async function scrapeAppSumo() {
  try {
    const xml = await fetchText(SOURCES.appSumoRss);
    const posts = parseRss(xml, "appsumo").slice(0, 15);
    console.log(`[Scraper] AppSumo: ${posts.length}`);
    return { posts, source: "AppSumo" };
  } catch (err) {
    console.warn("[Scraper] AppSumo failed:", err.message);
    return { posts: [], source: "AppSumo" };
  }
}

// ── StarterStory ──────────────────────────────────────────────────────────────
async function scrapeStarterStory() {
  try {
    const xml = await fetchText(SOURCES.starterStoryRss);
    const posts = parseRss(xml, "starterstory")
      .filter((p) => containsAny(`${p.title} ${p.description}`, STARTUP_KEYWORDS) || containsAny(`${p.title} ${p.description}`, IH_VALIDATION_HINTS))
      .slice(0, 15);
    console.log(`[Scraper] StarterStory: ${posts.length}`);
    return { posts, source: "StarterStory" };
  } catch (err) {
    console.warn("[Scraper] StarterStory failed:", err.message);
    return { posts: [], source: "StarterStory" };
  }
}

// ── Custom User-Added Sources ─────────────────────────────────────────────────
export async function scrapeCustomSource(src) {
  const { url, type = "rss", label = url } = src;
  try {
    if (type === "json") {
      const data = await fetchJSON(url);
      // Try common shapes: array, {items}, {posts}, {articles}, {data}
      const arr = Array.isArray(data) ? data
        : data?.items || data?.posts || data?.articles || data?.data || [];
      const posts = arr.slice(0, 20).map((item) => ({
        title: item.title || item.name || item.headline || "",
        description: (item.description || item.summary || item.body || "").slice(0, 300),
        url: item.url || item.link || item.href || "",
        score: item.score || item.points || item.votes || 0,
        source: `custom-${label}`,
      })).filter((p) => p.title);
      return { posts, source: label };
    } else {
      // RSS/Atom
      const xml = await fetchText(url);
      const posts = parseRss(xml, `custom-${label}`, url).slice(0, 20);
      return { posts, source: label };
    }
  } catch (err) {
    console.warn(`[Scraper] Custom source ${url} failed:`, err.message);
    return { posts: [], source: label, error: err.message };
  }
}

// ── GitHub Trending ───────────────────────────────────────────────────────────
async function scrapeGithubTrending() {
  try {
    const repos = await scrapeGithubTrendingHtml();
    if (repos.length > 0) {
      console.log(`[Scraper] GitHub Trending HTML: ${repos.length}`);
      return { repos, source: "GitHub Trending" };
    }
  } catch (err) {
    console.warn("[Scraper] GitHub HTML failed:", err.message);
  }
  for (const apiUrl of SOURCES.githubTrendingApis) {
    try {
      const data = await fetchJSON(apiUrl);
      if (Array.isArray(data) && data.length > 0) {
        const repos = data
          .filter((r) => containsAny(`${r.repositoryName || r.name || ""} ${r.description || ""}`, STARTUP_KEYWORDS))
          .map((r) => ({
            title: r.repositoryName || r.name,
            description: r.description || "",
            url: r.url || `https://github.com/${r.username || r.author}/${r.repositoryName || r.name}`,
            stars: r.totalStars || r.stars || 0,
            starsAdded: r.starsAdded || r.currentPeriodStars || 0,
            language: r.language || "Unknown",
            source: "github-trending-api",
          }))
          .slice(0, 20);
        return { repos, source: "GitHub Trending" };
      }
    } catch (_) { /* try next */ }
  }
  return { repos: [], source: "GitHub Trending" };
}

async function scrapeGithubTrendingHtml() {
  const pages = await Promise.allSettled([
    fetchText(SOURCES.githubTrendingHtml),
    fetchText(SOURCES.githubTrendingHtmlPy),
  ]);
  const repos = [];
  for (const page of pages) {
    if (page.status !== "fulfilled") continue;
    const $ = loadHtml(page.value);
    $("article.Box-row").each((_, el) => {
      const href = $(el).find("h2 a").attr("href")?.replace(/^\//, "") || "";
      const [, repoName] = href.split("/");
      if (!repoName) return;
      repos.push({
        title: repoName,
        description: cleanEntities($(el).find("p").first().text()),
        url: `https://github.com/${href}`,
        stars: parseNumber($(el).find("a[href$='/stargazers']").first().text()),
        starsAdded: parseNumber($(el).find(".float-sm-right").text()),
        language: cleanEntities($(el).find("[itemprop='programmingLanguage']").text()) || "Unknown",
        source: "github-trending-html",
      });
    });
  }
  return dedupeByTitle(repos)
    .filter((r) => containsAny(`${r.title} ${r.description}`, STARTUP_KEYWORDS))
    .slice(0, 20);
}

// ── Google Trends ─────────────────────────────────────────────────────────────
async function scrapeGoogleTrends() {
  const xml = await fetchText(SOURCES.trendsRss);
  const trends = parseRss(xml, "google-trends-rss")
    .filter((t) => containsAny(`${t.title} ${t.description}`, TREND_HINTS))
    .slice(0, 20);
  console.log(`[Scraper] Google Trends: ${trends.length}`);
  return { trends, source: "Google Trends RSS" };
}

// ── Y Combinator ──────────────────────────────────────────────────────────────
async function scrapeYCombinator() {
  try {
    const html = await fetchText(SOURCES.ycCompanies);
    const $ = loadHtml(html);
    const companies = [];
    const nextDataRaw = $("script#__NEXT_DATA__").html();
    if (nextDataRaw) {
      const nextData = JSON.parse(nextDataRaw);
      const hits = nextData?.props?.pageProps?.companies
        || nextData?.props?.pageProps?.initialData?.hits || [];
      for (const c of hits.slice(0, 30)) {
        companies.push({
          title: c.name || "",
          description: c.one_liner || c.description || "",
          url: c.website || `https://www.ycombinator.com/companies/${c.slug || ""}`,
          batch: c.batch || "W25",
          tags: c.tags || [],
          source: "yc-companies",
        });
      }
    }
    if (companies.length === 0) {
      $("a[href*='/companies/']").each((_, el) => {
        const name = cleanEntities($(el).find("h3, .company-name, [class*='name']").first().text());
        const desc = cleanEntities($(el).find("p, .tagline").first().text());
        if (name?.length > 1) companies.push({ title: name, description: desc, source: "yc-html" });
      });
    }
    const filtered = dedupeByTitle(companies).filter((c) => c.title?.length > 1).slice(0, 25);
    console.log(`[Scraper] YC: ${filtered.length}`);
    return { companies: filtered, source: "Y Combinator W25" };
  } catch (err) {
    console.warn("[Scraper] YC failed:", err.message);
    return { companies: [], source: "Y Combinator W25", error: err.message };
  }
}

// ── Format for LLM ────────────────────────────────────────────────────────────
export function formatScrapedDataForLLM(scraped) {
  const lines = ["=== REAL-TIME MARKET INTELLIGENCE ===", `Scraped: ${scraped.scrapedAt}`, ""];

  const add = (header, items, fmt) => {
    if (!items?.length) return;
    lines.push(header);
    items.forEach((i) => lines.push(fmt(i)));
    lines.push("");
  };

  // MASSIVE TOKEN REDUCTION: Only show the top 3-4 golden posts per platform. 
  // This reduces LLM context size by ~80%, eliminating quota burn!

  add("[HN SHOW — validated launches]",
    scraped.hackerNews?.posts?.slice(0, 4),
    (p) => `• [${p.score}pts] ${p.title}`);

  add("[HN ASK — developer pain points]",
    scraped.hackerNewsAsk?.posts?.slice(0, 4),
    (p) => `• [${p.score}pts] ${p.title}`);

  add("[REDDIT — pain points & discussions]",
    scraped.reddit?.posts?.slice(0, 5),
    (p) => `• ${p.subreddit ? `[${p.subreddit}]` : ""} ${p.title}${p.score > 0 ? ` [${p.score}↑]` : ""}`);

  add("[PRODUCT HUNT — recent launches]",
    scraped.productHunt?.posts?.slice(0, 3),
    (p) => `• ${p.title}${p.upvotes ? ` [${p.upvotes}↑]` : ""}${p.tagline ? ` — ${p.tagline.slice(0, 50)}` : ""}`);

  add("[INDIE HACKERS — MRR milestones]",
    scraped.indieHackers?.posts?.slice(0, 3),
    (p) => `• ${p.title}${p.mrrHint ? ` [${p.mrrHint}]` : ""}`);

  add("[DEV.TO — developer articles]",
    scraped.devTo?.posts?.slice(0, 3),
    (p) => `• [${p.score}❤] ${p.title}`);

  add("[BETALIST — new startup launches]",
    scraped.betaList?.posts?.slice(0, 3),
    (p) => `• ${p.title}`);

  add("[APPSUMO — B2B SaaS deals people pay for]",
    scraped.appSumo?.posts?.slice(0, 2),
    (p) => `• ${p.title}`);

  add("[STARTER STORY — real bootstrapped revenue numbers]",
    scraped.starterStory?.posts?.slice(0, 3),
    (p) => `• ${p.title}`);

  add("[GITHUB TRENDING — hot dev tools]",
    scraped.githubTrending?.repos?.slice(0, 3),
    (r) => `• ${r.title} [${r.language}, +${r.starsAdded}★/wk]`);

  add("[YC W25 — funded = validated market]",
    scraped.ycombinator?.companies?.slice(0, 3),
    (c) => `• ${c.title}`);

  // Custom sources
  for (const custom of scraped.custom || []) {
    add(`[CUSTOM: ${custom.sourceLabel || custom.source}]`,
      custom.posts?.slice(0, 3),
      (p) => `• ${p.title}`);
  }

  lines.push("=== END MARKET DATA ===");
  return lines.join("\n");
}

// ── RSS Parser ────────────────────────────────────────────────────────────────
function parseRss(xml, source, feedUrl = "") {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const chunk = match[1];
    const title       = extractXmlTag(chunk, "title");
    const link        = extractXmlTag(chunk, "link") || extractXmlTag(chunk, "guid");
    const description = extractXmlTag(chunk, "description");
    const pubDate     = extractXmlTag(chunk, "pubDate");
    if (title) {
      items.push({
        title:       cleanEntities(title),
        description: description ? cleanEntities(description).slice(0, 300) : "",
        tagline:     description ? cleanEntities(description).slice(0, 300) : "",
        url:         link || "",
        pubDate:     pubDate || "",
        feedUrl,
        source,
      });
    }
  }
  return items.slice(0, 25);
}

function extractXmlTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, "i");
  const m  = xml.match(re);
  return m ? m[1].trim() : "";
}

function cleanEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function containsAny(text, keywords) {
  const lower = String(text || "").toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function parseUpvotes(text) {
  const m = String(text || "").match(/(\d[\d,]*)\s+upvotes?/i);
  return m ? parseInt(m[1].replaceAll(",", ""), 10) : 0;
}

function parseNumber(text) {
  const m = String(text || "").replace(/,/g, "").match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

function dedupeByTitle(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = (item.title || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 50);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseTopicNamesFromLdJson(rawJson) {
  const names = [];
  try { collectNames(JSON.parse(rawJson), names); } catch (_) {}
  return names.filter(Boolean);
}

function collectNames(node, out) {
  if (!node) return;
  if (Array.isArray(node)) { for (const item of node) collectNames(item, out); return; }
  if (typeof node === "object") {
    if (typeof node.name === "string") out.push(cleanEntities(node.name));
    for (const value of Object.values(node)) collectNames(value, out);
  }
}

// ── HTTP Helpers ──────────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": randomUA(),
        "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(options.headers || {}),
      },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function fetchJSON(url, options = {}) {
  const res = await fetchWithTimeout(url, { ...options, headers: { Accept: "application/json", ...(options.headers || {}) } });
  return res.json();
}

async function fetchText(url, options = {}) {
  const res = await fetchWithTimeout(url, options);
  return res.text();
}
