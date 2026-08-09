import { describe, it, expect } from "vitest";
import { isSafeSource, matchesProtection, uniqueProtectCount } from "./protection";

describe("isSafeSource", () => {
  it("tdnet/edinet/officialは安全ソース", () => {
    expect(isSafeSource("tdnet")).toBe(true);
    expect(isSafeSource("edinet")).toBe(true);
    expect(isSafeSource("official")).toBe(true);
  });
  it("jp_news/en_news/pr_timesは安全ソースではない", () => {
    expect(isSafeSource("jp_news")).toBe(false);
    expect(isSafeSource("en_news")).toBe(false);
    expect(isSafeSource("pr_times")).toBe(false);
  });
});

describe("matchesProtection", () => {
  it("決算短信を含むタイトルは保護される", () => {
    expect(matchesProtection("2026年3月期 決算短信のお知らせ", null)).toBe("決算短信");
  });
  it("保護キーワードを含まなければnull", () => {
    expect(matchesProtection("プロ野球の試合結果", null)).toBeNull();
  });
  it("DB由来の追加保護語も判定に使われる", () => {
    expect(matchesProtection("弊社独自のカスタム発表", null, ["カスタム発表"])).toBe("カスタム発表");
  });
  it("大文字小文字を区別しない", () => {
    expect(matchesProtection("Announces M&A deal", null)).toBe("m&a");
  });
});

describe("uniqueProtectCount", () => {
  it("コード側とDB側の重複を除いたユニーク件数を返す", () => {
    const base = uniqueProtectCount([]);
    // 既存キーワードと完全重複するものを追加しても増えない
    expect(uniqueProtectCount(["決算短信"])).toBe(base);
    // 新規語は増える
    expect(uniqueProtectCount(["これは新しい保護語です"])).toBe(base + 1);
  });
});
