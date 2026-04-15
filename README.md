# VentureLens — Netlify Deployment Guide

## Required Environment Variables

Set these in **Netlify → Site Settings → Environment Variables**:

| Variable | Value | Required |
|---|---|---|
| `GROQ_API_KEY` | Your Groq API key | ✅ Yes |
| `REDDIT_CLIENT_ID` | `Satoshi_Symbol` | ✅ Yes |
| `REDDIT_CLIENT_SECRET` | `nsb6alMYaUffmQ` | ✅ Yes |
| `REDDIT_USERNAME` | `ashrafinopass` | ✅ Yes |
| `REDDIT_PASSWORD` | `b5fTNr@m%H)P~%G` | ✅ Yes |
| `OPENROUTER_API_KEY` | Optional fallback LLM key | ⬜ Optional |

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
- **Storage**: Netlify Blobs (zero-config, built into every Netlify site)
- **LLM**: Groq API (primary) + OpenRouter (fallback)
- **Scraping**: 12 sources — HN, Reddit OAuth, Product Hunt, Indie Hackers, GitHub, DEV.to, BetaList, Lobsters, AppSumo, YC W25, Google Trends, Exploding Topics

## Scheduled Jobs

| Function | Schedule | Purpose |
|---|---|---|
| `scheduled-analysis` | Every hour | Full 9-round AI debate |
| `warm-scraper-cache` | Every 6 hours | Pre-warm scraper cache |

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
