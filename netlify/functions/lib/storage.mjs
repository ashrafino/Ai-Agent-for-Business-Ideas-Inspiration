// ============================================
// VentureLens — MongoDB Atlas Storage
// ============================================
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const MONGO_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "venture-lens-super-secret-default";
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
const USER_KEYS   = ["latest", "history", "todayIdeas", "todayDate"];
const GLOBAL_KEYS = ["bestOfDay", "hallOfFame"];

const DEFAULT_DB = {
  latest:     null,
  history:    [],
  bestOfDay:  null,
  todayIdeas: [],
  todayDate:  null,
  hallOfFame: [],
  lastSaved:  null,
};

// ── Read the DB document(s) ──────────────────────────────────────────────────
export async function readDB(userId = "global") {
  const col = await getCol();
  
  // 1. Fetch User Data
  const userDoc = await col.findOne({ _id: userId === "global" ? "main" : userId });
  
  // 2. Fetch Global Data (if not already global)
  let globalDoc = null;
  if (userId !== "global") {
    globalDoc = await col.findOne({ _id: "main" }); // "main" acts as the legacy/global bucket
  }

  const db = { ...DEFAULT_DB };
  
  // Fill from user doc
  if (userDoc) {
    USER_KEYS.forEach(k => { if (userDoc[k] !== undefined) db[k] = userDoc[k]; });
    if (userId === "global") {
       GLOBAL_KEYS.forEach(k => { if (userDoc[k] !== undefined) db[k] = userDoc[k]; });
    }
  }
  
  // Fill from global doc
  if (globalDoc) {
    GLOBAL_KEYS.forEach(k => { if (globalDoc[k] !== undefined) db[k] = globalDoc[k]; });
  }

  return { db };
}

// ── Write the DB document(s) ─────────────────────────────────────────────────
export async function writeDB(db, userId = "global") {
  const col = await getCol();
  const timestamp = new Date().toISOString();

  // 1. Prepare User Update
  const userFields = { lastSaved: timestamp };
  USER_KEYS.forEach(k => { if (db[k] !== undefined) userFields[k] = db[k]; });
  
  if (userId === "global") {
    GLOBAL_KEYS.forEach(k => { if (db[k] !== undefined) userFields[k] = db[k]; });
  }

  await col.updateOne(
    { _id: userId === "global" ? "main" : userId },
    { $set: userFields },
    { upsert: true }
  );

  // 2. Prepare Global Update (if user is present)
  if (userId !== "global") {
    const globalFields = { lastSaved: timestamp };
    GLOBAL_KEYS.forEach(k => { if (db[k] !== undefined) globalFields[k] = db[k]; });
    
    await col.updateOne(
      { _id: "main" },
      { $set: globalFields },
      { upsert: true }
    );
  }
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
    console.log("[Storage] Raw scrape persisted to MongoDB data lake");
  } catch (err) {
    console.error("[Storage] Failed to save raw scrape to MongoDB:", {
      error: err.message,
      timestamp: new Date().toISOString(),
    });
    // Re-throw to allow caller to handle
    throw err;
  }
}


// ── High-level helpers ────────────────────────────────────────────────────────

/** Read a single top-level key from the DB */
export async function get(key, userId = "global") {
  const { db } = await readDB(userId);
  return db[key] ?? null;
}

/**
 * Read the DB, apply a mutation function, then write back.
 */
export async function update(mutateFn, userId = "global") {
  const { db } = await readDB(userId);
  const updatedDb = await mutateFn(db);
  await writeDB(updatedDb, userId);
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

// ── User Management ──────────────────────────────────────────────────────────

/** Create a new user with hashed password */
export async function createUser({ email, password, name }) {
  const client = await getClient();
  const db = client.db(DB_NAME);
  const col = db.collection("users");

  // Check if user exists
  const existing = await col.findOne({ email: email.toLowerCase() });
  if (existing) throw new Error("User already exists with this email.");

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    email: email.toLowerCase(),
    password: hashedPassword,
    name,
    createdAt: new Date().toISOString(),
  };

  const result = await col.insertOne(user);
  return { id: result.insertedId, email, name };
}

/** Verify credentials and return user (minus password) */
export async function authenticateUser(email, password) {
  const client = await getClient();
  const db = client.db(DB_NAME);
  const col = db.collection("users");

  const user = await col.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error("Invalid email or password.");

  const isValid = await bcrypt.compare(password, user.password);
  if (!isValid) throw new Error("Invalid email or password.");

  const { password: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

/** Generate a JWT for a user */
export function generateToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/** Verify JWT from request header */
export function verifyAuth(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid authorization header.");
  }

  const token = authHeader.split(" ")[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    throw new Error("Invalid or expired session token.");
  }
}
