import { get, readDB, verifyAuth } from "./lib/storage.mjs";

const ADMIN_EMAIL = "achrafbach1@gmail.com";

/**
 * GET /api/get-results?type=latest|history|best-of-day|hall-of-fame
 * 
 * All results are GLOBAL — all authenticated users see the same shared analysis.
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

  try {
    // 🔒 Require valid session
    const user = verifyAuth(event);
    console.log(`[VentureLens] Authorized access for ${user.email} (${type})`);

    let data;

    switch (type) {
      case "latest":
        data = await get("latest"); // global
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

    // Attach admin flag so the frontend can show/hide the Run button
    const responseData = Array.isArray(data)
      ? data
      : { ...data, isAdmin: user.email === ADMIN_EMAIL };

    return {
      statusCode: 200, headers,
      body: JSON.stringify(responseData),
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
