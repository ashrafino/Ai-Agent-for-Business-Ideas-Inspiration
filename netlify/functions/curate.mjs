import { update } from "./lib/storage.mjs";
import { curateTopIdeas, verifyAuth } from "./lib/storage.mjs";

/**
 * POST /api/curate
 * Fire-and-forget: runs the Master Curator LLM and updates hall-of-fame in Netlify Blobs
 */
export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    // 🔒 Enforce Authentication
    const user = verifyAuth(event);
    console.log(`[Curate] Authorized curation for ${user.email}`);

    const { ideas } = JSON.parse(event.body || "{}");
    if (!Array.isArray(ideas) || ideas.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "ideas array required" }) };
    }

    const highScorers = ideas.filter((i) => (i.compositeScore || 0) >= 7.0);
    if (highScorers.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, message: "No ideas met the 7.0 threshold", newAdmissions: 0 }),
      };
    }

    // Read current HoF, run curator, write back
    let newAdmissions = 0;
    let hofSize = 0;

    await update(async (db) => {
      const currentHoF = db.hallOfFame || [];
      const curatorResult = await curateTopIdeas(highScorers, currentHoF);
      newAdmissions  = (curatorResult.decisions || []).filter((d) => d.admitToHallOfFame).length;
      db.hallOfFame  = curatorResult.topIdeas;
      hofSize        = db.hallOfFame.length;
      return db;
    });

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ success: true, newAdmissions, hofSize }),
    };
  } catch (error) {
    console.error("[VentureLens] curate error:", error.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
