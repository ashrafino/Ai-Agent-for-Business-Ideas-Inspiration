// Feature: scraping-optimization — Unit + Property tests for feedback weight logic
// Property 6: Positive feedback increases weight (capped at 3.0)
// Property 7: Negative feedback decreases weight (floored at 0.1)
// Property 8: Skip feedback is a no-op on weights
import { describe, it } from "@jest/globals";
import assert from "node:assert/strict";
import fc from "fast-check";
import { INTEREST_DOMAINS } from "./constants.mjs";

// ── Pure weight-update logic (extracted from applyFeedbackToProfile) ──────────
// We test the arithmetic directly since applyFeedbackToProfile requires MongoDB.

const WEIGHT_CAP = 3.0;
const WEIGHT_FLOOR = 0.1;
const WEIGHT_DELTA = 0.1;

function applyDelta(weight, signalType) {
  if (signalType === "skip") return weight;
  const delta =
    signalType === "thumbs_up" || signalType === "save"
      ? WEIGHT_DELTA
      : signalType === "thumbs_down"
      ? -WEIGHT_DELTA
      : 0;
  return Math.min(WEIGHT_CAP, Math.max(WEIGHT_FLOOR, weight + delta));
}

function applyDeltaToWeights(weights, signalType, domains) {
  if (signalType === "skip") return { ...weights };
  const updated = { ...weights };
  for (const domain of domains) {
    if (domain in updated) {
      updated[domain] = applyDelta(updated[domain], signalType);
    }
  }
  return updated;
}

// ── Unit tests ────────────────────────────────────────────────────────────────

describe("applyDelta (weight arithmetic)", () => {
  it("thumbs_up increases weight by 0.1", () => {
    assert.equal(applyDelta(1.0, "thumbs_up"), 1.1);
  });

  it("save increases weight by 0.1", () => {
    assert.equal(applyDelta(1.0, "save"), 1.1);
  });

  it("thumbs_down decreases weight by 0.1", () => {
    assert.ok(Math.abs(applyDelta(1.0, "thumbs_down") - 0.9) < 1e-9);
  });

  it("skip is a no-op", () => {
    assert.equal(applyDelta(1.5, "skip"), 1.5);
  });

  it("caps at 3.0 on thumbs_up", () => {
    assert.equal(applyDelta(3.0, "thumbs_up"), 3.0);
    assert.equal(applyDelta(2.95, "thumbs_up"), 3.0);
  });

  it("floors at 0.1 on thumbs_down", () => {
    assert.equal(applyDelta(0.1, "thumbs_down"), 0.1);
    assert.ok(Math.abs(applyDelta(0.15, "thumbs_down") - 0.1) < 1e-9);
  });
});

// ── Property-Based Tests ──────────────────────────────────────────────────────

const weightArb = fc.float({ min: Math.fround(0.1), max: Math.fround(3.0), noNaN: true });

// Property 6: Positive feedback increases weight (capped at 3.0)
// Validates: Requirements 3.2
describe("Property 6: Positive feedback increases weight (capped at 3.0)", () => {
  it("thumbs_up: result = min(w + 0.1, 3.0)", () => {
    fc.assert(
      fc.property(weightArb, (w) => {
        const result = applyDelta(w, "thumbs_up");
        const expected = Math.min(w + WEIGHT_DELTA, WEIGHT_CAP);
        assert.ok(Math.abs(result - expected) < 1e-9, `w=${w}: got ${result}, expected ${expected}`);
      })
    );
  });

  it("save: result = min(w + 0.1, 3.0)", () => {
    fc.assert(
      fc.property(weightArb, (w) => {
        const result = applyDelta(w, "save");
        const expected = Math.min(w + WEIGHT_DELTA, WEIGHT_CAP);
        assert.ok(Math.abs(result - expected) < 1e-9);
      })
    );
  });
});

// Property 7: Negative feedback decreases weight (floored at 0.1)
// Validates: Requirements 3.3
describe("Property 7: Negative feedback decreases weight (floored at 0.1)", () => {
  it("thumbs_down: result = max(w - 0.1, 0.1)", () => {
    fc.assert(
      fc.property(weightArb, (w) => {
        const result = applyDelta(w, "thumbs_down");
        const expected = Math.max(w - WEIGHT_DELTA, WEIGHT_FLOOR);
        assert.ok(Math.abs(result - expected) < 1e-9, `w=${w}: got ${result}, expected ${expected}`);
      })
    );
  });
});

// Property 8: Skip feedback is a no-op on weights
// Validates: Requirements 3.4
describe("Property 8: Skip feedback is a no-op on weights", () => {
  it("all preferenceWeights are identical before and after skip", () => {
    const profileArb = fc.record(
      Object.fromEntries(INTEREST_DOMAINS.map((d) => [d, weightArb]))
    );
    const domainsArb = fc.subarray(INTEREST_DOMAINS, { minLength: 0 });

    fc.assert(
      fc.property(profileArb, domainsArb, (weights, domains) => {
        const updated = applyDeltaToWeights(weights, "skip", domains);
        for (const domain of INTEREST_DOMAINS) {
          assert.equal(updated[domain], weights[domain]);
        }
      })
    );
  });
});
