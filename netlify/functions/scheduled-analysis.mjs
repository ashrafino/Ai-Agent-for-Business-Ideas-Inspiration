import { schedule } from "@netlify/functions";
import { runFullDebate, curateTopIdeas } from "./lib/groq.mjs";
import { update } from "./lib/storage.mjs";

// Runs every hour — fully automated, saves directly to Netlify Blobs
export const handler = schedule("0 * * * *", async (event, context) => {
  console.log("[VentureLens] Hourly automation starting...");
  const runStart = Date.now();

  try {
    const result = await runFullDebate({ netlifyContext: context });
    const today  = new Date().toISOString().slice(0, 10);

    let newAdmissions = 0;

    await update(async (db) => {
      // 1. Save as latest
      db.latest = {
        id:        result.id,
        timestamp: result.timestamp,
        status:    "complete",
        phases:    result.phases,
        ideas:     result.ideas,
      };

      // 2. Update history (max 50)
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
      db.todayIdeas = [...(db.todayIdeas || []), ...result.ideas];

      // 4. Best-of-Day
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

      // 5. Curator: Hall of Fame
      const highScorers = result.ideas.filter((i) => (i.compositeScore || 0) >= 7.0);
      if (highScorers.length > 0) {
        try {
          const curatorResult = await curateTopIdeas(highScorers, db.hallOfFame || []);
          db.hallOfFame = curatorResult.topIdeas;
          newAdmissions = (curatorResult.decisions || []).filter((d) => d.admitToHallOfFame).length;
        } catch (err) {
          console.warn("[VentureLens] Curator failed (non-fatal):", err.message);
        }
      }

      return db;
    });

    const duration = ((Date.now() - runStart) / 1000).toFixed(1);
    console.log(`[VentureLens] Done in ${duration}s — ${result.ideas.length} ideas, ${newAdmissions} HoF admissions`);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, ideasCount: result.ideas.length, newAdmissions, durationSeconds: duration }),
    };
  } catch (error) {
    console.error("[VentureLens] Hourly analysis failed:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
});
