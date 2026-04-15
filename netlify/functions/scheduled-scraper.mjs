/**
 * Scheduled Scraper - Runs every 2 hours
 * 
 * Continuously scrapes sources, optimizes content, and stores in MongoDB
 * Builds a comprehensive database of startup ideas over time
 */

import { schedule } from "@netlify/functions";
import { scrapeAllSources } from "./lib/scraper.mjs";
import { saveIdeasToDB, getIdeaStats } from "./lib/idea-storage.mjs";

const handler = async (event) => {
  console.log("[Scheduled Scraper] Starting automated scrape cycle...");
  const startTime = Date.now();

  try {
    // Scrape all sources with optimization
    const scraped = await scrapeAllSources();
    
    // Extract and classify all ideas
    const ideas = extractIdeas(scraped);
    console.log(`[Scheduled Scraper] Extracted ${ideas.length} ideas`);
    
    // Save to MongoDB with classification
    const saved = await saveIdeasToDB(ideas);
    console.log(`[Scheduled Scraper] Saved ${saved.insertedCount} new ideas to database`);
    
    // Get database stats
    const stats = await getIdeaStats();
    
    const duration = Date.now() - startTime;
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        timestamp: new Date().toISOString(),
        duration: `${duration}ms`,
        scraped: ideas.length,
        saved: saved.insertedCount,
        duplicates: ideas.length - saved.insertedCount,
        databaseStats: stats,
      }),
    };
  } catch (err) {
    console.error("[Scheduled Scraper] Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: err.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};

// Extract and classify ideas from scraped data
function extractIdeas(scraped) {
  const ideas = [];
  
  // Helper to add ideas with metadata
  const addIdeas = (items, source, type) => {
    if (!items || !Array.isArray(items)) return;
    
    items.forEach(item => {
      ideas.push({
        // Core data
        title: item.title || item.name,
        description: item.description || item.tagline || "",
        url: item.url || item.website || "",
        
        // Source metadata
        source,
        sourceType: type,
        scrapedAt: new Date(),
        
        // Engagement metrics
        upvotes: item.upvotes || item.score || item.votes || 0,
        comments: item.comments || item.commentsCount || 0,
        
        // Classification (from optimizer)
        qualityScore: item._qualityScore || 0,
        priority: item._priority || "MEDIUM",
        
        // Additional metadata
        topics: item.topics || item.tags || [],
        makers: item.makers || [],
        subreddit: item.subreddit || null,
        featuredAt: item.featuredAt || null,
        
        // Analysis flags
        hasValidation: item._analysis?.validationScore > 0,
        hasPainPoint: item._analysis?.painPointScore > 0,
        isStartupRelevant: item._analysis?.startupRelevanceScore > 0,
        
        // Unique identifier for deduplication
        uniqueId: generateUniqueId(item.title, source),
      });
    });
  };
  
  // Extract from all sources
  addIdeas(scraped.hackerNews?.posts, "Hacker News Show", "launch");
  addIdeas(scraped.hackerNewsAsk?.posts, "Hacker News Ask", "pain-point");
  addIdeas(scraped.reddit?.posts, "Reddit", "discussion");
  addIdeas(scraped.productHunt?.posts, "Product Hunt", "launch");
  addIdeas(scraped.indieHackers?.posts, "Indie Hackers", "validation");
  addIdeas(scraped.devTo?.posts, "DEV.to", "article");
  addIdeas(scraped.betaList?.posts, "BetaList", "launch");
  addIdeas(scraped.lobsters?.posts, "Lobsters", "discussion");
  addIdeas(scraped.appSumo?.posts, "AppSumo", "deal");
  addIdeas(scraped.starterStory?.posts, "Starter Story", "case-study");
  addIdeas(scraped.githubTrending?.repos, "GitHub", "open-source");
  addIdeas(scraped.ycombinator?.companies, "Y Combinator", "funded");
  
  // Custom sources
  if (scraped.custom) {
    scraped.custom.forEach(customSource => {
      addIdeas(customSource.posts, customSource.sourceLabel || "Custom", "custom");
    });
  }
  
  return ideas;
}

function generateUniqueId(title, source) {
  // Normalize title for deduplication
  const normalized = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 50);
  
  return `${source.toLowerCase().replace(/\s+/g, "-")}-${normalized}`;
}

// Run every 2 hours
export default schedule("0 */2 * * *", handler);
