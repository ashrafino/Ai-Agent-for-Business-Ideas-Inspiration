# Design Document

## Overview

This design optimizes VentureLens for production by improving performance, reliability, and maintainability. The focus is on functional improvements that directly impact user experience: faster load times, reliable debate completion, robust error handling, and efficient resource usage.

The optimization strategy prioritizes:
1. Database connection management and query optimization
2. LLM API resilience with intelligent fallback
3. Scraper reliability and caching
4. Frontend performance through lazy loading
5. Comprehensive error handling

## Architecture

### Current Architecture
- **Frontend**: Static HTML/CSS/JS served from Netlify CDN
- **Backend**: Netlify Functions (serverless, Node 20)
- **Database**: MongoDB Atlas (persistent storage)
- **LLM Providers**: Groq (primary), OpenRouter (fallback)
- **Scraping**: 17+ sources with 6-hour cache in MongoDB
- **Scheduled Jobs**: Hourly analysis, 6-hour cache warming

### Optimization Focus Areas

1. **Database Layer**
   - Connection pooling and reuse
   - Index optimization for frequent queries
   - Atomic operations for concurrent writes
   - Graceful degradation on connection failures

2. **LLM Integration**
   - Dynamic timeout management for Netlify limits
   - Intelligent model fallback queue
   - Token usage optimization
   - Rate limit handling with exponential backoff

3. **Scraping Layer**
   - Parallel source fetching with individual timeouts
   - Graceful failure handling per source
   - Cache-first strategy with background refresh
   - Reddit OAuth with RSS fallback

4. **Frontend**
   - Lazy loading for tab content
   - Virtual scrolling for large lists
   - Client-side filtering and search
   - Optimistic UI updates

## Components and Interfaces

### Database Module (`storage.mjs`)

**Optimizations:**
- Singleton connection with health checks
- Automatic reconnection on stale connections
- Index creation on startup
- Atomic update operations

**Interface:**
```javascript
// Read operations
async function readDB() -> { db: Object }
async function get(key: string) -> any

// Write operations  
async function writeDB(db: Object) -> void
async function update(mutateFn: Function) -> Object

// Health
async function healthCheck() -> { canRead, canWrite, ... }
```

### LLM Module (`groq.mjs`)

**Optimizations:**
- Dynamic timeout based on remaining lambda time
- Ordered fallback queue (Groq → OpenRouter)
- Per-call failure tracking (not global)
- Context truncation to prevent token overflow

**Interface:**
```javascript
async function callGroq(messages, options) -> string
async function runRound(agent, prompt, context, options) -> string
async function runFullDebate(options) -> { id, ideas, debate, ... }
```

### Scraper Module (`scraper.mjs`)

**Optimizations:**
- Parallel source fetching with Promise.allSettled
- Individual source timeouts (9s per source)
- Cache-first with 6-hour TTL
- Reddit OAuth with RSS fallback
- Raw data persistence to MongoDB

**Interface:**
```javascript
async function scrapeAllSources(options) -> ScrapedData
async function scrapeCustomSource(source) -> { posts, source }
function formatScrapedDataForLLM(scraped) -> string
```

### Frontend Module (`app.js`)

**Optimizations:**
- Lazy tab loading
- Debounced search/filter
- Collapsed sections by default
- Parallel API calls where independent

**Key Functions:**
```javascript
async function loadLatestResults()
async function startLiveDebate()
function renderIdeas(ideas, selector)
function applyIntelFilters()
```

## Data Models

### Session Document
```javascript
{
  id: string,              // "session_<timestamp>"
  timestamp: string,       // ISO 8601
  status: "complete",
  phases: {
    debate: 5,
    judging: 3,
    morocco: 1,
    totalRounds: 9
  },
  ideas: [Idea],          // Array of classified ideas
  debate: [DebateRound]   // Optional, full debate log
}
```

### Idea Document
```javascript
{
  rank: number,
  name: string,
  tier: "S" | "A" | "B" | "C",
  score: number,           // 0-10
  compositeScore: number,  // Average from 3 judges
  concept: string,
  evidence: string,
  techStack: string,
  executionStrategy: string,
  unfairAdvantage: string,
  estimatedMRR: string,
  launchCost: string,
  timeToRevenue: string,
  riskLevel: "low" | "medium" | "high",
  tags: [string],
  ratings: {
    averages: {
      capitalEfficiency: number,
      executionFromMorocco: number,
      scalability: number,
      innovationScore: number
    },
    judges: {
      alpha: { ... },
      beta: { ... },
      gamma: { ... }
    },
    totalScore: number
  },
  moroccoNotes: {
    paymentSolutions: string,
    legalStructure: string,
    bankingSolutions: string,
    localAdvantages: string,
    remoteExecution: string,
    criticalWarning: string
  }
}
```

### Database Structure
```javascript
{
  _id: "main",
  latest: Session | null,
  history: [HistoryEntry],    // Max 50
  bestOfDay: {
    date: string,
    ideas: [Idea],
    totalIdeasAnalyzed: number,
    uniqueIdeas: number,
    totalRuns: number
  },
  todayIdeas: [Idea],
  todayDate: string,
  hallOfFame: [Idea],
  lastSaved: string
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Database connection reuse
*For any* sequence of database operations within a single lambda invocation, the connection instance should be reused rather than creating new connections
**Validates: Requirements 1.2**

### Property 2: Parallel API execution
*For any* set of independent API calls, they should execute concurrently rather than sequentially, and the total execution time should be closer to the slowest call than the sum of all calls
**Validates: Requirements 1.4**

### Property 3: LLM retry and fallback
*For any* LLM API call that fails with a transient error, the system should retry with exponential backoff, and if all retries fail, attempt alternative models in the fallback queue
**Validates: Requirements 2.2**

### Property 4: Dynamic timeout management
*For any* Netlify function execution, when remaining time drops below 3 seconds, the system should stop attempting new LLM calls and return with available results
**Validates: Requirements 2.3**

### Property 5: Cache-first data retrieval
*For any* scraping request, if valid cached data exists (age < TTL), the system should return cached data without making new HTTP requests
**Validates: Requirements 2.4**

### Property 6: Rate limit spacing
*For any* sequence of LLM API calls, the system should enforce minimum delay between calls to respect rate limits
**Validates: Requirements 2.5**

### Property 7: Parallel scraper execution
*For any* scraping session with multiple sources, all sources should be fetched in parallel using Promise.allSettled
**Validates: Requirements 3.1**

### Property 8: Scraper graceful degradation
*For any* scraping session, if individual sources fail, the system should continue with successful sources and return partial results with error logging
**Validates: Requirements 3.2**

### Property 9: Scraper data persistence
*For any* completed scraping session, the raw scraped data should be persisted to MongoDB regardless of whether it will be used immediately
**Validates: Requirements 3.5**

### Property 10: Database write retry
*For any* MongoDB write operation that fails with a connection error, the system should retry the operation before throwing an error
**Validates: Requirements 4.1**

### Property 11: Default value safety
*For any* database read operation that returns no data, the system should return well-formed default structures rather than null or undefined
**Validates: Requirements 4.2**

### Property 12: Atomic concurrent writes
*For any* concurrent database write operations, the final state should reflect all updates without data loss or corruption
**Validates: Requirements 4.3**

### Property 13: Markdown sanitization
*For any* markdown content rendered in the UI, malicious scripts should be sanitized and prevented from executing
**Validates: Requirements 5.2**

### Property 14: Error logging completeness
*For any* error that occurs in Netlify Functions, the logged error should include timestamp, function name, operation type, and error details
**Validates: Requirements 6.1**

### Property 15: LLM error context
*For any* LLM API call that fails, the logged error should include the model name, provider, attempt number, and error message
**Validates: Requirements 6.2**

### Property 16: Database error context
*For any* database operation that fails, the logged error should include the operation type (read/write), collection name, and error details
**Validates: Requirements 6.4**

### Property 17: Scraper error identification
*For any* scraping source that fails, the logged error should include the source name, URL, and failure reason
**Validates: Requirements 6.5**

### Property 18: JSON parsing resilience
*For any* LLM response expected to contain JSON, the parser should attempt multiple extraction strategies (direct parse, regex extraction, code block extraction) before failing
**Validates: Requirements 7.1**

### Property 19: Empty result handling
*For any* scraping session that returns empty results, the system should proceed with an empty array rather than throwing an error
**Validates: Requirements 7.2**

### Property 20: Connection recovery
*For any* MongoDB connection that becomes stale or disconnected, the system should detect the issue and attempt reconnection before failing
**Validates: Requirements 7.3**

### Property 21: Exponential backoff on rate limits
*For any* API call that fails with a rate limit error (429), the system should implement exponential backoff with increasing delays between retries
**Validates: Requirements 7.4**

### Property 22: Input sanitization
*For any* user input received by the system, malformed or malicious content should be validated and sanitized before processing
**Validates: Requirements 7.5**

## Error Handling

### Database Errors
- **Connection Failures**: Retry with exponential backoff (2s, 4s, 8s), then fail gracefully
- **Query Timeouts**: Log query details, return cached data if available
- **Write Failures**: Retry once, then log error and notify user
- **Stale Connections**: Detect via ping, reconnect automatically

### LLM API Errors
- **Rate Limits (429)**: Exponential backoff, then try next model in queue
- **Timeouts**: Reduce maxTokens, try faster model
- **Auth Errors (401/403)**: Skip provider entirely for this call
- **Invalid Responses**: Parse with fallback strategies, log raw response

### Scraping Errors
- **Source Timeouts**: Continue with other sources, log failure
- **Parse Errors**: Skip malformed items, continue with valid data
- **OAuth Failures**: Fall back to RSS feeds
- **Network Errors**: Retry once with 2s delay, then skip source

### Frontend Errors
- **API Failures**: Display user-friendly message, offer retry
- **Render Errors**: Log to console, show fallback UI
- **Invalid Data**: Sanitize and use defaults where possible

## Testing Strategy

### Unit Testing
- Database connection pooling logic
- JSON parsing with various malformed inputs
- Error handling for each module
- Cache TTL calculations
- Timeout management logic

### Property-Based Testing
Property-based tests will use **fast-check** (JavaScript PBT library) with minimum 100 iterations per test.

Each property test will be tagged with:
```javascript
// Feature: production-optimization, Property X: [property description]
```

Tests will validate:
1. Connection reuse across multiple operations
2. Scraper partial success scenarios
3. LLM fallback queue exhaustion
4. Concurrent database writes
5. Timeout boundary conditions
6. JSON parsing edge cases
7. Default value generation
8. Parallel execution isolation

### Integration Testing
- Full debate flow with mocked LLM responses
- Database read/write cycles
- Scraper with mocked HTTP responses
- Frontend state management

## Performance Targets

- **Initial Page Load**: < 3 seconds
- **Latest Results Load**: < 2 seconds
- **Live Debate Completion**: < 4 minutes (9 rounds)
- **Database Query**: < 500ms
- **Scraper Full Run**: < 30 seconds (parallel)
- **Single LLM Call**: < 20 seconds

## Deployment Considerations

### Environment Variables
All existing variables remain unchanged:
- `MONGODB_URI`: MongoDB Atlas connection string
- `GROQ_API_KEY`: Primary LLM provider
- `OPENROUTER_API_KEY`: Fallback LLM provider
- Reddit OAuth credentials

### Monitoring
- Log all LLM model selections and fallbacks
- Track database connection reuse rate
- Monitor scraper success/failure rates per source
- Measure function execution times

### Rollback Strategy
All changes are backward compatible. If issues arise:
1. Revert to previous deployment via Netlify
2. Database schema unchanged, no migration needed
3. Frontend gracefully handles missing data
