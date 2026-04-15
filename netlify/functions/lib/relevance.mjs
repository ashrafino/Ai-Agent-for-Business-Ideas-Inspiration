// Per-User Relevance Scoring Engine + User Cache management
import { INTEREST_DOMAINS, DOMAIN_KEYWORDS } from "./constants.mjs";
import { getDb } from "./db.mjs";

const USER_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const USER_CACHE_MAX_ITEMS = 50;
const NO_MATCH_MULTIPLIER = 0.3;

/**
 * Determines which Interest_Domains an item matches.
 * Checks title + description + tags against DOMAIN_KEYWORDS (case-insensitive).
 * @param {object} item
 * @returns {string[]} matched domain names
 */
function getMatchedDomains(item) {
  const text = [
    item.title ?? "",
    item.description ?? "",
    ...(Array.isArray(item.tags) ? item.tags : []),
  ]
    .join(" ")
    .toLowerCase();

  return INTEREST_DOMAINS.filter((domain) => {
    const keywords = DOMAIN_KEYWORDS[domain] ?? [];
    return keywords.some((kw) => text.includes(kw.toLowerCase()));
  });
}

/**
 * Computes a per-user relevance score for a single item.
 * score = qualityScore * sum(matchedDomainWeights)
 * When no domains match: score = qualityScore * 0.3
 *
 * @param {object} item  - must have `_qualityScore` (0–100)
 * @param {object} userProfile - must have `preferenceWeights` Record<domain, number>
 * @returns {number}
 */
export function computeRelevanceScore(item, userProfile) {
  const qualityScore = item._qualityScore ?? 0;
  const weights = userProfile?.preferenceWeights ?? {};
  const matchedDomains = getMatchedDomains(item);

  if (matchedDomains.length === 0) {
    return qualityScore * NO_MATCH_MULTIPLIER;
  }

  const weightSum = matchedDomains.reduce(
    (sum, domain) => sum + (weights[domain] ?? 1.0),
    0
  );

  return qualityScore * weightSum;
}

/**
 * Ranks items for a user by relevance score (descending).
 * Attaches `relevanceScore` and `matchedDomains` to each item.
 * Designed to process 500 items in < 500 ms (pure in-process, no I/O).
 *
 * @param {object[]} items
 * @param {object} userProfile
 * @returns {object[]} sorted descending by relevanceScore
 */
export function rankItemsForUser(items, userProfile) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const scored = items.map((item) => {
    const matchedDomains = getMatchedDomains(item);
    const relevanceScore = computeRelevanceScore(item, userProfile);
    return { ...item, relevanceScore, matchedDomains };
  });

  return scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

/**
 * Reads the user's cached ranked items from MongoDB.
 * Returns null on: cache miss, stale flag, or globalVersion mismatch.
 * On DB failure: returns null (fail open).
 *
 * @param {string} userId
 * @param {string} globalVersion - ISO timestamp of the Global_Cache scrapedAt
 * @returns {Promise<object[]|null>}
 */
export async function getUserCache(userId, globalVersion) {
  try {
    const db = await getDb();
    const doc = await db.collection("user_cache").findOne({ _id: userId });

    if (!doc) return null;
    if (doc.isStale) return null;
    if (doc.globalCacheVersion !== globalVersion) return null;

    return doc.rankedItems ?? null;
  } catch (err) {
    console.warn("[relevance] getUserCache DB failure, treating as miss:", err.message);
    return null;
  }
}

/**
 * Writes the top-50 relevance-ranked items to the user's cache.
 * Sets expiresAt to 6 h from now (TTL index) and isStale: false.
 * On DB failure: logs warning and returns (fail open).
 *
 * @param {string} userId
 * @param {string} globalVersion - ISO timestamp of the Global_Cache scrapedAt
 * @param {object[]} items - already ranked; will be sliced to top 50
 * @returns {Promise<void>}
 */
export async function setUserCache(userId, globalVersion, items) {
  try {
    const db = await getDb();
    const now = new Date();
    const rankedItems = items.slice(0, USER_CACHE_MAX_ITEMS);

    await db.collection("user_cache").updateOne(
      { _id: userId },
      {
        $set: {
          _id: userId,
          globalCacheVersion: globalVersion,
          rankedItems,
          computedAt: now.toISOString(),
          isStale: false,
          expiresAt: new Date(now.getTime() + USER_CACHE_TTL_MS),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    console.warn("[relevance] setUserCache DB failure:", err.message);
  }
}

/**
 * Marks the user's cache as stale so the next request triggers re-scoring.
 * On DB failure: logs warning and returns (fail open).
 *
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function invalidateUserCache(userId) {
  try {
    const db = await getDb();
    await db
      .collection("user_cache")
      .updateOne({ _id: userId }, { $set: { isStale: true } });
  } catch (err) {
    console.warn("[relevance] invalidateUserCache DB failure:", err.message);
  }
}
