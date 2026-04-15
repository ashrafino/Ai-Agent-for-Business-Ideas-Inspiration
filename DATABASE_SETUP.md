# Automated Idea Database Setup

## Overview

VentureLens now includes an automated system that continuously scrapes, optimizes, and stores startup ideas in MongoDB. When you return after hours or days, you'll have a full database of classified, actionable ideas ready for analysis.

## How It Works

### 1. Automated Scraping (Every 2 Hours)
```
┌─────────────────────────────────────────┐
│   Scheduled Scraper (Every 2 hours)    │
├─────────────────────────────────────────┤
│  1. Scrape 12+ sources                  │
│  2. Apply NLP optimization              │
│  3. Extract & classify ideas            │
│  4. Save to MongoDB (deduplicated)      │
│  5. Update statistics                   │
└─────────────────────────────────────────┘
```

### 2. Intelligent Storage
- **Deduplication**: Same idea from multiple sources = 1 entry
- **Classification**: GOLD/HIGH/MEDIUM priority tiers
- **Metadata**: Quality scores, engagement metrics, topics
- **Indexing**: Fast queries by priority, source, date, quality

### 3. Easy Access
- **Web Dashboard**: `/ideas.html` - Browse all ideas
- **API**: `/api/get-ideas` - Query programmatically
- **Curated Lists**: Gold tier, pain points, validated, trending

## Setup Instructions

### Step 1: Get MongoDB Connection String

**Option A: MongoDB Atlas (Free)**
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create free account
3. Create a free cluster (M0 Sandbox)
4. Click "Connect" → "Connect your application"
5. Copy connection string:
   ```
   mongodb+srv://username:password@cluster.mongodb.net/
   ```

**Option B: Local MongoDB**
```bash
# Install MongoDB locally
# Connection string:
mongodb://localhost:27017/
```

### Step 2: Add to Environment Variables

**Local (.env)**:
```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/venturelens
```

**Netlify Dashboard**:
1. Go to Site Settings → Environment Variables
2. Add variable:
   - Name: `MONGODB_URI`
   - Value: `mongodb+srv://username:password@cluster.mongodb.net/venturelens`

### Step 3: Deploy

```bash
git add .
git commit -m "Add automated idea database system"
git push origin main
```

Netlify will automatically:
- Deploy the new functions
- Start the scheduled scraper (every 2 hours)
- Begin building your idea database

### Step 4: Access Your Ideas

**Web Dashboard**:
```
https://your-site.netlify.app/ideas.html
```

**API Endpoints**:
```
GET /api/get-ideas?action=stats
GET /api/get-ideas?action=curated
GET /api/get-ideas?priority=GOLD&limit=20
GET /api/get-ideas?hasPainPoint=true
GET /api/get-ideas?hasValidation=true
GET /api/get-ideas?source=Product%20Hunt
```

## What Gets Stored

### Idea Document Structure
```json
{
  "title": "AI-powered code review tool",
  "description": "Automated code review using machine learning...",
  "url": "https://example.com",
  
  "source": "Product Hunt",
  "sourceType": "launch",
  "scrapedAt": "2026-04-15T10:00:00Z",
  
  "upvotes": 250,
  "comments": 45,
  
  "qualityScore": 394.9,
  "priority": "GOLD",
  
  "topics": ["developer-tools", "ai", "productivity"],
  "makers": ["John Doe"],
  
  "hasValidation": true,
  "hasPainPoint": false,
  "isStartupRelevant": true,
  
  "uniqueId": "producthunt-aipoweredcodereviewtool",
  "firstSeenAt": "2026-04-15T10:00:00Z",
  "seenCount": 1
}
```

## Database Growth

### Expected Growth Rate
```
Per Scrape Cycle (2 hours):
- Sources scraped: 12+
- Raw items: ~50-60
- After optimization: ~45-50
- New unique ideas: ~30-40 (after deduplication)

Daily Growth:
- Scrapes per day: 12
- New ideas per day: ~360-480
- Storage per day: ~2-3 MB

Monthly Growth:
- New ideas per month: ~10,800-14,400
- Storage per month: ~60-90 MB
```

### After 1 Week
- **Total Ideas**: ~2,500-3,500
- **Gold Tier**: ~875-1,225 (35%)
- **High Priority**: ~1,200-1,680 (48%)
- **Storage**: ~15-20 MB

### After 1 Month
- **Total Ideas**: ~10,000-14,000
- **Gold Tier**: ~3,500-4,900
- **High Priority**: ~4,800-6,720
- **Storage**: ~60-90 MB

## Query Examples

### Get Gold Tier Ideas
```bash
curl "https://your-site.netlify.app/api/get-ideas?priority=GOLD&limit=20"
```

### Get Pain Points
```bash
curl "https://your-site.netlify.app/api/get-ideas?hasPainPoint=true&priority=GOLD,HIGH"
```

### Get Validated Ideas
```bash
curl "https://your-site.netlify.app/api/get-ideas?hasValidation=true&sortBy=quality"
```

### Get Recent Ideas
```bash
curl "https://your-site.netlify.app/api/get-ideas?sortBy=recent&limit=50"
```

### Get Ideas from Specific Source
```bash
curl "https://your-site.netlify.app/api/get-ideas?source=Product%20Hunt&minQualityScore=200"
```

### Get Database Stats
```bash
curl "https://your-site.netlify.app/api/get-ideas?action=stats"
```

Response:
```json
{
  "total": 2847,
  "last24Hours": 384,
  "byPriority": {
    "GOLD": 996,
    "HIGH": 1367,
    "MEDIUM": 484
  },
  "topSources": [
    { "source": "Hacker News Show", "count": 612 },
    { "source": "Product Hunt", "count": 487 },
    { "source": "Reddit", "count": 423 }
  ],
  "byType": {
    "launch": 1124,
    "pain-point": 687,
    "discussion": 534,
    "validation": 312,
    "case-study": 190
  }
}
```

### Get Curated Lists
```bash
curl "https://your-site.netlify.app/api/get-ideas?action=curated"
```

Response:
```json
{
  "goldIdeas": [...],      // Top 20 gold tier
  "painPoints": [...],     // Top 20 pain points
  "validated": [...],      // Top 20 validated
  "trending": [...]        // Top 20 trending
}
```

## Web Dashboard Features

### Tabs
- **All Ideas**: Browse everything
- **🥇 Gold Tier**: Highest quality, validated traction
- **💡 Pain Points**: Clear problems to solve
- **✅ Validated**: Ideas with proven traction
- **🔥 Trending**: Recent + high engagement

### Filters
- **Priority**: GOLD, HIGH, MEDIUM
- **Source**: Product Hunt, Hacker News, Reddit, etc.
- **Sort**: Recent, Quality Score, Engagement
- **Min Quality**: Filter by quality score threshold

### Stats Dashboard
- Total ideas in database
- Ideas added in last 24 hours
- Gold tier count
- High priority count

## Monitoring

### Check Scraper Status

**Netlify Function Logs**:
1. Go to Netlify Dashboard
2. Functions → scheduled-scraper
3. Check logs for:
   ```
   [Scheduled Scraper] Starting automated scrape cycle...
   [Scraper] Complete: 55 → 48 items
   [Optimizer] Filtered out 7 low-quality items
   [MongoDB] Upserted 38 new ideas, updated 10 existing
   ```

### Health Checks

**Manual Trigger** (for testing):
```bash
curl -X POST "https://your-site.netlify.app/.netlify/functions/scheduled-scraper"
```

**Check Database Stats**:
```bash
curl "https://your-site.netlify.app/api/get-ideas?action=stats"
```

## Troubleshooting

### No Ideas Showing Up

**Check MongoDB Connection**:
```bash
# Test connection
curl "https://your-site.netlify.app/api/get-ideas?action=stats"
```

If error: "MONGODB_URI environment variable is not set"
→ Add MONGODB_URI to Netlify environment variables

### Scraper Not Running

**Check Netlify Function Logs**:
- Look for scheduled-scraper executions
- Should run every 2 hours
- Check for errors in logs

**Manual Trigger**:
```bash
curl -X POST "https://your-site.netlify.app/.netlify/functions/scheduled-scraper"
```

### Duplicate Ideas

The system automatically deduplicates based on `uniqueId` (normalized title + source). If you see duplicates:
- They're from different sources (intentional)
- Check `seenCount` field to see how many times seen

## Cost Estimates

### MongoDB Atlas (Free Tier)
- **Storage**: 512 MB (enough for ~100,000 ideas)
- **Bandwidth**: Unlimited reads
- **Cost**: $0/month

### Netlify Functions
- **Scheduled Scraper**: ~360 invocations/month
- **API Calls**: Depends on usage
- **Free Tier**: 125,000 requests/month
- **Cost**: $0/month (within free tier)

### Total Monthly Cost
**$0** (using free tiers)

## Advanced Usage

### Export for AI Analysis

```javascript
// In your analysis function
import { exportForAnalysis } from './lib/idea-storage.mjs';

const ideas = await exportForAnalysis({
  priority: ['GOLD', 'HIGH'],
  limit: 100,
});

// Feed to AI for analysis
const analysis = await analyzeIdeas(ideas);
```

### Custom Queries

```javascript
import { queryIdeas } from './lib/idea-storage.mjs';

// Get ideas from last week with high engagement
const ideas = await queryIdeas({
  startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
  minQualityScore: 200,
  sortBy: 'engagement',
  limit: 50,
});
```

### Batch Processing

```javascript
// Process ideas in batches
let page = 1;
let hasMore = true;

while (hasMore) {
  const result = await queryIdeas({
    priority: 'GOLD',
    limit: 100,
    skip: (page - 1) * 100,
  });
  
  // Process result.ideas
  await processIdeas(result.ideas);
  
  hasMore = result.hasMore;
  page++;
}
```

## Summary

Once deployed with MongoDB configured:

1. **Automated Scraping**: Every 2 hours, new ideas are added
2. **Intelligent Storage**: Deduplicated, classified, optimized
3. **Easy Access**: Web dashboard + API
4. **Zero Maintenance**: Runs automatically 24/7
5. **Free**: Uses free tiers of MongoDB Atlas and Netlify

**Result**: Come back after hours/days to find a comprehensive database of high-quality, classified startup ideas ready for analysis!

---

**Quick Start**:
1. Get MongoDB connection string
2. Add to Netlify environment variables
3. Deploy
4. Visit `/ideas.html` to see your growing database
