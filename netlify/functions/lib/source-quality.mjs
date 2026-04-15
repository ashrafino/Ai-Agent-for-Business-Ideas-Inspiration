// Feature: scraping-optimization — Source Quality Tracking
import { getDb } from "./db.mjs";

const COLLECTION = "source_quality";
const LOW_SCORE_THRESHOLD = 20;
const LOW_SCORE_WARN_SESSIONS = 3;
const LOW_SUCCESS_RATE_THRESHOLD = 0.5;

/**
 * Upserts a Source_Quality_Record for the given source.
 *
 * On success (metrics.success === true):
 *   - Updates all fields, resets lastError to null
 *   - Increments consecutiveLowScoreSessions when averageQualityScore < 20, else resets to 0
 *   - Logs a console warning when consecutiveLowScoreSessions reaches 3+
 *
 * On failure (metrics.success === false):
 *   - Increments errorCount
 *   - Sets lastError to metrics.errorMessage
 *
 * @param {string} sourceName
 * @param {{
 *   lastFetchAt: string,
 *   fetchDurationMs: number,
 *   itemCount: number,
 *   averageQualityScore: number,
 *   successRate: number,
 *   success: boolean,
 *   errorMessage?: string,
 * }} metrics
 * @returns {Promise<void>}
 */
export async function upsertSourceQuality(sourceName, metrics) {
  const db = await getDb();
  const col = db.collection(COLLECTION);

  if (!metrics.success) {
    await col.updateOne(
      { _id: sourceName },
      {
        $inc: { errorCount: 1 },
        $set: { lastError: metrics.errorMessage ?? "Unknown error" },
        $setOnInsert: {
          lastFetchAt: metrics.lastFetchAt ?? new Date().toISOString(),
          fetchDurationMs: metrics.fetchDurationMs ?? 0,
          itemCount: metrics.itemCount ?? 0,
          averageQualityScore: metrics.averageQualityScore ?? 0,
          successRate: metrics.successRate ?? 0,
          consecutiveLowScoreSessions: 0,
        },
      },
      { upsert: true }
    );
    return;
  }

  // Fetch current record to determine consecutiveLowScoreSessions
  const existing = await col.findOne({ _id: sourceName });
  const prevConsecutive = existing?.consecutiveLowScoreSessions ?? 0;

  const isLowScore = metrics.averageQualityScore < LOW_SCORE_THRESHOLD;
  const newConsecutive = isLowScore ? prevConsecutive + 1 : 0;

  await col.updateOne(
    { _id: sourceName },
    {
      $set: {
        lastFetchAt: metrics.lastFetchAt,
        fetchDurationMs: metrics.fetchDurationMs,
        itemCount: metrics.itemCount,
        averageQualityScore: metrics.averageQualityScore,
        successRate: metrics.successRate,
        lastError: null,
        consecutiveLowScoreSessions: newConsecutive,
      },
      $setOnInsert: {
        errorCount: 0,
      },
    },
    { upsert: true }
  );

  if (newConsecutive >= LOW_SCORE_WARN_SESSIONS) {
    console.warn(
      `[source-quality] WARNING: source "${sourceName}" has had averageQualityScore < ${LOW_SCORE_THRESHOLD} for ${newConsecutive} consecutive sessions (current score: ${metrics.averageQualityScore})`
    );
  }
}

/**
 * Returns the Source_Quality_Record for the given source, or null if not found.
 *
 * @param {string} sourceName
 * @returns {Promise<object|null>}
 */
export async function getSourceQuality(sourceName) {
  const db = await getDb();
  const record = await db.collection(COLLECTION).findOne({ _id: sourceName });
  return record ?? null;
}

/**
 * Returns all Source_Quality_Records.
 *
 * @returns {Promise<object[]>}
 */
export async function getAllSourceQuality() {
  const db = await getDb();
  return db.collection(COLLECTION).find({}).toArray();
}

/**
 * Returns the credibility multiplier for a source based on its success rate.
 * - 0.5 when successRate < 0.5
 * - 1.0 otherwise
 *
 * @param {{ successRate: number }} record
 * @returns {number}
 */
export function getCredibilityMultiplier(record) {
  return record.successRate < LOW_SUCCESS_RATE_THRESHOLD ? 0.5 : 1.0;
}
