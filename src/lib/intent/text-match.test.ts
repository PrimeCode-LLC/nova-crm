import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { corpusConcepts, keywordMatchesCorpus } from "@/lib/intent/text-match";

function matches(corpus: string, keyword: string): boolean {
  return keywordMatchesCorpus(corpus.toLowerCase(), corpusConcepts(corpus), keyword);
}

describe("keywordMatchesCorpus", () => {
  it("matches exact substring (curated phrase / tech token)", () => {
    assert.equal(matches("Stack includes VB.NET and WinForms", "vb.net"), true);
  });

  it("bridges vocabulary via synonyms (developer ↔ engineer, hire ↔ hires)", () => {
    const corpus = "The org actively hires infrastructure, systems, and cloud engineers.";
    assert.equal(matches(corpus, "hiring software developers"), true);
  });

  it("matches concept co-occurrence for agents / AI", () => {
    const corpus = "Building production-grade multi-step agents and agentic workflows for AI.";
    assert.equal(matches(corpus, "ai agent"), true);
  });

  it("matches integration despite different phrasing", () => {
    const corpus = "Deep integrations with industry systems like LangChain and Pinecone.";
    assert.equal(matches(corpus, "systems integration initiative"), true);
  });

  it("does NOT match unrelated text (precision guard)", () => {
    const corpus = "We sell artisanal coffee beans to local cafes and restaurants.";
    assert.equal(matches(corpus, "legacy application modernization"), false);
    assert.equal(matches(corpus, "kubernetes migration"), false);
    assert.equal(matches(corpus, "hiring software developers"), false);
  });

  it("requires all anchor concepts for multi-anchor keywords", () => {
    // 'cloud' alone must not fire 'cloud migration' (needs cloud AND migrate)
    assert.equal(matches("We run a modern cloud platform.", "cloud migration"), false);
    assert.equal(matches("Planning a cloud migration off-prem.", "cloud migration"), true);
  });

  it("does not fire demand signals on generic engineering language", () => {
    // 'enterprise application development' has no anchor concept → exact-only
    const corpus = "We build and operate a cloud platform with a large engineering team.";
    assert.equal(matches(corpus, "enterprise application development"), false);
    assert.equal(matches(corpus, "software development rfp"), false);
    assert.equal(matches(corpus, "dedicated development team"), false);
  });

  it("does not treat TV Series as a funding signal", () => {
    const corpus = "Our Platform as featured on Bloomberg's The Advancements TV Series.";
    assert.equal(matches(corpus, "series a funding"), false);
    assert.equal(matches("Company closed a series a funding round last spring.", "series a funding"), true);
  });
});
