// Thin MongoDB helper for scraper cache — avoids circular import with storage.mjs
import { MongoClient } from "mongodb";

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

export async function getCol() {
  const client = await getClient();
  return client.db("venturelens").collection("scraper_cache");
}
