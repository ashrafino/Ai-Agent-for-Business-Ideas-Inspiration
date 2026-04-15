// Feature: scraping-optimization
// Sliding-window rate limiter using MongoDB `rate_limits` collection.
import { getDb } from "./db.mjs";

const WINDOW_MS = 60 * 60 * 1000; // 60 minutes
const LIMIT_AUTHENTICATED = 10;
const LIMIT_UNAUTHENTICATED = 3;

/**
 * Check and record a rate-limit request for the given user or IP.
 *
 * @param {string|null} userId  - Authenticated user ID, or null for unauthenticated
 * @param {string}      ip      - Client IP address (used when userId is falsy)
 * @returns {{ allowed: boolean, retryAfterSeconds?: number }}
 */
export async function checkRateLimit(userId, ip) {
  const key = userId ? userId : `ip:${ip}`;
  const limit = userId ? LIMIT_AUTHENTICATED : LIMIT_UNAUTHENTICATED;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    const db = await getDb();
    const col = db.collection("rate_limits");

    // Read existing record
    const record = await col.findOne({ _id: key });
    const rawTimestamps = record?.requestTimestamps ?? [];

    // Prune timestamps outside the sliding window
    const timestamps = rawTimestamps.filter((ts) => ts >= windowStart);

    if (timestamps.length >= limit) {
      // Find the oldest timestamp in the window to compute retry delay
      const oldest = Math.min(...timestamps);
      const retryAfterSeconds = Math.ceil((oldest + WINDOW_MS - now) / 1000);
      return { allowed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
    }

    // Append current request and persist
    timestamps.push(now);
    await col.updateOne(
      { _id: key },
      { $set: { requestTimestamps: timestamps, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );

    return { allowed: true };
  } catch (err) {
    console.warn("[rate-limit] DB error — failing open:", err.message);
    return { allowed: true };
  }
}
