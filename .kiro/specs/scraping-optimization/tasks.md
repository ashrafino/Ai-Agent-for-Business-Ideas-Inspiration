# Implementation Plan: Scraping Optimization

## Overview

Transform VentureLens from a stateless, single-user scraping pipeline into a personalized, SaaS-ready content delivery system. Implementation proceeds in layers: shared data/config first, then pure logic modules, then Netlify Function endpoints, then integration into existing files.

All new code is JavaScript (ESM `.mjs`), targeting Netlify Functions + MongoDB Atlas. Property-based tests use [fast-check](https://github.com/dubzzz/fast-check).

## Tasks

- [x] 1. Add shared constants and MongoDB collection helper
  - Create `netlify/functions/lib/db.mjs` (or extend `storage-cache.mjs`) exporting a `getDb()` helper that returns the `venturelens` database handle, reusing the existing MongoClient singleton from `storage-cache.mjs`
  - Export `INTEREST_DOMAINS` array and `DOMAIN_KEYWORDS` map (from design §Data Models) as a shared constants file at `netlify/functions/lib/constants.mjs`
  - _Requirements: 1.4, 2.4, 8.1_

- [x] 2. Implement `user-profile.mjs` — User Interest Profile CRUD
  - [x] 2.1 Create `netlify/functions/lib/user-profile.mjs` with `getProfile(userId)`, `saveProfile(userId, profile)`, and `getDefaultWeights()` as specified in the design interface definitions
    - `getProfile` reads from `user_profiles` collection; returns `null` if not found
    - `saveProfile` upserts the document, sets `updatedAt`; must complete within 2 s
    - `getDefaultWeights()` returns `{ [domain]: 1.0 }` for every entry in `INTEREST_DOMAINS`
    - On DB read failure: log warning and return default weights (fail open)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 2.2 Write property test for `getDefaultWeights`
    - **Property 2: Missing profile defaults to equal weights**
    - Verify every domain in `INTEREST_DOMAINS` maps to exactly `1.0`
    - **Validates: Requirements 1.3**

- [x] 3. Implement `relevance.mjs` — Per-User Relevance Scoring Engine
  - [x] 3.1 Create `netlify/functions/lib/relevance.mjs` with `computeRelevanceScore(item, userProfile)` and `rankItemsForUser(items, userProfile)`
    - `computeRelevanceScore`: multiply item's `_qualityScore` by sum of matching domain weights; use `0.3` multiplier when no domains match; domain matching checks `title + description + tags` against `DOMAIN_KEYWORDS` (≥5 keywords per domain)
    - `rankItemsForUser`: returns items sorted descending by `relevanceScore`; must process 500 items in < 500 ms (in-process, no I/O)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 3.2 Write property test for `computeRelevanceScore` formula
    - **Property 4: Relevance score formula correctness**
    - Generate random `qualityScore` (0–100) and random domain weight arrays; verify `score = Q * sum(W)` and zero-match case returns `Q * 0.3`
    - **Validates: Requirements 2.1, 2.2**

  - [ ]* 3.3 Write property test for `rankItemsForUser` sort order
    - **Property 5: Ranked items are sorted descending**
    - Generate random item arrays with random `relevanceScore` values; verify every adjacent pair satisfies `items[i].relevanceScore >= items[i+1].relevanceScore`
    - **Validates: Requirements 2.3**

  - [x] 3.4 Add `getUserCache(userId, globalVersion)`, `setUserCache(userId, globalVersion, items)`, and `invalidateUserCache(userId)` to `relevance.mjs`
    - `getUserCache`: reads `user_cache` collection; returns `null` on cache miss, stale flag, or version mismatch
    - `setUserCache`: writes top-50 relevance-ranked items; sets `expiresAt` to 6 h from now (TTL index); sets `isStale: false`
    - `invalidateUserCache`: sets `isStale: true` for the given userId
    - On DB failure: treat as cache miss (fail open)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 3.5 Write property test for User_Cache size and sort invariant
    - **Property 9: User_Cache contains at most 50 items, sorted by relevance**
    - Generate random item arrays of arbitrary length; verify `rankedItems.length <= 50` and sorted descending
    - **Validates: Requirements 4.1**

- [x] 4. Implement `feedback.mjs` — Feedback Signal Persistence and Weight Updates
  - [x] 4.1 Create `netlify/functions/lib/feedback.mjs` with `recordFeedback(signal)` and `applyFeedbackToProfile(userId, signal)`
    - `recordFeedback`: inserts into `feedback_signals` collection with all required fields (`userId`, `itemId`, `itemSource`, `itemDomains`, `signalType`, `timestamp`); throws on DB error (do not silently discard)
    - `applyFeedbackToProfile`: loads profile, applies weight delta (`+0.1` for thumbs_up/save, `-0.1` for thumbs_down, no-op for skip), enforces cap `3.0` / floor `0.1`, saves updated profile, then calls `invalidateUserCache(userId)`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.4_

  - [ ]* 4.2 Write property test for positive feedback weight update
    - **Property 6: Positive feedback increases weight (capped at 3.0)**
    - Generate random weights in `[0.1, 3.0]`; verify result equals `min(w + 0.1, 3.0)` for `thumbs_up` and `save`
    - **Validates: Requirements 3.2**

  - [ ]* 4.3 Write property test for negative feedback weight update
    - **Property 7: Negative feedback decreases weight (floored at 0.1)**
    - Generate random weights in `[0.1, 3.0]`; verify result equals `max(w - 0.1, 0.1)` for `thumbs_down`
    - **Validates: Requirements 3.3**

  - [ ]* 4.4 Write property test for skip feedback no-op
    - **Property 8: Skip feedback is a no-op on weights**
    - Generate random profiles with arbitrary weights; verify all `preferenceWeights` values are identical before and after recording a `skip` signal
    - **Validates: Requirements 3.4**

- [x] 5. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [~] 6. Implement `rate-limit.mjs` — Sliding-Window Rate Limiting
  - [~] 6.1 Create `netlify/functions/lib/rate-limit.mjs` with `checkRateLimit(userId, ip)`
    - Reads `rate_limits` collection; prunes timestamps older than 60 min; if count >= 10 (authenticated) or >= 3 (unauthenticated/IP), returns `{ allowed: false, retryAfterSeconds: N }`; otherwise appends current timestamp and returns `{ allowed: true }`
    - On DB failure: fail open (allow request) and log warning
    - Must complete within 200 ms including MongoDB read + write
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 6.2 Write property test for rate limit enforcement
    - **Property 17: Rate limit enforced at 10 requests per hour**
    - Generate request counts > 10 within a 60-minute window; verify the 11th request returns `allowed: false` with a positive `retryAfterSeconds`
    - **Validates: Requirements 7.1**

  - [ ]* 6.3 Write property test for sliding window pruning
    - **Property 18: Sliding window prunes old timestamps**
    - Generate timestamp arrays spanning > 60 minutes; verify all remaining timestamps after pruning satisfy `timestamp >= Date.now() - 3_600_000`
    - **Validates: Requirements 7.3**

- [~] 7. Implement `source-quality.mjs` — Source Quality Tracking
  - Create `netlify/functions/lib/source-quality.mjs` with `upsertSourceQuality(sourceName, metrics)`, `getSourceQuality(sourceName)`, `getAllSourceQuality()`, and `getCredibilityMultiplier(record)`
  - `upsertSourceQuality`: upserts `source_quality` collection with all required fields; increments `errorCount` on failure; logs console warning when `averageQualityScore < 20` for 3+ consecutive sessions
  - `getCredibilityMultiplier(record)`: returns `0.5` when `record.successRate < 0.5`, else `1.0`
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [~] 8. Implement `llm-formatter.mjs` — Personalized LLM Context Formatter
  - [~] 8.1 Create `netlify/functions/lib/llm-formatter.mjs` with `formatForUser(rankedItems, userProfile)` and `formatFallback(scraped)`
    - `formatForUser`: filters to items with `relevanceScore > 40`, caps at 60 items; groups by matched Interest_Domain with domain label headers; prepends "User Focus" section listing top-3 domains by weight when profile exists; truncates descriptions to 120 chars; includes `relevanceScore` and priority tier (`GOLD`/`HIGH`/`MEDIUM`) per item
    - `formatFallback`: delegates to existing `formatScrapedDataForLLM` from `scraper.mjs` for backward compatibility
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 8.2 Write property test for LLM context relevance threshold filter
    - **Property 11: LLM context filters by relevance threshold**
    - Generate item sets with random `relevanceScore` values; verify formatted output contains no item with `relevanceScore <= 40` and total item count `<= 60`
    - **Validates: Requirements 5.1**

  - [ ]* 8.3 Write property test for description truncation
    - **Property 13: Item descriptions are truncated to 120 characters**
    - Generate strings of arbitrary length; verify each description as it appears in the formatted output has length `<= 120`
    - **Validates: Requirements 5.4**

- [~] 9. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [~] 10. Modify `scraper.mjs` — Reduce timeout and add per-source timing
  - Change `FETCH_TIMEOUT_MS` from `9000` to `4000`
  - In `fetchWithTimeout` (or each source function), record `startTime` before fetch and log `[Scraper] <sourceName>: <durationMs>ms <status>` after each source completes or fails
  - Return per-source timing/status data from `scrapeAllSources` so `source-quality.mjs` can consume it
  - _Requirements: 9.1, 9.5_

- [~] 11. Modify `scraper-optimizer.mjs` — Add source credibility multiplier
  - Import `getSourceQuality` and `getCredibilityMultiplier` from `source-quality.mjs`
  - In `filterAndRankPosts`, load the `Source_Quality_Record` for the current source and multiply each item's `_qualityScore` by `getCredibilityMultiplier(record)` before filtering
  - _Requirements: 6.3_

- [~] 12. Create Netlify Function endpoints
  - [~] 12.1 Create `netlify/functions/update-profile.mjs`
    - `POST /update-profile`: verify JWT via `verifyAuth`; validate body fields (`interestDomains`, `skillLevel`, `ideaSize`); call `saveProfile`; return `200` with saved profile or `400`/`500` on error
    - _Requirements: 1.1, 1.2, 1.5_

  - [~] 12.2 Create `netlify/functions/submit-feedback.mjs`
    - `POST /submit-feedback`: verify JWT; validate signal fields; call `recordFeedback` then `applyFeedbackToProfile`; return `200` on success, `500` with descriptive message on DB error
    - _Requirements: 3.1, 3.6_

  - [~] 12.3 Create `netlify/functions/source-quality.mjs`
    - `GET /source-quality`: verify JWT (authenticated users only); call `getAllSourceQuality()`; return array of records
    - _Requirements: 6.4_

- [ ] 13. Modify `scrape-preview.mjs` — Wire rate limiting, profile loading, and user cache
  - Import `verifyAuth` from `storage.mjs`, `checkRateLimit` from `rate-limit.mjs`, `getProfile` / `getDefaultWeights` from `user-profile.mjs`, `getUserCache` / `setUserCache` / `rankItemsForUser` from `relevance.mjs`, `formatForUser` / `formatFallback` from `llm-formatter.mjs`, and `upsertSourceQuality` from `source-quality.mjs`
  - Add domain filter support: read `domains[]` from request body; validate against `INTEREST_DOMAINS`; return `400` for unknown values; apply Optimizer domain filter (threshold 30, fallback to 10 if < 5 items pass)
  - Implement the full request flow from the design §Request Flow: auth → rate limit → load profile → check user cache → (on miss) score + cache → format → return
  - Unauthenticated requests skip rate limit (IP-based) and profile loading, falling back to `formatFallback`
  - After scraping, call `upsertSourceQuality` for each source with timing/status data
  - _Requirements: 1.3, 2.1–2.5, 4.1–4.5, 5.1–5.6, 7.1–7.5, 8.1–8.5, 9.1–9.5_

  - [ ]* 13.1 Write property test for domain filter with fallback threshold
    - **Property 19: Domain filter excludes low-relevance items**
    - Generate item sets where fewer than 5 pass threshold 30; verify fallback to threshold 10 is applied and results are returned
    - **Validates: Requirements 8.2, 8.3**

  - [ ]* 13.2 Write property test for invalid domain rejection
    - **Property 20: Invalid domain values produce HTTP 400**
    - Generate strings not in `INTEREST_DOMAINS`; verify the handler returns HTTP status `400` with a descriptive error
    - **Validates: Requirements 8.5**

- [ ] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Property tests use `fast-check`; run with `node --experimental-vm-modules node_modules/.bin/jest` or equivalent
- Each property test file should include the tag comment: `// Feature: scraping-optimization, Property N: <property_text>`
- All MongoDB collections used: `user_profiles`, `feedback_signals`, `user_cache`, `source_quality`, `rate_limits`
- Backward compatibility is preserved: unauthenticated or profile-less requests fall through to the existing `formatScrapedDataForLLM` path unchanged
