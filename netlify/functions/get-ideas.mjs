/**
 * Get Ideas API
 * 
 * Query the idea database with filters
 * GET /api/get-ideas?priority=GOLD&limit=20
 */

import { queryIdeas, getCuratedLists, getIdeaStats } from "./lib/idea-storage.mjs";

export const handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers };
  }

  try {
    const params = event.queryStringParameters || {};
    
    // Special endpoints
    if (params.action === "stats") {
      const stats = await getIdeaStats();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(stats),
      };
    }
    
    if (params.action === "curated") {
      const lists = await getCuratedLists();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(lists),
      };
    }

    // Build filters from query params
    const filters = {};
    
    if (params.priority) {
      filters.priority = params.priority.includes(",") 
        ? params.priority.split(",")
        : params.priority;
    }
    
    if (params.source) {
      filters.source = params.source.includes(",")
        ? params.source.split(",")
        : params.source;
    }
    
    if (params.sourceType) {
      filters.sourceType = params.sourceType.includes(",")
        ? params.sourceType.split(",")
        : params.sourceType;
    }
    
    if (params.minQualityScore) {
      filters.minQualityScore = parseFloat(params.minQualityScore);
    }
    
    if (params.hasValidation === "true") {
      filters.hasValidation = true;
    }
    
    if (params.hasPainPoint === "true") {
      filters.hasPainPoint = true;
    }
    
    if (params.startDate) {
      filters.startDate = params.startDate;
    }
    
    if (params.endDate) {
      filters.endDate = params.endDate;
    }
    
    if (params.search) {
      filters.search = params.search;
    }
    
    if (params.sortBy) {
      filters.sortBy = params.sortBy;
    }
    
    if (params.limit) {
      filters.limit = parseInt(params.limit);
    }
    
    if (params.page) {
      const page = parseInt(params.page);
      const limit = filters.limit || 50;
      filters.skip = (page - 1) * limit;
    }

    const result = await queryIdeas(filters);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (err) {
    console.error("[get-ideas] Error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: err.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
