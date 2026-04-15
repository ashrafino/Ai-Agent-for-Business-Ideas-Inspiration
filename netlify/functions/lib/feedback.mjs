// Feature: scraping-optimization — Feedback Signal Persistence and Weight Updates
import { getDb } from "./db.mjs";
import { getProfile, saveProfile, getDefaultWeights } from "./user-profile.mjs";
import { invalidateUserCache } from "./relevance.mjs";

const SIGNAL_TYPES = ["thumbs_up", "thumbs_down", "save", "skip"];
const WEIGHT_CAP = 3.0;
const WEIGHT_FLOOR = 0.1;
const WEIGHT_DELTA = 0.1;

/**
 * Inserts a feedback signal into the `feedback_signals` collection.
 * Throws on DB error — signals must not be silently discarded.
 *
 * @param {{ userId: string, itemId: string, itemSource: string, itemDomains: string[], signalType: string, timestamp?: string }} signal
 * @returns {Promise<void>}
 */
export async function recordFeedback(signal) {
  const { userId, itemId, itemSource, itemDomains, signalType } = signal;

  if (!userId || !itemId || !itemSource || !Array.isArray(itemDomains) || !signalType) {
    throw new Error("[feedback] recordFeedback: missing required fields");
  }
  if (!SIGNAL_TYPES.includes(signalType)) {
    throw new Error(`[feedback] recordFeedback: unknown signalType '${signalType}'`);
  }

  const db = await getDb();
  await db.collection("feedback_signals").insertOne({
    userId,
    itemId,
    itemSource,
    itemDomains,
    signalType,
    timestamp: signal.timestamp ?? new Date().toISOString(),
  });
}

/**
 * Applies a feedback signal's weight delta to the user's preference profile,
 * then invalidates the user's relevance cache.
 *
 * Weight rules:
 *   thumbs_up / save  → +0.1, capped at 3.0
 *   thumbs_down       → -0.1, floored at 0.1
 *   skip              → no-op
 *
 * @param {string} userId
 * @param {{ signalType: string, itemDomains: string[] }} signal
 * @returns {Promise<void>}
 */
export async function applyFeedbackToProfile(userId, signal) {
  const { signalType, itemDomains } = signal;

  if (signalType === "skip") return;

  const existing = await getProfile(userId);
  const weights = existing?.preferenceWeights ?? getDefaultWeights();

  const delta =
    signalType === "thumbs_up" || signalType === "save"
      ? WEIGHT_DELTA
      : signalType === "thumbs_down"
      ? -WEIGHT_DELTA
      : 0;

  if (delta === 0) return;

  const updatedWeights = { ...weights };
  for (const domain of itemDomains) {
    if (domain in updatedWeights) {
      const raw = (updatedWeights[domain] ?? 1.0) + delta;
      updatedWeights[domain] = Math.min(WEIGHT_CAP, Math.max(WEIGHT_FLOOR, raw));
    }
  }

  const updatedProfile = {
    ...(existing ?? {}),
    preferenceWeights: updatedWeights,
  };

  await saveProfile(userId, updatedProfile);
  await invalidateUserCache(userId);
}
