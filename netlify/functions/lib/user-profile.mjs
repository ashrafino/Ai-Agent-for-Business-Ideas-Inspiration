// User Interest Profile CRUD — user_profiles collection
import { MongoClient } from "mongodb";
import { INTEREST_DOMAINS } from "./constants.mjs";

const MONGO_URI = process.env.MONGODB_URI;
let _client = null;

async function getClient() {
  if (!MONGO_URI) throw new Error("MONGODB_URI not set");
  if (_client) {
    try { await _client.db("admin").command({ ping: 1 }); return _client; }
    catch { _client = null; }
  }
  _client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000 });
  await _client.connect();
  return _client;
}

async function getCol() {
  const client = await getClient();
  return client.db("venturelens").collection("user_profiles");
}

/**
 * Returns the User_Profile for the given userId, or null if not found.
 * On DB failure, logs a warning and returns default weights (fail open).
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
export async function getProfile(userId) {
  try {
    const col = await getCol();
    const doc = await col.findOne({ _id: userId });
    return doc ?? null;
  } catch (err) {
    console.warn("[user-profile] DB read failed, returning default weights:", err.message);
    return getDefaultWeights();
  }
}

/**
 * Upserts the User_Profile document for the given userId.
 * Sets updatedAt on every save; sets createdAt only on insert.
 * Must complete within 2 seconds.
 * @param {string} userId
 * @param {object} profile
 * @returns {Promise<void>}
 */
export async function saveProfile(userId, profile) {
  const col = await getCol();
  const now = new Date().toISOString();
  await col.updateOne(
    { _id: userId },
    {
      $set: { ...profile, _id: userId, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, maxTimeMS: 2000 }
  );
}

/**
 * Returns an object mapping every INTEREST_DOMAIN to exactly 1.0.
 * @returns {Record<string, number>}
 */
export function getDefaultWeights() {
  return Object.fromEntries(INTEREST_DOMAINS.map((d) => [d, 1.0]));
}
