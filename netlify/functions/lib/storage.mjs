// ============================================
// VentureLens — MongoDB Atlas Storage
// ============================================
import { MongoClient } from "mongodb";

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME   = "venturelens";
const COL_NAME  = "sessions";

// ── Connection singleton (reused across warm lambda invocations) ─────────────
let _client = null;

async function getClient() {
  if (!MONGO_URI) throw new Error("MONGODB_URI environment variable is not set.");

  // Reconnect if the client was closed or never connected
  if (_client) {
    try {
      // Ping to verify the connection is still alive
      await _client.db("admin").command({ ping: 1 });
      return _client;
    } catch {
      console.warn("[Storage] Stale connection detected — reconnecting...");
      _client = null;
    }
  }

  _client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS:         8000,
    socketTimeoutMS:          30000,
    maxPoolSize:              5,
    retryWrites:              true,
  });
  await _client.connect();
  console.log("[Storage] MongoDB Atlas connected.");
  return _client;
}

async function getCol() {
  const client = await getClient();
  const db  = client.db(DB_NAME);

  // Ensure the collection + indexes exist (idempotent)
  const col = db.collection(COL_NAME);
  await col.createIndex({ _id: 1 }, { unique: true }).catch(() => {});
  return col;
}

// ── Default empty database structure ─────────────────────────────────────────
const DEFAULT_DB = {
  latest:     null,
  history:    [],
  bestOfDay:  null,
  todayIdeas: [],
  todayDate:  null,
  hallOfFame: [],
  lastSaved:  null,
};

// ── Read the full DB document ─────────────────────────────────────────────────
export async function readDB() {
  const col = await getCol();           // throws if DB is unreachable
  const doc = await col.findOne({ _id: "main" });
  if (!doc) return { db: { ...DEFAULT_DB } };
  const { _id, ...rest } = doc;
  return { db: { ...DEFAULT_DB, ...rest } };
}

// ── Write the full DB document ────────────────────────────────────────────────
export async function writeDB(db) {
  const col = await getCol();
  const { _id, ...fields } = db;
  await col.updateOne(
    { _id: "main" },
    { $set: { ...fields, lastSaved: new Date().toISOString() } },
    { upsert: true }
  );
}

// ── Raw Data Lake: Dump Scraper output to MongoDB ─────────────────────────────
export async function saveScrapeToDB(scrapedData) {
  try {
    const client = await getClient();
    const col = client.db(DB_NAME).collection("raw_scrapes");
    await col.insertOne({
      scrapedAt: new Date().toISOString(),
      data: scrapedData,
    });
    console.log("[Storage] Raw scrape cleanly persisted to MongoDB data lake.");
  } catch (err) {
    console.error("[Storage] Failed saving raw scrape to MongoDB:", err.message);
  }
}


// ── High-level helpers ────────────────────────────────────────────────────────

/** Read a single top-level key from the DB */
export async function get(key) {
  const { db } = await readDB();
  return db[key] ?? null;
}

/**
 * Read the DB, apply a mutation function, then write back.
 * Propagates errors — callers should handle them.
 */
export async function update(mutateFn) {
  const { db } = await readDB();
  const updatedDb = await mutateFn(db);
  await writeDB(updatedDb);
  return updatedDb;
}

/** Test that read and write both work */
export async function healthCheck() {
  const result = {
    canRead:      false,
    canWrite:     false,
    hasData:      false,
    historyCount: 0,
    hofCount:     0,
    latestIdeas:  0,
    storage:      "mongodb-atlas",
    error:        null,
  };
  try {
    const { db } = await readDB();
    result.canRead      = true;
    result.hasData      = !!(db.latest || db.history?.length > 0);
    result.historyCount = db.history?.length   || 0;
    result.hofCount     = db.hallOfFame?.length || 0;
    result.latestIdeas  = db.latest?.ideas?.length || 0;

    await writeDB({ ...db, healthCheckAt: new Date().toISOString() });
    result.canWrite = true;
  } catch (err) {
    result.error = err.message;
    console.error("[Storage] healthCheck error:", err.message);
  }
  return result;
}
