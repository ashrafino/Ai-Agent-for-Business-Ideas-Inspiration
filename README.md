# VentureLens — Netlify Deployment Guide

## Required Environment Variables

Set these in **Netlify → Site Settings → Environment Variables**:

| Variable | Value | Required |
|---|---|---|
| `GROQ_API_KEY` | Your Groq API key | ✅ Yes |
| `PRODUCTHUNT_CLIENT_ID` | Your ProductHunt API Client ID | ✅ Yes |
| `PRODUCTHUNT_CLIENT_SECRET` | Your ProductHunt API Client Secret | ✅ Yes |
| `REDDIT_CLIENT_ID` | `Satoshi_Symbol` | ✅ Yes |
| `REDDIT_CLIENT_SECRET` | `nsb6alMYaUffmQ` | ✅ Yes |
| `REDDIT_USERNAME` | `ashrafinopass` | ✅ Yes |
| `REDDIT_PASSWORD` | `b5fTNr@m%H)P~%G` | ✅ Yes |
| `OPENROUTER_API_KEY` | Optional fallback LLM key | ⬜ Optional |
| `MONGODB_URI` | MongoDB connection string | ⬜ Optional |

### ProductHunt API Setup

VentureLens now uses ProductHunt API for richer startup data. See [PRODUCTHUNT_API_SETUP.md](PRODUCTHUNT_API_SETUP.md) for detailed setup instructions.

**Quick Setup:**
1. Get credentials from [ProductHunt API Applications](https://www.producthunt.com/v2/oauth/applications)
2. Add `PRODUCTHUNT_CLIENT_ID` and `PRODUCTHUNT_CLIENT_SECRET` to Netlify environment variables
3. If credentials are missing, the system automatically falls back to RSS feed

## Deploy Steps

1. Push this repo to GitHub
2. Connect to Netlify → **Add new site → Import from Git**
3. Build settings are auto-detected from `netlify.toml`:
   - Build command: *(none)*
   - Publish directory: `public`
   - Functions directory: `netlify/functions`
4. Add all environment variables above in **Site Settings → Environment Variables**
5. Deploy — Netlify Blobs storage is provisioned automatically (no setup needed)

## Architecture

- **Frontend**: Static HTML/CSS/JS in `public/` — no framework, no build step
- **Backend**: Netlify Functions (ESM, Node 20) in `netlify/functions/`
- **Storage**: 
  - Netlify Blobs (zero-config, built into every Netlify site)
  - MongoDB (persistent idea database with automated scraping)
- **LLM**: Groq API (primary) + OpenRouter (fallback)
- **Scraping**: 12 sources with intelligent NLP-powered optimization
  - Sources: HN, Reddit OAuth, Product Hunt API, Indie Hackers, GitHub, DEV.to, BetaList, Lobsters, AppSumo, YC W25, Google Trends, Starter Story
  - **Optimization**: Advanced content filtering using keyword scoring, engagement metrics, and quality analysis
  - **Automation**: Runs every 2 hours, builds comprehensive idea database
  - See [SCRAPER_OPTIMIZATION.md](SCRAPER_OPTIMIZATION.md) and [DATABASE_SETUP.md](DATABASE_SETUP.md)

## Scheduled Jobs

| Function | Schedule | Purpose |
|---|---|---|
| `scheduled-analysis` | Every hour | Full 9-round AI debate |
| `warm-scraper-cache` | Every 6 hours | Pre-warm scraper cache |
| `scheduled-scraper` | Every 2 hours | **NEW**: Scrape + optimize + save to MongoDB database |

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/debate-round` | POST | Run a single debate round |
| `/api/scrape-preview` | GET/POST | Get/refresh scraped data |
| `/api/get-results` | GET | Read from Blobs storage |
| `/api/save-session` | POST | Save analysis to Blobs |
| `/api/health` | GET | Check storage health |
| `/api/trigger-analysis` | POST | Manual full analysis run |
| `/api/curate` | POST | Run Hall of Fame curator |
| `/api/get-ideas` | GET | **NEW**: Query idea database with filters |

## Web Pages

| Page | Description |
|---|---|
| `/index.html` | Main analysis dashboard |
| `/ideas.html` | **NEW**: Browse idea database (updated every 2 hours) |
