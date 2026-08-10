import { describe, it, expect } from "vitest";
import { deriveCoverageStatus, type CoverageInput } from "./status";

const NOW = new Date("2026-08-10T12:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

function input(overrides: Partial<CoverageInput>): CoverageInput {
  return {
    is_configured: true,
    last_checked_at: daysAgo(0),
    last_success_at: daysAgo(0),
    last_article_at: daysAgo(1),
    consecutive_failures: 0,
    ...overrides,
  };
}

describe("deriveCoverageStatus", () => {
  it("is_configured=falseなら未設定", () => {
    expect(deriveCoverageStatus(input({ is_configured: false }), NOW)).toBe("not_configured");
  });

  it("一度も確認されていなければ未設定", () => {
    expect(deriveCoverageStatus(input({ last_checked_at: null }), NOW)).toBe("not_configured");
  });

  it("連続失敗が閾値以上なら取得失敗", () => {
    expect(deriveCoverageStatus(input({ consecutive_failures: 2 }), NOW)).toBe("fetch_failed");
    expect(deriveCoverageStatus(input({ consecutive_failures: 5 }), NOW)).toBe("fetch_failed");
  });

  it("連続失敗が1回だけなら取得失敗にはしない", () => {
    expect(deriveCoverageStatus(input({ consecutive_failures: 1, last_article_at: daysAgo(1) }), NOW)).toBe("normal");
  });

  it("直近の記事が3日以内なら正常", () => {
    expect(deriveCoverageStatus(input({ last_article_at: daysAgo(2) }), NOW)).toBe("normal");
  });

  it("記事はあるが3〜30日空いていれば新着なし", () => {
    expect(deriveCoverageStatus(input({ last_article_at: daysAgo(10) }), NOW)).toBe("no_new");
  });

  it("30日を超えて記事が無ければ長期間更新なし", () => {
    expect(deriveCoverageStatus(input({ last_article_at: daysAgo(31) }), NOW)).toBe("long_quiet");
  });

  it("記事が一度も無ければ長期間更新なし", () => {
    expect(deriveCoverageStatus(input({ last_article_at: null }), NOW)).toBe("long_quiet");
  });

  it("取得失敗の判定はlong_quietより優先される", () => {
    expect(deriveCoverageStatus(input({ consecutive_failures: 3, last_article_at: null }), NOW)).toBe("fetch_failed");
  });
});
