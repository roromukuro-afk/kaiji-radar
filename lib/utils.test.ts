import { describe, it, expect } from "vitest";
import { canonicalizeUrl, sourceTypeLabel, truncate } from "./utils";

describe("canonicalizeUrl", () => {
  it("トラッキングパラメータを除去する", () => {
    const a = canonicalizeUrl("https://example.com/news/1?utm_source=x&id=1");
    const b = canonicalizeUrl("https://example.com/news/1?id=1");
    expect(a).toBe(b);
  });
  it("wwwを除去し、クエリ順序を正規化する", () => {
    const a = canonicalizeUrl("https://www.example.com/a?b=2&a=1");
    const b = canonicalizeUrl("https://example.com/a?a=1&b=2");
    expect(a).toBe(b);
  });
  it("末尾スラッシュを除去する", () => {
    expect(canonicalizeUrl("https://example.com/a/")).toBe(canonicalizeUrl("https://example.com/a"));
  });
  it("不正なURLは元の文字列をそのまま返す", () => {
    expect(canonicalizeUrl("not a url")).toBe("not a url");
  });
});

describe("sourceTypeLabel", () => {
  it("既知のソース種別を日本語ラベルに変換する", () => {
    expect(sourceTypeLabel("tdnet")).toBe("TDnet");
    expect(sourceTypeLabel("pr_times")).toBe("PR TIMES");
  });
});

describe("truncate", () => {
  it("指定文字数を超える文字列を省略する", () => {
    expect(truncate("あいうえお", 3)).toBe("あいう…");
  });
  it("指定文字数以内ならそのまま返す", () => {
    expect(truncate("あいう", 5)).toBe("あいう");
  });
  it("nullやundefinedは空文字を返す", () => {
    expect(truncate(null)).toBe("");
    expect(truncate(undefined)).toBe("");
  });
});
