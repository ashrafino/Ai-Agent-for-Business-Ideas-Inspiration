/**
 * Source Quality API
 *
 * GET /source-quality
 * Returns all Source_Quality_Records. Authenticated users only.
 */

import { verifyAuth } from "./lib/storage.mjs";
import { getAllSourceQuality } from "./lib/source-quality.mjs";

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Auth — authenticated users only (Requirement 6.4)
  try {
    verifyAuth(event);
  } catch (err) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }

  try {
    const records = await getAllSourceQuality();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(records),
    };
  } catch (err) {
    console.error("[source-quality] DB error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to fetch source quality records" }),
    };
  }
};
