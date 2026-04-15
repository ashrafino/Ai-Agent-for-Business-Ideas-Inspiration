/**
 * Update User Profile API
 *
 * POST /update-profile
 * Updates the authenticated user's interest profile preferences.
 */

import { verifyAuth } from "./lib/storage.mjs";
import { saveProfile, getDefaultWeights } from "./lib/user-profile.mjs";
import { INTEREST_DOMAINS } from "./lib/constants.mjs";

const VALID_SKILL_LEVELS = ["technical", "non-technical", "mixed"];
const VALID_IDEA_SIZES   = ["micro-saas", "full-startup", "any"];

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

  const { interestDomains, skillLevel, ideaSize } = body;

  // Validate fields
  const errors = [];

  if (interestDomains !== undefined) {
    if (!Array.isArray(interestDomains)) {
      errors.push("interestDomains must be an array");
    } else {
      const invalid = interestDomains.filter((d) => !INTEREST_DOMAINS.includes(d));
      if (invalid.length > 0) {
        errors.push(`interestDomains contains invalid values: ${invalid.join(", ")}`);
      }
    }
  }

  if (skillLevel !== undefined && !VALID_SKILL_LEVELS.includes(skillLevel)) {
    errors.push(`skillLevel must be one of: ${VALID_SKILL_LEVELS.join(", ")}`);
  }

  if (ideaSize !== undefined && !VALID_IDEA_SIZES.includes(ideaSize)) {
    errors.push(`ideaSize must be one of: ${VALID_IDEA_SIZES.join(", ")}`);
  }

  if (errors.length > 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: errors.join("; ") }),
    };
  }

  // Build profile object
  const profile = {
    ...(interestDomains !== undefined && { interestDomains }),
    ...(skillLevel      !== undefined && { skillLevel }),
    ...(ideaSize        !== undefined && { ideaSize }),
    preferenceWeights: getDefaultWeights(),
  };

  // Save profile (upsert — saveProfile preserves existing fields via $set)
  try {
    await saveProfile(user.id, profile);
  } catch (err) {
    console.error("[update-profile] DB error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to save profile" }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, profile: { userId: user.id, ...profile } }),
  };
};
