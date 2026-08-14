import { describe, it, expect } from "vitest";
import { quickKeywordMatch } from "./relevance";

describe("quickKeywordMatch", () => {
  it("社名が一致すればmatchedNameOrCode=true", () => {
    const r = quickKeywordMatch("Nippon Steel reports record profit", "Nippon Steel", "5401", ["steel"]);
    expect(r.matched).toBe(true);
    expect(r.matchedNameOrCode).toBe(true);
  });

  it("銘柄コードが一致すればmatchedNameOrCode=true", () => {
    const r = quickKeywordMatch("5401 announces new plan", "Nippon Steel", "5401", []);
    expect(r.matched).toBe(true);
    expect(r.matchedNameOrCode).toBe(true);
  });

  it("業界共通語のキーワードのみの一致はmatched=trueだがmatchedNameOrCode=false", () => {
    // 無関係な記事(バンドの曲名)が en_keywords の "steel" に一致してしまうケース
    const r = quickKeywordMatch(
      "King Gizzard & The Lizard Wizard Debut “Kill For The Steel”",
      "Nippon Steel",
      "5401",
      ["steel", "iron ore"]
    );
    expect(r.matched).toBe(true);
    expect(r.matchedNameOrCode).toBe(false);
  });

  it("何も一致しなければmatched=false", () => {
    const r = quickKeywordMatch("Completely unrelated headline", "Nippon Steel", "5401", ["steel"]);
    expect(r.matched).toBe(false);
    expect(r.matchedNameOrCode).toBe(false);
  });
});
