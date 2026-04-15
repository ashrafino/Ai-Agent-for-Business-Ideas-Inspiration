# Design Document

## Overview

This design adds ProductHunt API v2 (GraphQL) integration to VentureLens, replacing the limited RSS feed with rich API data. The implementation follows the existing scraper architecture pattern with OAuth authentication, graceful fallback, and comprehensive error handling.

Key design principles:
1. Maintain backward compatibility with existing RSS fallback
2. Follow existing scraper module patterns for consistency
3. Enable local testing with environment variable configuration
4. Implement robust error handling with detailed logging
5. Optimize for Netlify Functions execution environment

## Architecture

### Current ProductHunt Integration
- **Method**: RSS feed parsing (`SOURCES.productHuntRss`)
- **Data**: Limited to title, description, link from RSS
- **Limitations**: No vote counts, tags, maker info, or detailed metrics

### New ProductHunt API Integration

**Authentication Flow:**
```
1. Load credentials from environment variables
2. Request OAuth token using client credentials flow
3. Cache token in memory for function lifetime
4. Use token for GraphQL API requests
5. Fall back to RSS if authentication fails
```

**Data Flow:**
```
scrapeProductHunt()
  ├─> Try API authentication
  │   ├─> Success: scrapeProductHuntAPI()
  │   └─> Failure: scrapeProductHuntRSS()
  └─> Return normalized post data
```

### Integration Points

1. **Environment Variables** (Netlify configuration)
   - `PRODUCTHUNT_API_KEY`: OAuth client ID
   - `PRODUCTHUNT_API_SECRET`: OAuth client secret
   - `PRODUCTHUNT_REDIRECT_URI`: OAuth redirect (not used for client credentials)

2. **Scraper Module** (`netlify/functions/lib/scraper.mjs`)
   - Modify `scrapeProductHunt()` to try API first, RSS fallback
   - Add `scrapeProductHuntAPI()` for GraphQL queries
   - Keep existing `scrapeProductHuntRSS()` as fallback

3. **Local Testing** (new test script)
   - `test-producthunt.mjs`: Standalone test script
   - Loads `.env` file for local credentials
   - Calls scraper functions and displays results

## Components and Interfaces

### OAuth Token Manager

**Purpose**: Handle ProductHunt API authentication with token caching

```javascript
// In-memory token cache (per cold start)
let _phToken = null;
let _phTokenExpiry = 0;

async function getProductHuntToken() {
  // Return cached token if valid
  if (_phToken && Date.now() < _phTokenExpiry) {
    return _phToken;
  }
  
  // Load credentials from environment
  const clientId = process.env.PRODUCTHUNT_API_KEY;
  const clientSecret = process.env.PRODUCTHUNT_API_SECRET;
  
  if (!clientId || !clientSecret) {
    console.warn("[Scraper] ProductHunt credentials not set");
    return null;
  }
  
  // Request token using client credentials flow
  // Cache token with expiry
  // Return token or null on failure
}
```

### ProductHunt API Scraper

**Purpose**: Fetch posts from ProductHunt GraphQL API

```javascript
async function scrapeProductHuntAPI(token) {
  // GraphQL query for posts from last 7 days
  const query = `
    query {
      posts(order: VOTES, postedAfter: "${sevenDaysAgo}") {
        edges {
          node {
            id
            name
            tagline
            description
            votesCount
            commentsCount
            url
            featuredAt
            topics { edges { node { name } } }
            makers { edges { node { name username } } }
          }
        }
      }
    }
  `;
  
  // Execute GraphQL request with authorization
  // Parse response and extract posts
  // Filter for posts with >50 votes
  // Return normalized post array
}
```

### Modified ProductHunt Scraper Entry Point

```javascript
async function scrapeProductHunt() {
  const token = await getProductHuntToken();
  
  if (token) {
    try {
      return await scrapeProductHuntAPI(token);
    } catch (err) {
      console.error("[Scraper] ProductHunt API failed, falling back to RSS:", {
        error: err.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
  
  // Fallback to existing RSS implementation
  return scrapeProductHuntRSS();
}

// Keep existing RSS implementation
async function scrapeProductHuntRSS() {
  // Current implementation unchanged
}
```

### Local Test Script

**Purpose**: Test ProductHunt API integration locally before deployment

```javascript
// test-producthunt.mjs
import { scrapeProductHunt } from './netlify/functions/lib/scraper.mjs';
import { config } from 'dotenv';

// Load .env file
config();

async function testProductHuntAPI() {
  console.log("Testing ProductHunt API integration...\n");
  
  const startTime = Date.now();
  const result = await scrapeProductHunt();
  const duration = Date.now() - startTime;
  
  console.log(`\nFetched ${result.posts.length} posts in ${duration}ms`);
  console.log(`Source: ${result.source}\n`);
  
  // Display first 3 posts
  result.posts.slice(0, 3).forEach((post, i) => {
    console.log(`${i + 1}. ${post.title}`);
    console.log(`   Votes: ${post.upvotes || post.score}`);
    console.log(`   URL: ${post.url}`);
    console.log(`   Tags: ${post.tags?.join(', ') || 'N/A'}\n`);
  });
}

testProductHuntAPI().catch(console.error);
```

## Data Models

### ProductHunt API Response (GraphQL)

```javascript
{
  data: {
    posts: {
      edges: [
        {
          node: {
            id: "12345",
            name: "Product Name",
            tagline: "Short description",
            description: "Full description",
            votesCount: 234,
            commentsCount: 45,
            url: "https://www.producthunt.com/posts/product-name",
            featuredAt: "2026-04-10T00:00:00Z",
            topics: {
              edges: [
                { node: { name: "SaaS" } },
                { node: { name: "Productivity" } }
              ]
            },
            makers: {
              edges: [
                { node: { name: "John Doe", username: "johndoe" } }
              ]
            }
          }
        }
      ]
    }
  }
}
```

### Normalized Post Object

```javascript
{
  title: string,           // Product name
  description: string,     // Tagline + description
  url: string,            // ProductHunt URL
  upvotes: number,        // Vote count
  comments: number,       // Comment count
  tags: string[],         // Topic names
  makers: string[],       // Maker names
  featuredAt: string,     // ISO date
  source: "producthunt-api" | "producthunt-rss"
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Credential loading from environment
*For any* system initialization, when ProductHunt API credentials are set in environment variables, they should be correctly loaded and available for authentication
**Validates: Requirements 1.1**

### Property 2: Fallback to RSS on missing credentials or API failure
*For any* execution where ProductHunt API credentials are missing or API authentication fails, the system should fall back to RSS feed scraping and continue operation
**Validates: Requirements 1.2, 1.4, 5.1**

### Property 3: OAuth 2.0 client credentials flow compliance
*For any* authentication request to ProductHunt API, the request should follow OAuth 2.0 client credentials specification with proper headers, body format, and endpoint
**Validates: Requirements 1.3**

### Property 4: Authorization header presence
*For any* ProductHunt API request, the authorization header should be present and properly formatted with the bearer token
**Validates: Requirements 1.5**

### Property 5: Complete field extraction
*For any* valid ProductHunt API response, all required fields (name, tagline, description, URL, votes, comments, featured date, makers, topics) should be extracted and present in the normalized output
**Validates: Requirements 2.2, 6.1, 6.2, 6.3, 6.4**

### Property 6: Upvote filtering
*For any* set of posts returned from ProductHunt API, all posts in the final filtered result should have more than 50 upvotes
**Validates: Requirements 2.3**

### Property 7: Pagination limit
*For any* ProductHunt API query with multiple pages available, the system should fetch at most 3 pages of results regardless of total pages available
**Validates: Requirements 2.4**

### Property 8: Exponential backoff on rate limits
*For any* API request that returns a rate limit error (429), the system should retry with exponentially increasing delays between attempts
**Validates: Requirements 2.5, 5.4**

### Property 9: Error context in test output
*For any* error that occurs during test script execution, the error message should include context information (timestamp, error type, source)
**Validates: Requirements 3.4**

### Property 10: Credential validation on startup
*For any* system startup requiring ProductHunt API, the system should validate that all required credentials (API key, API secret) are present before attempting authentication
**Validates: Requirements 4.3**

### Property 11: Specific credential error logging
*For any* invalid credential state, the logged error should identify which specific credentials are missing or malformed (API key vs API secret)
**Validates: Requirements 4.4**

### Property 12: Retry once on timeout
*For any* ProductHunt API request that times out, the system should retry exactly once before falling back to RSS
**Validates: Requirements 5.2**

### Property 13: Empty results on invalid JSON
*For any* ProductHunt API response containing invalid JSON, the system should log the error and return an empty post array rather than throwing an exception
**Validates: Requirements 5.3**

### Property 14: Source isolation
*For any* ProductHunt scraping failure (API or RSS), other scraping sources should continue to execute and return results
**Validates: Requirements 5.5**

### Property 15: Format consistency with existing sources
*For any* ProductHunt data formatted for LLM consumption, the structure should match the existing source format used by other scrapers (Reddit, HN, etc.)
**Validates: Requirements 6.5**

## Error Handling

### Authentication Errors
- **Missing Credentials**: Log warning, skip API, use RSS fallback
- **Invalid Credentials (401/403)**: Log error with credential names, use RSS fallback
- **Token Expiry**: Detect via timestamp, request new token automatically
- **OAuth Endpoint Unavailable**: Log error, use RSS fallback

### API Request Errors
- **Rate Limits (429)**: Exponential backoff (1s, 2s, 4s), then RSS fallback
- **Timeouts**: Retry once with 9s timeout, then RSS fallback
- **Invalid JSON**: Log raw response (truncated), return empty array
- **Network Errors**: Log error, use RSS fallback
- **GraphQL Errors**: Log error details, use RSS fallback

### Data Processing Errors
- **Missing Required Fields**: Log warning, skip post, continue with others
- **Invalid Date Formats**: Use current date as fallback
- **Malformed URLs**: Skip post, log warning
- **Empty Response**: Return empty array, log info message

### Test Script Errors
- **Missing .env File**: Display clear error message with setup instructions
- **Invalid Environment Variables**: Display which variables are missing/invalid
- **Scraper Function Errors**: Display full error stack with context
- **Network Unavailable**: Display connectivity error with retry suggestion

## Testing Strategy

### Unit Testing
- OAuth token request and caching logic
- GraphQL query construction with date filters
- Response parsing and field extraction
- Fallback logic when API fails
- Error logging with context fields
- Pagination handling

### Property-Based Testing
Property-based tests will use **fast-check** (JavaScript PBT library) with minimum 100 iterations per test.

Each property test will be tagged with:
```javascript
// Feature: producthunt-api-integration, Property X: [property description]
```

Tests will validate:
1. Credential loading from various environment configurations
2. Fallback behavior with missing/invalid credentials
3. OAuth request format compliance
4. Field extraction completeness across varied API responses
5. Upvote filtering threshold enforcement
6. Pagination limit enforcement
7. Exponential backoff timing sequences
8. Error message context completeness
9. Retry policy (exactly one retry on timeout)
10. JSON parsing resilience with malformed inputs

### Integration Testing
- Full ProductHunt API flow with real credentials (in test environment)
- RSS fallback when API is disabled
- Local test script execution
- Error scenarios (network failures, invalid responses)

### Local Testing Workflow
1. Create `.env` file with ProductHunt credentials
2. Run `node test-producthunt.mjs`
3. Verify posts are fetched from API (not RSS)
4. Check output shows vote counts, tags, makers
5. Test with invalid credentials to verify RSS fallback
6. Test with missing credentials to verify graceful degradation

## Performance Targets

- **ProductHunt API Authentication**: < 2 seconds
- **Single GraphQL Query**: < 3 seconds
- **3-Page Fetch**: < 10 seconds total
- **RSS Fallback**: < 5 seconds (existing performance)
- **Token Cache Hit**: < 1ms (in-memory lookup)

## Deployment Considerations

### Environment Variables (Netlify)
Add to Netlify site configuration:
```
PRODUCTHUNT_API_KEY=zzn58wPYELSN8LZF92apJ9t9vc7OOJHkvuvNGXpiiTg
PRODUCTHUNT_API_SECRET=y11fss9EoehE3W0eaKA1bEFC77GYq8MBgK3clwRhK_g
PRODUCTHUNT_REDIRECT_URI=https://hacker-news.firebaseio.com/v0/
```

Note: The redirect URI provided appears to be for Hacker News API, not ProductHunt. Verify correct ProductHunt OAuth redirect URI before deployment.

### Local Development (.env file)
```
PRODUCTHUNT_API_KEY=zzn58wPYELSN8LZF92apJ9t9vc7OOJHkvuvNGXpiiTg
PRODUCTHUNT_API_SECRET=y11fss9EoehE3W0eaKA1bEFC77GYq8MBgK3clwRhK_g
PRODUCTHUNT_REDIRECT_URI=https://hacker-news.firebaseio.com/v0/
```

### Monitoring
- Log all ProductHunt API vs RSS usage
- Track authentication success/failure rates
- Monitor API response times
- Count posts fetched per source
- Track fallback frequency

### Rollback Strategy
All changes are backward compatible:
1. If ProductHunt API fails, RSS fallback activates automatically
2. Existing RSS implementation remains unchanged
3. No database schema changes required
4. Can disable API by removing environment variables

## API Documentation Reference

### ProductHunt API v2
- **Base URL**: `https://api.producthunt.com/v2/api/graphql`
- **Authentication**: OAuth 2.0 (client credentials or authorization code)
- **Rate Limits**: 100 requests per hour (unauthenticated), 1000/hour (authenticated)
- **Documentation**: https://api.producthunt.com/v2/docs

### GraphQL Query Example
```graphql
query {
  posts(order: VOTES, postedAfter: "2026-04-08T00:00:00Z", first: 20) {
    edges {
      node {
        id
        name
        tagline
        description
        votesCount
        commentsCount
        url
        featuredAt
        topics {
          edges {
            node {
              name
            }
          }
        }
        makers {
          edges {
            node {
              name
              username
            }
          }
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

### OAuth Token Request
```bash
POST https://api.producthunt.com/v2/oauth/token
Content-Type: application/json

{
  "client_id": "YOUR_API_KEY",
  "client_secret": "YOUR_API_SECRET",
  "grant_type": "client_credentials"
}
```

Response:
```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 86400,
  "scope": "public"
}
```
