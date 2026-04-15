import { update } from "./lib/storage.mjs";

/**
 * POST /api/save-session
 * 
 * Saves analysis session to Netlify Blobs storage.
 * Fast (~2-3s), no LLM calls. Curator runs via /api/curate separately.
 */
export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { session } = JSON.parse(event.body || "{}");

    if (!session || !Array.isArray(session.ideas) || session.ideas.length === 0) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: "Session must have at least one idea" }),
      };
    }

    const today = new Date().toISOString().slice(0, 10);

    // Compact session — no debate logs to keep file lean
    const compact = {
      id:        session.id,
      timestamp: session.timestamp,
      status:    "complete",
      phases:    session.phases,
      ideas:     session.ideas,
    };

    const updatedDb = await update((db) => {
      // 1. Save as latest
      db.latest = compact;

      // 2. Update history (max 50, no duplicates)
      if (!db.history) db.history = [];
      if (!db.history.find((h) => h.id === session.id)) {
        db.history.unshift({
          id:        session.id,
          timestamp: session.timestamp,
          ideaCount: session.ideas.length,
          topIdea:   session.ideas[0]?.name         || "Unknown",
          topTier:   session.ideas[0]?.tier         || "?",
          topScore:  session.ideas[0]?.compositeScore || 0,
        });
        db.history = db.history.slice(0, 50);
      }

      // 3. Accumulate today's ideas
      if (db.todayDate !== today) {
        db.todayIdeas = [];
        db.todayDate  = today;
      }
      if (!db.todayIdeas) db.todayIdeas = [];
      db.todayIdeas.push(...session.ideas);

      // 4. Build Best-of-Day (deduplicate by name, top 10 by score)
      const ideaMap = new Map();
      for (const idea of db.todayIdeas) {
        const key = (idea.name || "").toLowerCase().trim();
        const cur = ideaMap.get(key);
        if (!cur || (idea.compositeScore || 0) > (cur.compositeScore || 0)) {
          ideaMap.set(key, idea);
        }
      }
      const todayRanked = [...ideaMap.values()]
        .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))
        .slice(0, 10)
        .map((idea, i) => ({ ...idea, dayRank: i + 1 }));

      db.bestOfDay = {
        date: today,
        ideas: todayRanked,
        totalIdeasAnalyzed: db.todayIdeas.length,
        uniqueIdeas: ideaMap.size,
        totalRuns: db.history.filter((h) => h.timestamp?.startsWith(today)).length,
        topScore:   todayRanked[0]?.compositeScore || 0,
        generatedAt: new Date().toISOString(),
      };

      return db;
    });

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        sessionId:       compact.id,
        ideasSaved:      compact.ideas.length,
        historySessions: updatedDb.history.length,
        bestOfDayTop:    updatedDb.bestOfDay?.ideas?.length || 0,
      }),
    };
  } catch (error) {
    console.error("[VentureLens] save-session error:", error.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
