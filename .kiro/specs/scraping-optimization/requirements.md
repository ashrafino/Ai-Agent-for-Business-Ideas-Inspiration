# Requirements Document

## Introduction

VentureLens is a startup idea discovery tool that scrapes 17+ open-source data sources to surface relevant startup opportunities. Currently the scraping pipeline is stateless and global — every user receives the same results regardless of their interests, background, or feedback history. This feature optimizes the scraping system for personalization, quality, and SaaS readiness. It introduces per-user interest profiles, a feedback loop that improves future results, per-user relevance scoring, smarter LLM context formatting, source quality tracking, and rate limiting — all while staying within the constraints of Netlify Functions (10s timeout) and MongoDB Atlas.

## Glossary

- **Scraper**: The module (`scraper.mjs`) that fetches raw content from external sources.
- **Optimizer**: The module (`scraper-optimizer.mjs`) that scores and filters scraped content before it reaches the LLM.
- **User_Profile**: A per-user MongoDB document storing interest domains, skill level, feedback history, and derived preference weights.
- **Interest_Domain**: A named category of startup topics (e.g., "AI/ML", "No-Code", "Developer Tools", "B2B SaaS", "Consumer Apps") that a user selects or that is inferred from feedback.
- **Relevance_Score**: A numeric score (0–100) computed per scraped item per user, combining global quality score with user-specific interest weights.
- **Feedback_Signal**: A user action (thumbs up, thumbs down, save, skip) recorded against a specific scraped item or generated idea.
- **Global_Cache**: The existing shared MongoDB `scraper_cache` document used by all users.
- **User_Cache**: A per-user MongoDB document storing the top-N relevance-ranked items for that user, derived from the Global_Cache.
- **Source_Quality_Record**: A MongoDB document tracking per-source success rate, average item quality score, and last-fetch latency over time.
- **Rate_Limit_Record**: A per-user MongoDB document tracking API call counts within rolling time windows.
- **LLM_Context**: The formatted text string passed to the Groq LLM for idea generation.
- **Preference_Weight**: A floating-point multiplier (0.1–3.0) per Interest_Domain per user, updated by Feedback_Signals.
- **Scrape_Session**: A single execution of the scraping pipeline for a given user request.

---

## Requirements

### Requirement 1: User Interest Profile

**User Story:** As a user, I want to specify my interests and background so that VentureLens surfaces startup ideas relevant to me and my startup contry/location rather than generic results.

#### Acceptance Criteria

1. THE User_Profile SHALL store at least: selected Interest_Domains (multi-select), self-reported skill level (technical / non-technical / mixed), preferred idea size (micro-SaaS / full startup / any), and a `createdAt` timestamp.
2. WHEN a user submits an Interest_Domain selection, THE System SHALL persist the User_Profile to MongoDB within 2 seconds.
3. WHEN a User_Profile does not exist for a user, THE System SHALL treat all Interest_Domains as equally weighted (Preference_Weight = 1.0 for each).
4. THE User_Profile SHALL support at least 8 predefined Interest_Domains: "AI/ML Tools", "Developer Tools", "No-Code/Low-Code", "B2B SaaS", "Consumer Apps", "Productivity", "E-commerce", "Data & Analytics".
5. WHEN a user updates their Interest_Domain selection, THE System SHALL overwrite the previous selection and recalculate Preference_Weights without deleting historical Feedback_Signals.

---

### Requirement 2: Per-User Relevance Scoring

**User Story:** As a user, I want the system to rank scraped content by how relevant it is to my specific interests so that I spend less time filtering noise.

#### Acceptance Criteria

1. WHEN the Optimizer processes scraped items for a user with a User_Profile, THE Optimizer SHALL compute a Relevance_Score for each item by multiplying the item's global quality score by the sum of matching Interest_Domain Preference_Weights.
2. WHEN a scraped item matches zero Interest_Domains of the user, THE Optimizer SHALL assign a Relevance_Score equal to the item's global quality score multiplied by 0.3.
3. THE Optimizer SHALL rank items in descending order of Relevance_Score before passing them to the LLM_Context formatter.
4. WHEN computing Relevance_Score, THE Optimizer SHALL apply domain-matching by checking item title, description, and tags against a keyword map of at least 5 keywords per Interest_Domain.
5. THE Optimizer SHALL complete per-user relevance scoring for up to 500 scraped items within 500 milliseconds (in-process, no external calls).

---

### Requirement 3: Feedback Loop

**User Story:** As a user, I want my reactions to ideas (thumbs up/down, save, skip) to improve future recommendations so that results get better over time.

#### Acceptance Criteria

1. WHEN a user submits a Feedback_Signal (thumbs_up, thumbs_down, save, or skip) on an item, THE System SHALL persist the signal to MongoDB with: userId, itemId, itemSource, itemDomains, signalType, and timestamp — within 2 seconds.
2. WHEN a thumbs_up or save Feedback_Signal is recorded for an item, THE System SHALL increase the Preference_Weight for each Interest_Domain associated with that item by 0.1, capped at 3.0.
3. WHEN a thumbs_down Feedback_Signal is recorded for an item, THE System SHALL decrease the Preference_Weight for each Interest_Domain associated with that item by 0.1, floored at 0.1.
4. WHEN a skip Feedback_Signal is recorded, THE System SHALL leave Preference_Weights unchanged.
5. THE System SHALL apply updated Preference_Weights to the next Scrape_Session for that user without requiring a page reload.
6. IF a Feedback_Signal submission fails due to a database error, THEN THE System SHALL return an error response with HTTP status 500 and a descriptive message, and SHALL NOT silently discard the signal.

---

### Requirement 4: Per-User Cache Layer

**User Story:** As a SaaS operator, I want each user's personalized results to be cached so that repeated requests are fast and do not re-run expensive scraping or LLM calls.

#### Acceptance Criteria

1. THE System SHALL maintain a User_Cache document per user in MongoDB, storing the top-50 relevance-ranked items derived from the most recent Global_Cache.
2. WHEN the Global_Cache is refreshed, THE System SHALL invalidate all User_Cache documents by setting a `globalCacheVersion` field that User_Cache documents compare against on read.
3. WHEN a user requests results and a valid User_Cache exists (same `globalCacheVersion` as Global_Cache), THE System SHALL return the cached User_Cache without re-running relevance scoring.
4. WHEN a user's Preference_Weights change due to a Feedback_Signal, THE System SHALL mark that user's User_Cache as stale so the next request triggers re-scoring.
5. THE User_Cache document SHALL include: userId, globalCacheVersion, rankedItems (array), computedAt timestamp, and a TTL of 6 hours matching the Global_Cache TTL.

---

### Requirement 5: Smarter LLM Context Formatting

**User Story:** As a user, I want the LLM to receive only the most relevant and concise context so that the generated startup ideas are higher quality and more targeted to my interests.

#### Acceptance Criteria

1. WHEN formatting LLM_Context for a user with a User_Profile, THE LLM_Formatter SHALL include only items with Relevance_Score above 40, up to a maximum of 60 items total.
2. THE LLM_Formatter SHALL group items by Interest_Domain match and label each group with the matched domain name in the LLM_Context string.
3. WHEN a user has Interest_Domains set, THE LLM_Formatter SHALL prepend a "User Focus" section to the LLM_Context listing the user's top 3 Interest_Domains by Preference_Weight.
4. THE LLM_Formatter SHALL truncate individual item descriptions to 120 characters to reduce token usage.
5. THE LLM_Formatter SHALL include the item's Relevance_Score and priority tier (GOLD/HIGH/MEDIUM) in the LLM_Context so the LLM can weight its analysis accordingly.
6. WHEN no User_Profile exists, THE LLM_Formatter SHALL fall back to the existing `formatScrapedDataForLLM` behavior to preserve backward compatibility.

---

### Requirement 6: Source Quality Tracking

**User Story:** As a SaaS operator, I want to track which sources consistently deliver high-quality content so that low-performing sources can be deprioritized automatically.

#### Acceptance Criteria

1. WHEN a Scrape_Session completes, THE System SHALL upsert a Source_Quality_Record for each source with: sourceName, lastFetchAt, fetchDurationMs, itemCount, averageQualityScore, successRate (rolling 7-day), and errorCount.
2. WHEN a source fetch fails, THE System SHALL increment that source's errorCount and record the error message in the Source_Quality_Record without halting the overall Scrape_Session.
3. WHEN the Optimizer loads source weights, THE Optimizer SHALL apply a credibility multiplier of 0.5 to any source whose 7-day successRate is below 50%.
4. THE System SHALL expose a read endpoint that returns all Source_Quality_Records, accessible only to authenticated users.
5. WHEN a source's averageQualityScore falls below 20 for 3 consecutive Scrape_Sessions, THE System SHALL log a warning with the source name and score to the server console.

---

### Requirement 7: Rate Limiting Per User

**User Story:** As a SaaS operator, I want to enforce per-user API call limits so that the system remains fair and cost-controlled as the user base grows.

#### Acceptance Criteria

1. THE System SHALL enforce a rate limit of 10 scrape requests per user per hour, tracked via Rate_Limit_Record in MongoDB.
2. WHEN a user exceeds the hourly scrape limit, THE System SHALL return HTTP status 429 with a JSON body containing `{ "error": "rate_limit_exceeded", "retryAfterSeconds": <N> }` where N is the seconds until the window resets.
3. THE Rate_Limit_Record SHALL use a sliding window of 60 minutes, storing request timestamps as an array and pruning entries older than 60 minutes on each check.
4. WHEN a user is not authenticated, THE System SHALL apply the rate limit by IP address with a limit of 3 scrape requests per hour.
5. THE System SHALL complete the rate limit check within 200 milliseconds, including the MongoDB read and write.

---

### Requirement 8: Domain and Industry Filtering

**User Story:** As a user, I want to filter scraped results by industry or domain so that I only see ideas in areas I care about.

#### Acceptance Criteria

1. THE System SHALL support domain filtering as a request parameter (`domains[]`) accepted by the scrape endpoint, accepting one or more Interest_Domain values.
2. WHEN `domains[]` is provided in a request, THE Optimizer SHALL exclude items with a Relevance_Score below 30 for all specified domains before passing results to the LLM_Formatter.
3. WHEN `domains[]` is provided and fewer than 5 items pass the domain filter, THE System SHALL relax the Relevance_Score threshold to 10 and retry the filter to ensure a minimum viable result set.
4. WHERE a User_Profile exists, THE System SHALL use the user's stored Interest_Domains as the default domain filter when no `domains[]` parameter is provided in the request.
5. THE System SHALL validate that all values in `domains[]` are members of the predefined Interest_Domain list and return HTTP status 400 with a descriptive error for any unrecognized domain value.

---

### Requirement 9: Scraper Resilience and Timeout Safety

**User Story:** As a SaaS operator, I want the scraper to handle source failures gracefully within Netlify's 10-second function timeout so that partial results are always returned rather than a full failure.

#### Acceptance Criteria

1. THE Scraper SHALL enforce a per-source fetch timeout of 4 seconds (reduced from the current 9 seconds) to allow multiple sources to complete within the 10-second Netlify limit.
2. WHEN a source fetch times out or returns a non-2xx HTTP status, THE Scraper SHALL record the failure in the Source_Quality_Record and continue processing remaining sources.
3. THE Scraper SHALL return partial results if at least 3 sources return data successfully, rather than failing the entire Scrape_Session.
4. WHEN fewer than 3 sources return data, THE Scraper SHALL return the most recent valid Global_Cache entry if one exists, along with a `{ "warning": "stale_cache_used", "cacheAgeMinutes": <N> }` field in the response.
5. THE Scraper SHALL log the per-source fetch duration and status for every Scrape_Session to enable Source_Quality_Record updates.

