import { get, readDB } from "./lib/storage.mjs";

/**
 * GET /api/get-results?type=latest|history|best-of-day|hall-of-fame
 * 
 * Reads data from Netlify Blobs storage.
 */
export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  const type = event.queryStringParameters?.type || "latest";

  try {
    let data;

    switch (type) {
      case "latest":
        data = await get("latest");
        if (!data) data = { status: "empty", ideas: [] };
        break;

      case "history":
        data = (await get("history")) || [];
        break;

      case "best-of-day":
        data = (await get("bestOfDay")) || { ideas: [] };
        break;

      case "hall-of-fame":
        data = (await get("hallOfFame")) || [];
        break;

      case "all": {
        // Return full DB snapshot (used by health check etc.)
        const { db } = await readDB();
        data = db;
        break;
      }

      default:
        return {
          statusCode: 400, headers,
          body: JSON.stringify({ error: `Unknown type: ${type}` }),
        };
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error(`[VentureLens] get-results (${type}) error:`, error.message);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
