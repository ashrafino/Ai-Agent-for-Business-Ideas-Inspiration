// LLM Formatter — builds personalized context strings for Groq
import { INTEREST_DOMAINS, DOMAIN_KEYWORDS } from "./constants.mjs";
export { formatScrapedDataForLLM as formatFallback } from "./scraper.mjs";

const MAX_ITEMS = 60;
const MIN_SCORE = 40;
const DESC_MAX = 120;

/**
 * Determines the first matching Interest_Domain for an item.
 * Checks title + description + tags (lowercased) against DOMAIN_KEYWORDS.
 * @param {object} item
 * @returns {string|null} domain name or null
 */
function getFirstMatchedDomain(item) {
  const text = [
    item.title ?? "",
    item.description ?? "",
    ...(Array.isArray(item.tags) ? item.tags : []),
  ]
    .join(" ")
    .toLowerCase();

  for (const domain of INTEREST_DOMAINS) {
    const keywords = DOMAIN_KEYWORDS[domain] ?? [];
    if (keywords.some((kw) => text.includes(kw.toLowerCase()))) {
      return domain;
    }
  }
  return null;
}

/**
 * Returns priority tier label based on relevanceScore.
 * @param {number} score
 * @returns {"GOLD"|"HIGH"|"MEDIUM"}
 */
function getTier(score) {
  if (score >= 80) return "GOLD";
  if (score >= 60) return "HIGH";
  return "MEDIUM";
}

/**
 * Truncates a string to maxLen chars, appending "…" if truncated.
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (!str) return "";
  return str.length <= maxLen ? str : str.slice(0, maxLen - 1) + "…";
}

/**
 * Formats ranked items into a personalized context string for the LLM.
 *
 * - Filters to items with relevanceScore > 40, capped at 60 total
 * - Groups by first matched Interest_Domain; unmatched items go in "Other"
 * - Prepends a "User Focus" section listing top-3 domains by weight (when profile exists)
 * - Truncates descriptions to 120 chars
 * - Includes relevanceScore and priority tier (GOLD/HIGH/MEDIUM) per item
 *
 * @param {object[]} rankedItems - items with relevanceScore attached
 * @param {object|null} userProfile - User_Profile with preferenceWeights
 * @returns {string}
 */
export function formatForUser(rankedItems, userProfile) {
  if (!Array.isArray(rankedItems) || rankedItems.length === 0) {
    return "=== NO RELEVANT ITEMS FOUND ===";
  }

  // Filter and cap
  const filtered = rankedItems
    .filter((item) => (item.relevanceScore ?? 0) > MIN_SCORE)
    .slice(0, MAX_ITEMS);

  if (filtered.length === 0) {
    return "=== NO RELEVANT ITEMS FOUND ===";
  }

  const lines = [];

  // User Focus section
  if (userProfile?.preferenceWeights) {
    const weights = userProfile.preferenceWeights;
    const top3 = Object.entries(weights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([domain]) => domain);

    if (top3.length > 0) {
      lines.push("=== USER FOCUS ===");
      top3.forEach((domain, i) => lines.push(`${i + 1}. ${domain}`));
      lines.push("");
    }
  }

  lines.push("=== PERSONALIZED MARKET INTELLIGENCE ===");
  lines.push("");

  // Group items by domain
  const groups = new Map(); // domain -> items[]
  for (const item of filtered) {
    const domain = getFirstMatchedDomain(item) ?? "Other";
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(item);
  }

  // Emit domain groups in INTEREST_DOMAINS order, then "Other"
  const orderedDomains = [...INTEREST_DOMAINS, "Other"].filter((d) =>
    groups.has(d)
  );

  for (const domain of orderedDomains) {
    const items = groups.get(domain);
    lines.push(`--- ${domain} ---`);
    for (const item of items) {
      const score = Math.round(item.relevanceScore ?? 0);
      const tier = getTier(score);
      const title = item.title ?? "(untitled)";
      const desc = truncate(item.description, DESC_MAX);
      lines.push(`[${tier}] (score: ${score}) ${title}`);
      if (desc) lines.push(`  ${desc}`);
      if (item.url) lines.push(`  ${item.url}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
