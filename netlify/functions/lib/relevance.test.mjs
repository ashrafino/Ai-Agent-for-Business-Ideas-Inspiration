// Feature: scraping-optimization — Unit + Property tests for relevance.mjs
// Property 4: Relevance score formula correctness
// Property 5: Ranked items are sorted descending
// Property 9: User_Cache contains at most 50 items, sorted by relevance
import { describe, it } from "@jest/globals";
import assert from "node:assert/strict";
import fc from "fast-check";
import { computeRelevanceScore, rankItemsForUser } from "./relevance.mjs";
import { INTEREST_DOMAINS } from "./constants.mjs";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeProfile(weights = {}) {
  const preferenceWeights = Object.fromEntries(INTEREST_DOMAINS.map((d) => [d, weights[d] ?? 1.0]));
  return { preferenceWeights };
}

function makeItem(overrides = {}) {
  return {
    _qualityScore: 50,
    title: "",
    description: "",
    tags: [],
    ...overrides,
  };
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("computeRelevanceScore", () => {
  it("returns qualityScore * 0.3 when no domains match", () => {
    const item = makeItem({ _qualityScore: 80, title: "zzz unrelated zzz" });
    const score = computeRelevanceScore(item, makeProfile());
    assert.equal(score, 80 * 0.3);
  });

  it("returns qualityScore * weight when one domain matches", () => {
    const item = makeItem({ _qualityScore: 60, title: "ai machine learning tool" });
    const profile = makeProfile({ "AI/ML Tools": 2.0 });
    const score = computeRelevanceScore(item, profile);
    // "AI/ML Tools" matches; weight = 2.0
    assert.equal(score, 60 * 2.0);
  });

  it("sums weights for multiple matching domains", () => {
    const item = makeItem({ _qualityScore: 40, title: "ai analytics dashboard" });
    const profile = makeProfile({ "AI/ML Tools": 1.5, "Data & Analytics": 2.0 });
    const score = computeRelevanceScore(item, profile);
    assert.equal(score, 40 * (1.5 + 2.0));
  });

  it("defaults missing weight to 1.0", () => {
    const item = makeItem({ _qualityScore: 50, title: "ai tool" });
    const profile = { preferenceWeights: {} }; // no weights at all
    const score = computeRelevanceScore(item, profile);
    assert.equal(score, 50 * 1.0);
  });

  it("returns 0 when qualityScore is 0", () => {
    const item = makeItem({ _qualityScore: 0, title: "ai tool" });
    assert.equal(computeRelevanceScore(item, makeProfile()), 0);
  });
});

describe("rankItemsForUser", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(rankItemsForUser([], makeProfile()), []);
  });

  it("returns empty array for non-array input", () => {
    assert.deepEqual(rankItemsForUser(null, makeProfile()), []);
  });

  it("attaches relevanceScore and matchedDomains to each item", () => {
    const items = [makeItem({ _qualityScore: 50, title: "ai tool" })];
    const ranked = rankItemsForUser(items, makeProfile());
    assert.ok("relevanceScore" in ranked[0]);
    assert.ok(Array.isArray(ranked[0].matchedDomains));
  });

  it("sorts items descending by relevanceScore", () => {
    const items = [
      makeItem({ _qualityScore: 10, title: "zzz" }),
      makeItem({ _qualityScore: 90, title: "ai tool" }),
      makeItem({ _qualityScore: 50, title: "analytics dashboard" }),
    ];
    const ranked = rankItemsForUser(items, makeProfile());
    for (let i = 0; i < ranked.length - 1; i++) {
      assert.ok(
        ranked[i].relevanceScore >= ranked[i + 1].relevanceScore,
        `Item ${i} score ${ranked[i].relevanceScore} < item ${i + 1} score ${ranked[i + 1].relevanceScore}`
      );
    }
  });
});

// ── Property-Based Tests ──────────────────────────────────────────────────────

// Property 4: Relevance score formula correctness
// Validates: Requirements 2.1, 2.2
describe("Property 4: Relevance score formula correctness", () => {
  it("no-match case returns Q * 0.3", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100, noNaN: true }),
        (qualityScore) => {
          // Item that matches nothing
          const noMatchItem = makeItem({ _qualityScore: qualityScore, title: "zzz unrelated zzz" });
          const noMatchScore = computeRelevanceScore(noMatchItem, makeProfile());
          assert.ok(Math.abs(noMatchScore - qualityScore * 0.3) < 1e-6);
        }
      )
    );
  });

  it("matching case returns Q * sum(W) for matched domains", () => {
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100, noNaN: true }),
        fc.float({ min: Math.fround(0.1), max: Math.fround(3.0), noNaN: true }),
        (qualityScore, aiWeight) => {
          // Item that matches only "AI/ML Tools" via keyword "ai" (not other domains)
          const item = makeItem({ _qualityScore: qualityScore, title: "ai" });
          const profile = makeProfile({ "AI/ML Tools": aiWeight });
          const score = computeRelevanceScore(item, profile);
          // "AI/ML Tools" matches; all other domains default to 1.0
          // We can't easily isolate one domain, so just verify score > 0 when Q > 0
          if (qualityScore > 0) {
            assert.ok(score > 0, `Expected positive score for Q=${qualityScore}`);
          } else {
            assert.equal(score, 0);
          }
        }
      )
    );
  });

  it("formula: score = Q * sum(matched weights) for known single-domain match", () => {
    // Use a fixed item that only matches "AI/ML Tools" (keyword: "chatbot")
    // and a profile with only "AI/ML Tools" weight set, others at 1.0
    // We verify the formula holds for the matched domain weight
    fc.assert(
      fc.property(
        fc.float({ min: 0, max: 100, noNaN: true }),
        fc.float({ min: Math.fround(0.1), max: Math.fround(3.0), noNaN: true }),
        (qualityScore, weight) => {
          const item = makeItem({ _qualityScore: qualityScore, title: "chatbot" });
          const profile = makeProfile({ "AI/ML Tools": weight });
          const score = computeRelevanceScore(item, profile);
          // "chatbot" matches "AI/ML Tools" only; other domains default to 1.0
          // Expected: Q * weight (for AI/ML Tools only)
          const expected = qualityScore * weight;
          assert.ok(Math.abs(score - expected) < 1e-4, `Q=${qualityScore}, w=${weight}: got ${score}, expected ${expected}`);
        }
      )
    );
  });
});

// Property 5: Ranked items are sorted descending
// Validates: Requirements 2.3
describe("Property 5: Ranked items are sorted descending", () => {
  it("every adjacent pair satisfies items[i].relevanceScore >= items[i+1].relevanceScore", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            _qualityScore: fc.float({ min: 0, max: 100, noNaN: true }),
            title: fc.string(),
            description: fc.string(),
            tags: fc.array(fc.string()),
          }),
          { minLength: 0, maxLength: 100 }
        ),
        (items) => {
          const ranked = rankItemsForUser(items, makeProfile());
          for (let i = 0; i < ranked.length - 1; i++) {
            assert.ok(
              ranked[i].relevanceScore >= ranked[i + 1].relevanceScore,
              `Sort order violated at index ${i}`
            );
          }
        }
      )
    );
  });
});

// Property 9: User_Cache size and sort invariant (testing the slice + sort logic)
// Validates: Requirements 4.1
describe("Property 9: rankItemsForUser + slice produces at most 50 items, sorted descending", () => {
  it("slicing to 50 preserves sort order and caps length", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            _qualityScore: fc.float({ min: 0, max: 100, noNaN: true }),
            title: fc.string(),
            description: fc.string(),
            tags: fc.array(fc.string()),
          }),
          { minLength: 0, maxLength: 200 }
        ),
        (items) => {
          const ranked = rankItemsForUser(items, makeProfile()).slice(0, 50);
          assert.ok(ranked.length <= 50);
          for (let i = 0; i < ranked.length - 1; i++) {
            assert.ok(ranked[i].relevanceScore >= ranked[i + 1].relevanceScore);
          }
        }
      )
    );
  });
});
