# VentureLens - Quick Reference Card

## 🚀 Quick Start

### Local Testing
```bash
# Install dependencies
npm install

# Test ProductHunt API
node test-producthunt-api.mjs

# Test optimizer
node test-optimizer.mjs
```

### Environment Setup
```bash
# Create .env file
PRODUCTHUNT_CLIENT_ID=your_client_id
PRODUCTHUNT_CLIENT_SECRET=your_client_secret
```

## 📊 System Overview

### Scraping Sources (12+)
- Hacker News (Show HN + Ask HN)
- Reddit (8 subreddits via OAuth)
- ProductHunt (API with rich metadata)
- Indie Hackers
- GitHub Trending
- Y Combinator W25
- DEV.to
- BetaList
- Lobsters
- AppSumo
- Starter Story
- Google Trends

### Optimization System
- **Quality Threshold**: Score > 50
- **Filter Rate**: ~12% (spam removal)
- **GOLD Tier**: 30-40% (validated traction)
- **Processing Time**: <200ms overhead

## 🎯 Quality Scoring

### Signal Weights
| Signal | Weight | Examples |
|--------|--------|----------|
| Validation | 3.0x | $5k MRR, 120 customers, launched |
| Pain Points | 2.5x | "need a tool", "frustrated with" |
| Startup Keywords | 2.0x | SaaS, bootstrapped, indie hacker |
| Market Signals | 1.0x | Growing market, competition |
| Technical | 1.0x | Built with React, API, beta |
| Spam | -5.0x | "Click here", "buy now", "guaranteed" |

### Priority Tiers
- 🥇 **GOLD** (150+): Validated traction, must include
- 🥈 **HIGH** (80-149): Strong signals, good engagement
- 🥉 **MEDIUM** (50-79): Relevant but needs validation
- ❌ **LOW** (<50): Filtered out

## 🔧 Configuration

### Adjust Quality Threshold
```javascript
// scraper-optimizer.mjs, line ~60
analysis.shouldInclude = analysis.qualityScore > 50; // Default
```

### Adjust Priority Tiers
```javascript
// scraper-optimizer.mjs, line ~350
if (qualityScore >= 150) return "GOLD";   // Default: 150
if (qualityScore >= 80) return "HIGH";    // Default: 80
if (qualityScore >= 50) return "MEDIUM";  // Default: 50
```

### Adjust Signal Weights
```javascript
// scraper-optimizer.mjs, line ~10
const WEIGHTS = {
  VALIDATION_SIGNAL: 3.0,    // Default: 3.0
  PAIN_POINT_SIGNAL: 2.5,    // Default: 2.5
  STARTUP_RELEVANCE: 2.0,    // Default: 2.0
};
```

## 📈 Monitoring

### Key Logs to Watch
```
[Scraper] Complete: 55 items in 1712ms
[Optimizer] Starting intelligent content filtering...
[Optimizer] hackernews: 25 posts (🥇15 🥈8 🥉2)
[Optimizer] producthunt: 19 posts (🥇12 🥈5 🥉2)
[Optimizer] Complete: 55 → 48 items (123ms)
[Optimizer] Filtered out 7 low-quality items
```

### Health Metrics
- **Filter Rate**: 10-20% (healthy)
- **GOLD Tier**: 30-40% (optimal)
- **Processing Time**: <200ms (fast)
- **Pass Rate**: 80-90% (balanced)

## 🐛 Troubleshooting

### Too Many Items Filtered
```javascript
// Lower threshold
analysis.shouldInclude = analysis.qualityScore > 30;
```

### Too Much Spam
```javascript
// Raise threshold
analysis.shouldInclude = analysis.qualityScore > 70;
```

### ProductHunt API Issues
```
[Scraper] ProductHunt OAuth failed (401)
→ Check credentials in .env or Netlify dashboard
→ Verify no extra spaces in credentials
→ System automatically falls back to RSS
```

### No Posts from Source
```
[Optimizer] reddit: 0 posts (🥇0 🥈0 🥉0)
→ Posts not meeting quality threshold
→ Check source-specific keywords
→ Adjust weights or add relevant keywords
```

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [README.md](README.md) | Main project overview |
| [QUICKSTART.md](QUICKSTART.md) | Getting started guide |
| [PRODUCTHUNT_API_SETUP.md](PRODUCTHUNT_API_SETUP.md) | ProductHunt API setup |
| [SCRAPER_OPTIMIZATION.md](SCRAPER_OPTIMIZATION.md) | Optimization system guide |
| [OPTIMIZATION_SUMMARY.md](OPTIMIZATION_SUMMARY.md) | Implementation summary |
| [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) | Deployment steps |
| [INTEGRATION_SUMMARY.md](INTEGRATION_SUMMARY.md) | ProductHunt integration |

## 🚀 Deployment

### Netlify Environment Variables
```
GROQ_API_KEY=your_groq_key
PRODUCTHUNT_CLIENT_ID=your_ph_client_id
PRODUCTHUNT_CLIENT_SECRET=your_ph_client_secret
REDDIT_CLIENT_ID=your_reddit_id
REDDIT_CLIENT_SECRET=your_reddit_secret
REDDIT_USERNAME=your_reddit_username
REDDIT_PASSWORD=your_reddit_password
MONGODB_URI=your_mongodb_uri (optional)
```

### Deploy Steps
1. Add environment variables to Netlify
2. Push code: `git push origin main`
3. Netlify auto-deploys
4. Check function logs for optimization metrics

## 🎯 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/scrape-preview` | GET/POST | Get/refresh scraped data |
| `/api/debate-round` | POST | Run single debate round |
| `/api/get-results` | GET | Read from Blobs storage |
| `/api/save-session` | POST | Save analysis to Blobs |
| `/api/trigger-analysis` | POST | Manual full analysis |
| `/api/health` | GET | Check storage health |
| `/api/curate` | POST | Run Hall of Fame curator |

## 💡 Pro Tips

1. **Test Locally First**: Always run `node test-producthunt-api.mjs` before deploying
2. **Monitor Logs**: Watch optimization metrics in production
3. **Adjust Gradually**: Change thresholds in small increments
4. **Track Feedback**: Monitor AI recommendation quality
5. **Cache Awareness**: 6-hour cache TTL, warm cache every 6 hours

## 🎉 Success Indicators

- ✅ 80-90% pass rate (good filtering)
- ✅ 30-40% GOLD tier (validated opportunities)
- ✅ <200ms optimization overhead (fast)
- ✅ No errors in function logs
- ✅ High-quality AI recommendations

---

**Quick Help**: Run `node test-optimizer.mjs` to see scoring in action
**Full Docs**: See [SCRAPER_OPTIMIZATION.md](SCRAPER_OPTIMIZATION.md)
**Support**: Check function logs for detailed error messages
