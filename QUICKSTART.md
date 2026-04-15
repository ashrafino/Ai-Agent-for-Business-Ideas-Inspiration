# Quick Start Guide - Local Testing

## Prerequisites

- Node.js 20+ installed
- ProductHunt API credentials (see below)

## 1. Get ProductHunt API Credentials

1. Visit [ProductHunt API Applications](https://www.producthunt.com/v2/oauth/applications)
2. Sign in or create an account
3. Click "Create an application"
4. Fill in:
   - Name: VentureLens
   - Redirect URI: `https://hacker-news.firebaseio.com/v0/`
5. Copy your Client ID and Client Secret

## 2. Setup Environment

```bash
# Copy example environment file
copy .env.example .env

# Edit .env and add your credentials
PRODUCTHUNT_CLIENT_ID=your_client_id_here
PRODUCTHUNT_CLIENT_SECRET=your_client_secret_here
```

## 3. Install Dependencies

```bash
npm install
```

## 4. Test ProductHunt API Integration

```bash
node test-producthunt-api.mjs
```

Expected output:
```
✓ Loaded environment variables from .env file

============================================================
ProductHunt API Integration Test
============================================================

Credentials Check:
  PRODUCTHUNT_CLIENT_ID: ✓ Set
  PRODUCTHUNT_CLIENT_SECRET: ✓ Set

Starting scrape...

[Scraper] ProductHunt token acquired (expires in 86400s)
[Scraper] Product Hunt API: 19 posts

============================================================
Scrape Results
============================================================

ProductHunt Source: Product Hunt API
ProductHunt Posts: 19

Top ProductHunt Posts:
------------------------------------------------------------

1. Brila
   Tagline: One-page websites from real Google Maps reviews
   Upvotes: 1256 | Comments: 243
   Topics: Website Builder, Artificial Intelligence, Alpha
   ...

✓ Successfully fetched 19 ProductHunt posts
✓ Using ProductHunt API (rich data)
```

## 5. Deploy to Netlify

1. Push to GitHub:
```bash
git add .
git commit -m "Add ProductHunt API integration"
git push origin main
```

2. In Netlify Dashboard:
   - Go to Site Settings → Environment Variables
   - Add `PRODUCTHUNT_CLIENT_ID` and `PRODUCTHUNT_CLIENT_SECRET`
   - Redeploy the site

## Troubleshooting

### "ProductHunt API credentials not set"
- Check that `.env` file exists in project root
- Verify credentials are correct (no extra spaces)

### "ProductHunt OAuth failed (401)"
- Invalid credentials - regenerate them in ProductHunt dashboard
- Check for typos in Client ID or Secret

### "No ProductHunt posts found"
- Check if ProductHunt API is down
- System automatically falls back to RSS feed
- Check logs for detailed error messages

## What's Next?

- See [PRODUCTHUNT_API_SETUP.md](PRODUCTHUNT_API_SETUP.md) for detailed documentation
- Configure other API credentials (Reddit, MongoDB) for full functionality
- Deploy to Netlify for production use

## Your Provided Credentials

```env
PRODUCTHUNT_CLIENT_ID=zzn58wPYELSN8LZF92apJ9t9vc7OOJHkvuvNGXpiiTg
PRODUCTHUNT_CLIENT_SECRET=y11fss9EoehE3W0eaKA1bEFC77GYq8MBgK3clwRhK_g
```

⚠️ **Security Note**: These credentials are now public. Consider regenerating them after initial setup.
