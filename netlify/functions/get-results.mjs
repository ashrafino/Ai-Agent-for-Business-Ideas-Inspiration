import { get, readDB, verifyAuth } from "./lib/storage.mjs";

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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  const type = event.queryStringParameters?.type || "latest";

    const user = verifyAuth(event);
    console.log(`[VentureLens] Authorized access for ${user.email} (${type})`);

    let data;

    switch (type) {
      case "latest":
        data = await get("latest", user.id);
        if (!data) data = { status: "empty", ideas: [] };
        break;

      case "history":
        data = (await get("history", user.id)) || [];
        break;

      case "best-of-day":
        data = (await get("bestOfDay", user.id)) || { ideas: [] };
        break;

      case "hall-of-fame":
        data = (await get("hallOfFame", user.id)) || [];
        break;

      case "all": {
        // Return full DB snapshot (used by health check etc.)
        const { db } = await readDB(user.id);
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
    const isAuthError = error.message.includes("authorization") || error.message.includes("token");
    console.warn(`[VentureLens] get-results (${type}) error:`, error.message);
    return {
      statusCode: isAuthError ? 401 : 500, 
      headers,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
