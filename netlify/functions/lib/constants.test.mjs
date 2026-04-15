// Feature: scraping-optimization — Unit tests for constants.mjs
import { describe, it } from "@jest/globals";
import assert from "node:assert/strict";
import { INTEREST_DOMAINS, DOMAIN_KEYWORDS } from "./constants.mjs";

describe("INTEREST_DOMAINS", () => {
  it("is a non-empty array of strings", () => {
    assert.ok(Array.isArray(INTEREST_DOMAINS));
    assert.ok(INTEREST_DOMAINS.length > 0);
    for (const d of INTEREST_DOMAINS) assert.equal(typeof d, "string");
  });

  it("contains no duplicates", () => {
    assert.equal(new Set(INTEREST_DOMAINS).size, INTEREST_DOMAINS.length);
  });
});

describe("DOMAIN_KEYWORDS", () => {
  it("has an entry for every INTEREST_DOMAIN", () => {
    for (const domain of INTEREST_DOMAINS) {
      assert.ok(domain in DOMAIN_KEYWORDS, `Missing keywords for domain: ${domain}`);
    }
  });

  it("each domain has at least 5 keywords", () => {
    for (const domain of INTEREST_DOMAINS) {
      const kws = DOMAIN_KEYWORDS[domain];
      assert.ok(Array.isArray(kws), `Keywords for ${domain} should be an array`);
      assert.ok(kws.length >= 5, `${domain} has fewer than 5 keywords`);
    }
  });
});
