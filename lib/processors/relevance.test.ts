import { describe, it, expect } from "vitest";
import { quickKeywordMatch } from "./relevance";

describe("quickKeywordMatch", () => {
  it("社名が一致すればmatchedNameOrCode=true", () => {
    const r = quickKeywordMatch("Nippon Steel reports record profit", "Nippon Steel", "5401", ["steel"]);
    expect(r.matched).toBe(true);
    expect(r.matchedNameOrCode).toBe(true);
  });

  it("銘柄コードのみの一致はmatched=trueだがmatchedNameOrCode=false(社名ほど信頼できないため)", () => {
    const r = quickKeywordMatch("5401 announces new plan", "Nippon Steel", "5401", []);
    expect(r.matched).toBe(true);
    expect(r.matchedNameOrCode).toBe(false);
  });

  it("4桁の裸の銘柄コードは製品型番・西暦等に誤爆するためmatchedNameOrCode=false", () => {
    // 1911 = 住友林業のコードだが、拳銃モデル名やサッカークラブの創設年と無差別に一致する
    const r = quickKeywordMatch(
      "Springfield Armory 1911 DS Prodigy 3.5” AOS 9mm: The New Tiny Titan",
      "住友林業",
      "1911",
      ["木材", "住宅"]
    );
    expect(r.matched).toBe(true);
    expect(r.matchedNameOrCode).toBe(false);
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
