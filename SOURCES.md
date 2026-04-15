# VentureLens — Data Sources

## Overview
17 Morocco-compatible sources scraping digital startup opportunities with proof of traction.

## Sources

### Validation & Launches (6 sources)
| Source | What it provides | Why it matters |
|--------|------------------|----------------|
| **Hacker News Show** | Validated launches (>40 pts) | Developers launching products = proof of concept |
| **Hacker News Ask** | Developer pain points | "Need a tool", "paying for" = validated demand |
| **Product Hunt** | Recent launches with upvotes | Upvote count = market interest signal |
| **Indie Hackers** | MRR milestones | "$5K MRR" = proof the business model works |
| **BetaList** | New startup launches | Early-stage validation |
| **YC W25** | Funded startups | YC funding = validated market |

### Revenue Proof (3 sources)
| Source | What it provides | Why it matters |
|--------|------------------|----------------|
| **Acquire.com** | Micro-SaaS for sale | Listed revenue = hard proof of traction |
| **Starter Story** | Proven business models | "How I made $X" = validated playbook |
| **AppSumo** | B2B SaaS deals | People paying = product-market fit |

### Trends & Insights (4 sources)
| Source | What it provides | Why it matters |
|--------|------------------|----------------|
| **Exploding Topics** | Trends before they peak | Early mover advantage |
| **Google Trends** | Daily trending searches | Macro demand signals |
| **Failory** | Startup post-mortems | Learn what NOT to build |
| **Bootstrapped Founder** | Solo founder tactics | Morocco-relevant strategies |

### Community & Discussion (4 sources)
| Source | What it provides | Why it matters |
|--------|------------------|----------------|
| **Reddit** (13 subs) | Pain points, passive income ideas | r/SaaS, r/microsaas, r/digitalnomad, etc. |
| **DEV.to** | Developer articles | Technical pain points |
| **Lobsters** | Tech-focused discussions | HN alternative, quality signal |
| **GitHub Trending** | Hot dev tools (3 languages) | Wrap-as-SaaS opportunities |

## Reddit Subreddits (13 total)
- r/SaaS, r/microsaas, r/Entrepreneur, r/startups
- r/indiehackers, r/nocode, r/SideProject, r/webdev
- r/digitalnomad, r/freelance, r/passive_income
- r/AIAssistants, r/ChatGPTPromptEngineering

## Cache Strategy
- **Storage**: MongoDB Atlas (`scraper_cache` collection)
- **TTL**: 6 hours
- **Warm-up**: Scheduled function runs every 6 hours
- **On-demand**: Manual refresh via UI or API

## Configuration
All sources are zero-config except Reddit OAuth (optional for higher rate limits):
```env
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_USERNAME=your_username
REDDIT_PASSWORD=your_password
```

Without Reddit credentials, the scraper falls back to RSS (works but limited to 5 subreddits).

## Custom Sources
Users can add custom RSS/Atom feeds or JSON APIs via the UI:
1. Click "+ Add Source" in the Raw Intelligence tab
2. Enter URL, label, and type (RSS or JSON)
3. Test the URL to verify it works
4. Save — it's included in all future scrapes

## Morocco Compatibility
All sources focus on:
- ✅ Fully digital products (no inventory)
- ✅ Globally scalable (sell to US/EU from day 1)
- ✅ <$500 to launch (micro-SaaS, AI wrappers, APIs)
- ✅ Remote-first execution
- ✅ Proof of traction (revenue, users, upvotes)
