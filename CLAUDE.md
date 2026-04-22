# VentureLens Architecture
- **Consolidated Debate**: 4 rounds (Scout, Evaluator, Strategist, Judge)
- **Primary LLM**: Gemini 2.0 Flash (via direct API)
- **Fallback LLMs**: Llama 3.3 70B (Groq), OpenRouter free models
- **Database**: Netlify Blobs for session/history, MongoDB for raw ideas
- **Scraping**: Sequential multi-source scraping with 6h caching
- **Morocco Focus**: Implementation notes integrated into Strategist/Judge rounds

## Recent Fixes
- Consolidated 9 rounds into 4 to improve stability and speed.
- Prioritized Gemini 2.0 Flash (15 RPM free tier) to avoid "All models exhausted" errors.
- Merged Analyst/Critic into **Evaluator** and Strategist/Morocco into **Strategist**.
- Updated frontend and backend to support the new 4-round pipeline.
- Improved error handling to continue analysis if sub-rounds fail.
- Optimized rate limits and inter-round delays for free tier quotas.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
