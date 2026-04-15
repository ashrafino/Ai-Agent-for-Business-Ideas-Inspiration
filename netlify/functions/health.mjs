import { healthCheck, verifyAuth } from "./lib/storage.mjs";

/**
 * GET /api/health
 * Tests Netlify Blobs storage read and write.
 */
export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    // 🔒 Enforce Authentication
    const user = verifyAuth(event);
    console.log(`[Health] Authorized check for ${user.email}`);

    const result = await healthCheck();
    return {
      statusCode: result.canWrite ? 200 : 503,
      headers,
      body: JSON.stringify({
        ok:           result.canWrite,
        canRead:      result.canRead,
        canWrite:     result.canWrite,
        historyCount: result.historyCount  || 0,
        hofCount:     result.hofCount      || 0,
        latestIdeas:  result.latestIdeas   || 0,
        storage:      "mongodb-atlas",
        error:        result.error || null,
        ts:           new Date().toISOString(),
      }),
    };
  } catch (error) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ ok: false, error: error.message, storage: "mongodb-atlas" }),
    };
  }
};
