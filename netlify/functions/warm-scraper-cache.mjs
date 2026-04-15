import { schedule } from "@netlify/functions";
import { scrapeAllSources } from "./lib/scraper.mjs";

/**
 * Runs every 6 hours to pre-warm the scraper cache in Netlify Blobs.
 * The Scout agent always has fresh data ready instantly,
 * without adding scraping latency to live debate rounds.
 */
export const handler = schedule("0 */6 * * *", async () => {
  console.log("[VentureLens] Scheduled scraper warming cache...");
  const start = Date.now();

  try {
    const results = await scrapeAllSources();

    const sources = {
      hackerNews:          results.hackerNews?.posts?.length          || 0,
      hackerNewsAsk:       results.hackerNewsAsk?.posts?.length       || 0,
      reddit:              results.reddit?.posts?.length              || 0,
      productHunt:         results.productHunt?.posts?.length         || 0,
      indieHackers:        results.indieHackers?.posts?.length        || 0,
      githubTrending:      results.githubTrending?.repos?.length      || 0,
      googleTrends:        results.googleTrends?.trends?.length       || 0,
      ycombinator:         results.ycombinator?.companies?.length     || 0,
      devTo:               results.devTo?.posts?.length               || 0,
      betaList:            results.betaList?.posts?.length            || 0,
      appSumo:             results.appSumo?.posts?.length             || 0,
      acquire:             results.acquire?.posts?.length             || 0,
      starterStory:        results.starterStory?.posts?.length        || 0,
      explodingTopics:     results.explodingTopics?.posts?.length     || 0,
      failory:             results.failory?.posts?.length             || 0,
      bootstrappedFounder: results.bootstrappedFounder?.posts?.length || 0,
    };

    const totalItems = Object.values(sources).reduce((a, b) => a + b, 0);
    const duration   = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`[VentureLens] Cache warmed: ${totalItems} items in ${duration}s`, sources);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, totalItems, duration, sources }),
    };
  } catch (error) {
    console.error("[VentureLens] Scheduled scraper failed:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
});
