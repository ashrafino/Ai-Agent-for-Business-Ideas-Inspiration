import { update, verifyAuth } from "./lib/storage.mjs";
import { runFullDebate } from "./lib/groq.mjs";

/**
 * POST /api/trigger-analysis
 * Manual trigger to run a full 9-round analysis from the UI.
 * Saves results through the shared storage module (same as scheduled-analysis).
 */
export const handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  console.log("[VentureLens] Manual analysis trigger received");

  try {
    // 🔒 Enforce Authentication
    const user = verifyAuth(event);
    console.log(`[VentureLens] Authorized analysis trigger for ${user.email}`);

    const result = await runFullDebate({ netlifyContext: context });
    const today  = new Date().toISOString().slice(0, 10);

    await update((db) => {
      // 1. Save as latest
      db.latest = {
        id:        result.id,
        timestamp: result.timestamp,
        status:    "complete",
        phases:    result.phases,
        ideas:     result.ideas,
      };

      // 2. Update history (max 50, no duplicates)
      if (!db.history) db.history = [];
      if (!db.history.find((h) => h.id === result.id)) {
        db.history.unshift({
          id:        result.id,
          timestamp: result.timestamp,
          ideaCount: result.ideas.length,
          topIdea:   result.ideas[0]?.name          || "Unknown",
          topTier:   result.ideas[0]?.tier          || "?",
          topScore:  result.ideas[0]?.compositeScore || 0,
        });
        db.history = db.history.slice(0, 50);
      }

      // 3. Accumulate today's ideas
      if (db.todayDate !== today) {
        db.todayIdeas = [];
        db.todayDate  = today;
      }
      if (!db.todayIdeas) db.todayIdeas = [];
      db.todayIdeas.push(...result.ideas);

      // 4. Build Best-of-Day (deduplicate by name, top 10 by score)
      const ideaMap = new Map();
      for (const idea of db.todayIdeas) {
        const key = (idea.name || "").toLowerCase().trim();
        const cur = ideaMap.get(key);
        if (!cur || (idea.compositeScore || 0) > (cur.compositeScore || 0)) {
          ideaMap.set(key, idea);
        }
      }
      const ranked = [...ideaMap.values()]
        .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))
        .slice(0, 10)
        .map((idea, i) => ({ ...idea, dayRank: i + 1 }));

      db.bestOfDay = {
        date:    today,
        ideas:   ranked,
        totalIdeasAnalyzed: db.todayIdeas.length,
        uniqueIdeas: ideaMap.size,
        totalRuns: db.history.filter((h) => h.timestamp?.startsWith(today)).length,
        topScore: ranked[0]?.compositeScore || 0,
        generatedAt: new Date().toISOString(),
      };

      return db;
    }, user.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (error) {
    const isAuthError = error.message.includes("authorization") || error.message.includes("token");
    console.warn("[VentureLens] Manual trigger error:", error.message);
    return {
      statusCode: isAuthError ? 401 : 500,
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
