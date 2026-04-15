# Requirements Document

## Introduction

VentureLens currently scrapes ProductHunt via RSS feed, which provides limited data. This feature adds ProductHunt API integration to access richer startup data including detailed metrics, tags, maker information, and voting patterns. The integration must be testable locally before deployment and provide API credentials configuration for Netlify deployment.

## Glossary

- **System**: VentureLens scraper module
- **ProductHunt API**: Official ProductHunt REST API v2 (GraphQL)
- **API Credentials**: OAuth tokens (API Key, API Secret, Redirect URI)
- **Local Testing**: Running scraper functions locally before Netlify deployment
- **Scraper Module**: `netlify/functions/lib/scraper.mjs`
- **Environment Variables**: Netlify configuration for API credentials

## Requirements

### Requirement 1

**User Story:** As a developer, I want to integrate ProductHunt API with proper authentication, so that I can access richer startup data beyond RSS feeds.

#### Acceptance Criteria

1. WHEN the System initializes THEN the System SHALL load ProductHunt API credentials from environment variables
2. WHEN API credentials are missing THEN the System SHALL fall back to RSS feed scraping
3. WHEN the System authenticates with ProductHunt API THEN the System SHALL use OAuth 2.0 client credentials flow
4. WHEN authentication fails THEN the System SHALL log the error and fall back to RSS
5. WHEN the System makes API requests THEN the System SHALL include proper authorization headers

### Requirement 2

**User Story:** As a developer, I want to fetch detailed ProductHunt posts via API, so that I can analyze startup ideas with richer metadata.

#### Acceptance Criteria

1. WHEN the System fetches posts from ProductHunt API THEN the System SHALL retrieve posts from the last 7 days
2. WHEN processing API responses THEN the System SHALL extract title, tagline, description, votes, comments, and maker information
3. WHEN the System receives posts THEN the System SHALL filter for posts with more than 50 upvotes
4. WHEN multiple pages exist THEN the System SHALL fetch up to 3 pages of results
5. WHEN API rate limits are encountered THEN the System SHALL implement exponential backoff

### Requirement 3

**User Story:** As a developer, I want to test the ProductHunt API integration locally, so that I can verify functionality before deploying to Netlify.

#### Acceptance Criteria

1. WHEN running locally THEN the System SHALL load environment variables from a local configuration file
2. WHEN the test script executes THEN the System SHALL call the scraper function with ProductHunt API enabled
3. WHEN test results are returned THEN the System SHALL display formatted output showing fetched posts
4. WHEN errors occur during testing THEN the System SHALL display detailed error messages with context
5. WHEN the test completes THEN the System SHALL report the number of posts fetched and execution time

### Requirement 4

**User Story:** As a developer, I want clear documentation for API credentials, so that I can configure the system for deployment.

#### Acceptance Criteria

1. WHEN setting up the System THEN the System SHALL provide instructions for obtaining ProductHunt API credentials
2. WHEN configuring Netlify THEN the System SHALL document required environment variable names
3. WHEN the System starts THEN the System SHALL validate that all required credentials are present
4. WHEN credentials are invalid THEN the System SHALL log which credentials are missing or malformed
5. WHEN using the provided credentials THEN the System SHALL successfully authenticate with ProductHunt API

### Requirement 5

**User Story:** As a system operator, I want the ProductHunt API integration to handle errors gracefully, so that scraping continues even if ProductHunt API fails.

#### Acceptance Criteria

1. WHEN ProductHunt API is unavailable THEN the System SHALL fall back to RSS feed scraping
2. WHEN API requests timeout THEN the System SHALL retry once before falling back
3. WHEN invalid JSON is returned THEN the System SHALL log the error and return empty results
4. WHEN rate limits are exceeded THEN the System SHALL wait and retry with exponential backoff
5. WHEN any ProductHunt source fails THEN the System SHALL continue scraping other sources

### Requirement 6

**User Story:** As a data analyst, I want ProductHunt API data to include rich metadata, so that AI agents have better context for analysis.

#### Acceptance Criteria

1. WHEN the System fetches a post THEN the System SHALL include product name, tagline, description, and URL
2. WHEN the System processes posts THEN the System SHALL extract upvote count, comment count, and featured date
3. WHEN maker information is available THEN the System SHALL include maker names and profiles
4. WHEN topics/tags are present THEN the System SHALL extract and store them as an array
5. WHEN the System formats data for LLM THEN the System SHALL structure it consistently with other sources
