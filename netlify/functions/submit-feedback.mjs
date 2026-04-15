/**
 * Submit Feedback API
 *
 * POST /submit-feedback
 * Records a user feedback signal and applies it to their preference profile.
 */

import { verifyAuth } from "./lib/storage.mjs";
import { recordFeedback, applyFeedbackToProfile } from "./lib/feedback.mjs";

const VALID_SIGNAL_TYPES = ["thumbs_up", "thumbs_down", "save", "skip"];

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // Auth
  let user;
  try {
    user = verifyAuth(event);
  } catch (err) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const { itemId, itemSource, itemDomains, signalType } = body;

  // Validate required fields
  const errors = [];

  if (!itemId || typeof itemId !== "string") {
    errors.push("itemId is required and must be a string");
  }
  if (!itemSource || typeof itemSource !== "string") {
    errors.push("itemSource is required and must be a string");
  }
  if (!Array.isArray(itemDomains) || itemDomains.some((d) => typeof d !== "string")) {
    errors.push("itemDomains is required and must be an array of strings");
  }
  if (!signalType || !VALID_SIGNAL_TYPES.includes(signalType)) {
    errors.push(`signalType must be one of: ${VALID_SIGNAL_TYPES.join(", ")}`);
  }

  if (errors.length > 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: errors.join("; ") }),
    };
  }

  const signal = {
    userId: user.id,
    itemId,
    itemSource,
    itemDomains,
    signalType,
    timestamp: new Date().toISOString(),
  };

  // Persist signal and update profile
  try {
    await recordFeedback(signal);
    await applyFeedbackToProfile(user.id, signal);
  } catch (err) {
    console.error("[submit-feedback] DB error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `Failed to record feedback: ${err.message}` }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true }),
  };
};
