# ProductHunt API Integration Setup Guide

## Overview

VentureLens now supports ProductHunt API integration for richer startup data beyond RSS feeds. The API provides detailed metrics, tags, maker information, and voting patterns.

## Getting ProductHunt API Credentials

### Step 1: Create a ProductHunt Application

1. Go to [ProductHunt API Applications](https://www.producthunt.com/v2/oauth/applications)
2. Sign in to your ProductHunt account (create one if needed)
3. Click "Create an application" or "New Application"
4. Fill in the application details:
   - **Name**: VentureLens (or your preferred name)
   - **Redirect URI**: `https://hacker-news.firebaseio.com/v0/` (or any valid URL)
   - **Description**: AI-powered startup idea analyzer
5. Click "Create Application"

### Step 2: Copy Your Credentials

After creating the application, you'll see:
- **Client ID** (API Key): `zzn58wPYELSN8LZF92apJ9t9vc7OOJHkvuvNGXpiiTg`
- **Client Secret** (API Secret): `y11fss9EoehE3W0eaKA1bEFC77GYq8MBgK3clwRhK_g`

⚠️ **Important**: Keep your Client Secret private! Never commit it to version control.

## Local Testing Setup

### Step 1: Create Environment File

Create a `.env` file in the project root:

```bash
# Copy the example file
copy .env.example .env
```

### Step 2: Add Your Credentials

Edit `.env` and add your ProductHunt credentials:

```env
PRODUCTHUNT_CLIENT_ID=zzn58wPYELSN8LZF92apJ9t9vc7OOJHkvuvNGXpiiTg
PRODUCTHUNT_CLIENT_SECRET=y11fss9EoehE3W0eaKA1bEFC77GYq8MBgK3clwRhK_g
```

### Step 3: Install Dependencies

```bash
npm install
```

### Step 4: Run the Test Script

```bash
node test-producthunt-api.mjs
```

Expected output:
```
============================================================
ProductHunt API Integration Test
============================================================

✓ Loaded environment variables from .env file

Credentials Check:
  PRODUCTHUNT_CLIENT_ID: ✓ Set
  PRODUCTHUNT_CLIENT_SECRET: ✓ Set

Starting scrape...

[Scraper] ProductHunt token acquired (expires in 86400s)
[Scraper] Product Hunt API: 25 posts

============================================================
Scrape Results
============================================================

Duration: 3245ms (3.25s)
ProductHunt Source: Product Hunt API
ProductHunt Posts: 25

Top ProductHunt Posts:
------------------------------------------------------------

1. AI-Powered Code Assistant
   Tagline: Write better code faster with AI
   Upvotes: 342 | Comments: 45
   Topics: developer-tools, ai, productivity
   Makers: John Doe, Jane Smith
   URL: https://example.com

...

✓ Successfully fetched 25 ProductHunt posts
✓ Using ProductHunt API (rich data)
```

## Netlify Deployment Setup

### Step 1: Add Environment Variables to Netlify

1. Go to your Netlify dashboard
2. Select your site
3. Go to **Site settings** → **Environment variables**
4. Click **Add a variable**
5. Add the following variables:

| Variable Name | Value |
|--------------|-------|
| `PRODUCTHUNT_CLIENT_ID` | `zzn58wPYELSN8LZF92apJ9t9vc7OOJHkvuvNGXpiiTg` |
| `PRODUCTHUNT_CLIENT_SECRET` | `y11fss9EoehE3W0eaKA1bEFC77GYq8MBgK3clwRhK_g` |

### Step 2: Deploy

```bash
# Deploy to Netlify
git add .
git commit -m "Add ProductHunt API integration"
git push origin main
```

Netlify will automatically deploy your changes.

### Step 3: Verify Deployment

Check the Netlify function logs to confirm ProductHunt API is working:

```
[Scraper] ProductHunt token acquired (expires in 86400s)
[Scraper] Product Hunt API: 25 posts
```

## API Features

### What You Get from ProductHunt API

The API provides richer data compared to RSS:

| Feature | RSS Feed | API |
|---------|----------|-----|
| Product Name | ✓ | ✓ |
| Tagline | ✓ | ✓ |
| Description | Limited | ✓ Full |
| Upvotes | Parsed from text | ✓ Exact count |
| Comments | ✗ | ✓ Count |
| Topics/Tags | ✗ | ✓ Array |
| Makers | ✗ | ✓ Names & profiles |
| Featured Date | ✗ | ✓ Timestamp |
| Website URL | ✗ | ✓ Direct link |

### Filtering & Quality

The scraper automatically:
- Fetches posts from the last 7 days
- Filters for posts with 50+ upvotes
- Filters by relevant topics (SaaS, productivity, AI, automation, etc.)
- Returns up to 25 high-quality posts

### Fallback Behavior

If ProductHunt API fails or credentials are missing:
- ✓ Automatically falls back to RSS feed
- ✓ Continues scraping other sources
- ✓ Logs errors for debugging
- ✓ No interruption to the analysis pipeline

## Troubleshooting

### "ProductHunt API credentials not set"

**Problem**: Environment variables are not loaded.

**Solution**:
- For local testing: Ensure `.env` file exists with correct credentials
- For Netlify: Check environment variables in Netlify dashboard

### "ProductHunt OAuth failed (401)"

**Problem**: Invalid credentials.

**Solution**:
- Verify Client ID and Client Secret are correct
- Check for extra spaces or quotes in `.env` file
- Regenerate credentials in ProductHunt dashboard if needed

### "ProductHunt OAuth failed (429)"

**Problem**: Rate limit exceeded.

**Solution**:
- Wait a few minutes before retrying
- The scraper uses caching to reduce API calls
- Consider increasing cache TTL in production

### "Falling back to RSS"

**Problem**: API request failed, using RSS instead.

**Solution**:
- Check Netlify function logs for detailed error
- Verify network connectivity
- Ensure ProductHunt API is not experiencing downtime

## API Rate Limits

ProductHunt API has the following limits:
- **Client Credentials**: 1000 requests/hour
- **Token Expiry**: 24 hours (automatically refreshed)

The scraper is optimized to stay within limits:
- Uses token caching (24-hour expiry)
- Implements 6-hour result caching
- Single API call per scrape cycle

## Security Best Practices

1. ✓ Never commit `.env` file to git (already in `.gitignore`)
2. ✓ Use environment variables for all credentials
3. ✓ Rotate credentials if accidentally exposed
4. ✓ Use Netlify's encrypted environment variables in production
5. ✓ Monitor API usage in ProductHunt dashboard

## Support

For issues or questions:
- Check Netlify function logs for errors
- Review ProductHunt API documentation: https://api.producthunt.com/v2/docs
- Open an issue in the repository

## Your Credentials

Based on the information provided:

```env
PRODUCTHUNT_CLIENT_ID=zzn58wPYELSN8LZF92apJ9t9vc7OOJHkvuvNGXpiiTg
PRODUCTHUNT_CLIENT_SECRET=y11fss9EoehE3W0eaKA1bEFC77GYq8MBgK3clwRhK_g
```

**Redirect URI**: `https://hacker-news.firebaseio.com/v0/`

⚠️ **Note**: These credentials are now public. Consider regenerating them after setup for security.
