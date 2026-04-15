// ============================================
// VentureLens — MongoDB Atlas Storage
// ============================================
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const MONGO_URI    = process.env.MONGODB_URI;
const JWT_SECRET   = process.env.JWT_SECRET || "venture-lens-super-secret-default";
const DB_NAME      = "venturelens";
const COL_NAME     = "sessions";

// ── Singleton MongoDB Client ──────────────────────────────────────────────────
let _client = null;

async function getClient() {
  if (!MONGO_URI) throw new Error("MONGODB_URI not set");
  if (_client) {
    try { await _client.db("admin").command({ ping: 1 }); return _client; }
    catch { _client = null; }
  }
  _client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
  });
  await _client.connect();
  return _client;
}

async function getCol() {
  const client = await getClient();
  return client.db(DB_NAME).collection(COL_NAME);
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

// ── Read the DB document(s) ───────────────────────────────────────────────────
export async function readDB(userId = "global") {
  const col = await getCol();

  const userDoc = await col.findOne({ _id: userId === "global" ? "main" : userId });

  let globalDoc = null;
  if (userId !== "global") {
    globalDoc = await col.findOne({ _id: "main" });
  }

  const db = { ...DEFAULT_DB };

  if (userDoc) {
    USER_KEYS.forEach((k) => { if (userDoc[k] !== undefined) db[k] = userDoc[k]; });
    if (userId === "global") {
      GLOBAL_KEYS.forEach((k) => { if (userDoc[k] !== undefined) db[k] = userDoc[k]; });
    }
  }

  if (globalDoc) {
    GLOBAL_KEYS.forEach((k) => { if (globalDoc[k] !== undefined) db[k] = globalDoc[k]; });
  }

  return { db };
}

// ── Write the DB document(s) ──────────────────────────────────────────────────
export async function writeDB(db, userId = "global") {
  const col       = await getCol();
  const timestamp = new Date().toISOString();

  const userFields = { lastSaved: timestamp };
  USER_KEYS.forEach((k) => { if (db[k] !== undefined) userFields[k] = db[k]; });

  if (userId === "global") {
    GLOBAL_KEYS.forEach((k) => { if (db[k] !== undefined) userFields[k] = db[k]; });
  }

  await col.updateOne(
    { _id: userId === "global" ? "main" : userId },
    { $set: userFields },
    { upsert: true }
  );

  if (userId !== "global") {
    const globalFields = { lastSaved: timestamp };
    GLOBAL_KEYS.forEach((k) => { if (db[k] !== undefined) globalFields[k] = db[k]; });
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
    const col    = client.db(DB_NAME).collection("raw_scrapes");
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
  }
}

// ── Health Check ──────────────────────────────────────────────────────────────
export async function healthCheck() {
  try {
    const { db } = await readDB();
    const canRead = true;
    let   canWrite = false;
    try {
      await writeDB({ lastSaved: new Date().toISOString() });
      canWrite = true;
    } catch (e) {
      console.warn("[Health] Write test failed:", e.message);
    }
    return {
      canRead,
      canWrite,
      historyCount:  (db.history    || []).length,
      hofCount:      (db.hallOfFame || []).length,
      latestIdeas:   (db.latest?.ideas || []).length,
    };
  } catch (err) {
    return { canRead: false, canWrite: false, error: err.message };
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
  const { db }    = await readDB(userId);
  const updatedDb = await mutateFn(db);
  await writeDB(updatedDb, userId);
  return updatedDb;
}

// ── User Management ───────────────────────────────────────────────────────────

/** Create a new user with hashed password */
export async function createUser({ email, password, name }) {
  const client = await getClient();
  const col    = client.db(DB_NAME).collection("users");

  const existing = await col.findOne({ email: email.toLowerCase() });
  if (existing) throw new Error("User already exists with this email.");

  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    email:     email.toLowerCase(),
    password:  hashedPassword,
    name,
    createdAt: new Date().toISOString(),
  };

  const result = await col.insertOne(user);
  return { id: result.insertedId, email, name };
}

/** Verify credentials and return user (minus password) */
export async function authenticateUser(email, password) {
  const client = await getClient();
  const col    = client.db(DB_NAME).collection("users");

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
    { id: user._id?.toString() || user.id?.toString(), email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

/** Verify JWT from request header */
export function verifyAuth(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
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
