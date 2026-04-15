/**
 * Idea Storage Module
 * 
 * Manages persistent storage of startup ideas in MongoDB
 * Handles deduplication, classification, and querying
 */

import { MongoClient } from "mongodb";

let cachedClient = null;
let cachedDb = null;

// Get MongoDB connection
async function getDatabase() {
  if (cachedDb) return cachedDb;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set.");
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri);
    await cachedClient.connect();
    console.log("[MongoDB] Connected successfully");
  }

  cachedDb = cachedClient.db("venturelens");
  return cachedDb;
}

// Save ideas to database with deduplication
export async function saveIdeasToDB(ideas) {
  const db = await getDatabase();
  const collection = db.collection("ideas");

  // Create indexes for efficient querying
  await collection.createIndex({ uniqueId: 1 }, { unique: true });
  await collection.createIndex({ scrapedAt: -1 });
  await collection.createIndex({ priority: 1 });
  await collection.createIndex({ qualityScore: -1 });
  await collection.createIndex({ source: 1 });
  await collection.createIndex({ sourceType: 1 });

  // Bulk insert with deduplication
  const operations = ideas.map(idea => ({
    updateOne: {
      filter: { uniqueId: idea.uniqueId },
      update: {
        $set: idea,
        $setOnInsert: { firstSeenAt: new Date() },
        $inc: { seenCount: 1 },
      },
      upsert: true,
    },
  }));

  if (operations.length === 0) {
    return { insertedCount: 0, modifiedCount: 0 };
  }

  const result = await collection.bulkWrite(operations);
  
  console.log(`[MongoDB] Upserted ${result.upsertedCount} new ideas, updated ${result.modifiedCount} existing`);
  
  return {
    insertedCount: result.upsertedCount,
    modifiedCount: result.modifiedCount,
    totalProcessed: ideas.length,
  };
}

// Get database statistics
export async function getIdeaStats() {
  const db = await getDatabase();
  const collection = db.collection("ideas");

  const [total, byPriority, bySour, byType, recent] = await Promise.all([
    collection.countDocuments(),
    collection.aggregate([
      { $group: { _id: "$priority", count: { $sum: 1 } } },
    ]).toArray(),
    collection.aggregate([
      { $group: { _id: "$source", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray(),
    collection.aggregate([
      { $group: { _id: "$sourceType", count: { $sum: 1 } } },
    ]).toArray(),
    collection.countDocuments({
      scrapedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);

  return {
    total,
    last24Hours: recent,
    byPriority: byPriority.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
    topSources: bySour.map(s => ({ source: s._id, count: s.count })),
    byType: byType.reduce((acc, item) => {
      acc[item._id] = item.count;
      return acc;
    }, {}),
  };
}

// Query ideas with filters
export async function queryIdeas(filters = {}) {
  const db = await getDatabase();
  const collection = db.collection("ideas");

  const query = {};
  
  // Priority filter
  if (filters.priority) {
    query.priority = Array.isArray(filters.priority) 
      ? { $in: filters.priority }
      : filters.priority;
  }
  
  // Quality score filter
  if (filters.minQualityScore) {
    query.qualityScore = { $gte: filters.minQualityScore };
  }
  
  // Source filter
  if (filters.source) {
    query.source = Array.isArray(filters.source)
      ? { $in: filters.source }
      : filters.source;
  }
  
  // Source type filter
  if (filters.sourceType) {
    query.sourceType = Array.isArray(filters.sourceType)
      ? { $in: filters.sourceType }
      : filters.sourceType;
  }
  
  // Date range filter
  if (filters.startDate || filters.endDate) {
    query.scrapedAt = {};
    if (filters.startDate) query.scrapedAt.$gte = new Date(filters.startDate);
    if (filters.endDate) query.scrapedAt.$lte = new Date(filters.endDate);
  }
  
  // Validation filter
  if (filters.hasValidation) {
    query.hasValidation = true;
  }
  
  // Pain point filter
  if (filters.hasPainPoint) {
    query.hasPainPoint = true;
  }
  
  // Text search
  if (filters.search) {
    query.$text = { $search: filters.search };
  }

  // Sorting
  const sort = {};
  if (filters.sortBy === "quality") {
    sort.qualityScore = -1;
  } else if (filters.sortBy === "engagement") {
    sort.upvotes = -1;
  } else {
    sort.scrapedAt = -1; // Default: newest first
  }

  // Pagination
  const limit = filters.limit || 50;
  const skip = filters.skip || 0;

  const ideas = await collection
    .find(query)
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .toArray();

  const total = await collection.countDocuments(query);

  return {
    ideas,
    total,
    page: Math.floor(skip / limit) + 1,
    totalPages: Math.ceil(total / limit),
    hasMore: skip + ideas.length < total,
  };
}

// Get curated lists
export async function getCuratedLists() {
  const db = await getDatabase();
  const collection = db.collection("ideas");

  const [goldIdeas, painPoints, validated, trending] = await Promise.all([
    // Gold tier ideas (highest quality)
    collection
      .find({ priority: "GOLD" })
      .sort({ qualityScore: -1 })
      .limit(20)
      .toArray(),
    
    // Clear pain points
    collection
      .find({ hasPainPoint: true, priority: { $in: ["GOLD", "HIGH"] } })
      .sort({ qualityScore: -1 })
      .limit(20)
      .toArray(),
    
    // Validated ideas (with traction)
    collection
      .find({ hasValidation: true })
      .sort({ qualityScore: -1 })
      .limit(20)
      .toArray(),
    
    // Trending (recent + high engagement)
    collection
      .find({
        scrapedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        upvotes: { $gte: 50 },
      })
      .sort({ upvotes: -1 })
      .limit(20)
      .toArray(),
  ]);

  return {
    goldIdeas,
    painPoints,
    validated,
    trending,
  };
}

// Export for AI analysis
export async function exportForAnalysis(filters = {}) {
  const result = await queryIdeas({
    ...filters,
    limit: 100,
    sortBy: "quality",
  });

  return result.ideas.map(idea => ({
    title: idea.title,
    description: idea.description,
    source: idea.source,
    priority: idea.priority,
    qualityScore: idea.qualityScore,
    upvotes: idea.upvotes,
    url: idea.url,
    topics: idea.topics,
    hasValidation: idea.hasValidation,
    hasPainPoint: idea.hasPainPoint,
  }));
}
